import { NATAL_2026 } from "../config/natalPremiado2026.js";
import NatalAuditoria from "../models/NatalAuditoria.js";
import NatalBonificacao from "../models/NatalBonificacao.js";
import NatalCompraExterna from "../models/NatalCompraExterna.js";
import NatalSubstituicaoCompra from "../models/NatalSubstituicaoCompra.js";
import Pedido from "../models/Pedido.js";
import { buildAutorNatal } from "../models/natalSchemas.js";
import { calcularEstadoCumulativo, paraCentavos, paraReais } from "../utils/natalCumulativo.js";
import {
  exigirCumulativoAtivo,
  executarTransacaoNatal,
  garantirIndicesNatal,
  NatalError,
} from "./natalBaseService.js";
import { normalizarReferencia, validarCompra } from "./natalCompraExternaService.js";
import { coletarCompras, cuponsAutomaticos, recalcularConta, somarCentavos } from "./natalContaService.js";
import { carregarContaLeitura } from "./natalDistribuidorService.js";

// Troca da origem de uma compra, sem depender da ordem de duas operações manuais. Fica
// desligada até autorização específica: exige NATAL2026_SUBSTITUICAO_HABILITADA=true.

export const substituicaoHabilitada = (env = process.env) => env.NATAL2026_SUBSTITUICAO_HABILITADA === "true";

const CAMPANHA = NATAL_2026.slug;

const resumirEstado = (estado) => ({
  acumulado: paraReais(estado.totalCentavos),
  ciclosConcluidos: estado.ciclosConcluidos,
  cicloAtual: estado.cicloAtual,
  acumuladoCiclo: paraReais(estado.acumuladoCicloCentavos),
  cupons: estado.cuponsDevidos,
  bonificacaoProdutos: paraReais(estado.produtosDevidoCentavos),
  bonificacaoMarketing: paraReais(estado.marketingDevidoCentavos),
});

// Somente leitura: mostra o antes e o depois, as duplicidades e o que exige revisão.
export const previaSubstituicao = async ({ pedidoId, dados, config = NATAL_2026, now = new Date() }) => {
  const pedido = await Pedido.findById(pedidoId).select("numeroPedido clienteId valorTotal status").lean();
  if (!pedido) throw new NatalError(404, "Pedido não encontrado.", "nao_encontrado");
  const compra = validarCompra(dados, config, now);
  const clienteId = pedido.clienteId;
  const referenciaChave = normalizarReferencia(compra.referencia);

  const [compras, conta, substituicao, referenciaExistente, valorIgual, bonificacoes] = await Promise.all([
    coletarCompras(clienteId, { config }),
    carregarContaLeitura(clienteId, { config }),
    NatalSubstituicaoCompra.findOne({ campanha: CAMPANHA, pedidoId }).lean(),
    NatalCompraExterna.findOne({ clienteId, referenciaChave, ativa: true }).select("_id status").lean(),
    NatalCompraExterna.findOne({ clienteId, status: "validada", valor: compra.valor }).select("referencia").lean(),
    NatalBonificacao.find({ campanha: CAMPANHA, clienteId }).select("ciclo tipo valorConcedido").lean(),
  ]);

  const bloqueios = [];
  const alertas = [];
  const origem = compras.find((item) => item.id === String(pedidoId));
  if (substituicao) bloqueios.push({ codigo: "substituicao_existente", descricao: `Pedido já substituído pela referência de ${substituicao.valorCompra}.` });
  else if (!origem) bloqueios.push({ codigo: "pedido_nao_contabilizado", descricao: "Este pedido não conta para o acumulado da campanha." });
  if (referenciaExistente) bloqueios.push({ codigo: "referencia_duplicada", descricao: "Esta referência já foi registrada para o distribuidor." });
  if (valorIgual) alertas.push({ codigo: "valor_ja_validado", descricao: `Já existe compra validada de mesmo valor: ${valorIgual.referencia}.` });

  const valorPedidoCentavos = paraCentavos(pedido.valorTotal);
  const valorCompraCentavos = paraCentavos(compra.valor);
  const diferenca = valorCompraCentavos - valorPedidoCentavos;
  if (diferenca !== 0) alertas.push({ codigo: "valor_diferente", descricao: `A compra difere do pedido em R$ ${paraReais(diferenca).toFixed(2)}.` });

  const totalAntes = somarCentavos(compras);
  const antes = calcularEstadoCumulativo(totalAntes, config);
  const depois = calcularEstadoCumulativo(origem ? totalAntes + diferenca : totalAntes, config);
  const ciclosDepois = new Map(depois.ciclos.map((ciclo) => [ciclo.numero, ciclo]));
  const reduzCupons = cuponsAutomaticos(conta) > depois.cuponsDevidos;
  const reduzBonificacao = bonificacoes.some((doc) => (
    paraCentavos(doc.valorConcedido) > (ciclosDepois.get(doc.ciclo)?.[doc.tipo].devidoCentavos || 0)
  ));

  return {
    pedido: { pedidoId, numeroPedido: pedido.numeroPedido, status: pedido.status, valor: pedido.valorTotal },
    compra,
    diferenca: paraReais(diferenca),
    antes: resumirEstado(antes),
    depois: resumirEstado(depois),
    cuponsConcedidos: Number(conta.cupons?.total || 0),
    cuponsNovos: Math.max(depois.cuponsDevidos - cuponsAutomaticos(conta), 0),
    exigeRevisao: reduzCupons || reduzBonificacao,
    bloqueios,
    alertas,
    podeAplicar: bloqueios.length === 0,
    habilitada: substituicaoHabilitada(),
  };
};

// Tudo em uma transação: a compra entra, o pedido deixa de contar e o saldo é
// recalculado juntos. Redução de benefícios não invalida nada: abre revisão pendente.
export const aplicarSubstituicao = async ({ pedidoId, dados, motivo, confirmacao, usuario, config = NATAL_2026, now = new Date() }) => {
  if (usuario?.tipo !== "admin") throw new NatalError(403, "Somente o Administrador substitui a origem de uma compra.", "sem_permissao");
  if (!substituicaoHabilitada()) throw new NatalError(403, "A substituição de origem ainda não foi autorizada.", "substituicao_desabilitada");
  await exigirCumulativoAtivo();
  await garantirIndicesNatal();
  const texto = typeof motivo === "string" ? motivo.trim().slice(0, 500) : "";
  if (texto.length < 10) throw new NatalError(400, "Informe o motivo da substituição (10 a 500 caracteres).", "motivo_invalido");
  const compra = validarCompra(dados, config, now);
  const referenciaChave = normalizarReferencia(compra.referencia);
  const autor = buildAutorNatal(usuario);

  return executarTransacaoNatal(async (session) => {
    const existente = await NatalSubstituicaoCompra.findOne({ campanha: CAMPANHA, pedidoId }).session(session);
    if (existente) {
      if (existente.referenciaChave === referenciaChave) return { substituicao: existente, repetida: true };
      throw new NatalError(409, "Este pedido já foi substituído por outra compra.", "substituicao_existente");
    }
    const pedido = await Pedido.findById(pedidoId).select("numeroPedido clienteId valorTotal").session(session).lean();
    if (!pedido) throw new NatalError(404, "Pedido não encontrado.", "nao_encontrado");
    const clienteId = pedido.clienteId;
    const compras = await coletarCompras(clienteId, { session, config });
    if (!compras.some((item) => item.id === String(pedidoId))) {
      throw new NatalError(409, "Este pedido não conta para o acumulado da campanha.", "pedido_nao_contabilizado");
    }
    if (await NatalCompraExterna.exists({ clienteId, referenciaChave, ativa: true }).session(session)) {
      throw new NatalError(409, "Esta referência já foi registrada para o distribuidor.", "referencia_duplicada");
    }

    const totalAntes = somarCentavos(compras);
    const totalDepois = totalAntes - paraCentavos(pedido.valorTotal) + paraCentavos(compra.valor);
    if (confirmacao?.acumuladoDepois === undefined || paraCentavos(confirmacao.acumuladoDepois) !== totalDepois) {
      throw new NatalError(409, "Os valores mudaram desde a prévia. Gere a prévia novamente.", "previa_desatualizada");
    }

    const [criada] = await NatalCompraExterna.create([{
      clienteId,
      ...compra,
      referenciaChave,
      status: "validada",
      registradoPor: autor,
      registradoEm: now,
      validadoEm: now,
      substituiPedidoId: pedidoId,
      historico: [{ em: now, acao: "registrada", motivo: texto, autor }, { em: now, acao: "validada", autor }],
    }], { session });
    const [substituicao] = await NatalSubstituicaoCompra.create([{
      clienteId,
      pedidoId,
      numeroPedido: pedido.numeroPedido,
      compraExternaId: criada._id,
      referenciaChave,
      valorPedido: pedido.valorTotal,
      valorCompra: compra.valor,
      diferenca: paraReais(paraCentavos(compra.valor) - paraCentavos(pedido.valorTotal)),
      acumuladoAntes: paraReais(totalAntes),
      acumuladoDepois: paraReais(totalDepois),
      motivo: texto,
      em: now,
      autor,
    }], { session });
    await NatalAuditoria.create([{
      acao: "compra_origem_substituida",
      em: now,
      autor,
      clienteId,
      pedidoId,
      detalhes: {
        substituicaoId: substituicao._id,
        compraExternaId: criada._id,
        referencia: compra.referencia,
        valorPedido: pedido.valorTotal,
        valorCompra: compra.valor,
        acumuladoAntes: paraReais(totalAntes),
        acumuladoDepois: paraReais(totalDepois),
        motivo: texto,
      },
    }], { session });
    const recalculo = await recalcularConta({
      clienteId,
      usuario,
      origem: { tipo: "substituicao", pedidoId, numeroPedido: pedido.numeroPedido, compraExternaId: criada._id, referencia: compra.referencia },
      now,
      config,
      session,
    });
    return { substituicao, compra: criada, repetida: false, ...recalculo };
  });
};
