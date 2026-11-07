import mongoose from "mongoose";
import { NATAL_2026 } from "../config/natalPremiado2026.js";
import NatalAuditoria from "../models/NatalAuditoria.js";
import NatalBonificacao, { TIPOS_BONIFICACAO } from "../models/NatalBonificacao.js";
import NatalCompraExterna from "../models/NatalCompraExterna.js";
import NatalConta from "../models/NatalConta.js";
import NatalLote from "../models/NatalLote.js";
import NatalMovimentoCupom from "../models/NatalMovimentoCupom.js";
import NatalParticipacao from "../models/NatalParticipacao.js";
import NatalSubstituicaoCompra from "../models/NatalSubstituicaoCompra.js";
import Pedido from "../models/Pedido.js";
import Usuario from "../models/Usuario.js";
import { buildAutorNatal } from "../models/natalSchemas.js";
import { isGestorCampanha, STATUS_FORA_DA_CAMPANHA } from "../utils/natalCampanha.js";
import { calcularEstadoCumulativo, paraCentavos, paraReais } from "../utils/natalCumulativo.js";
import {
  exigirCumulativoAtivo,
  executarTransacaoNatal,
  garantirIndicesNatal,
  gerarCodigoPublico,
  NatalError,
  obterModoCumulativo,
  RepetirTransacaoNatal,
  verificarListaAberta,
} from "./natalBaseService.js";
import { contarUnidadesCupom } from "./natalDistribuicaoService.js";

const CAMPANHA = NATAL_2026.slug;

export const cuponsAutomaticos = (conta) => (
  Number(conta?.cupons?.legado || 0) + Number(conta?.cupons?.conquistados || 0) - Number(conta?.cupons?.reduzidos || 0)
);

const clienteObjectId = (clienteId) => new mongoose.Types.ObjectId(String(clienteId));

// Unidades de cupom por situação (cadastros antigos de 1 cupom contam 1 unidade).
const contarParticipacoes = (clienteId, session) => contarUnidadesCupom({ clienteId: clienteObjectId(clienteId) }, session);

const nomeDoDistribuidor = async (clienteId, lotes, session) => {
  if (lotes.length > 0) return { nome: lotes[0].distribuidorNome, razao: lotes[0].distribuidorRazaoSocial };
  const usuario = await Usuario.findById(clienteId).select("nomeFantasia razaoSocial nomeResponsavel").session(session).lean();
  if (usuario) return { nome: usuario.nomeFantasia || usuario.razaoSocial || usuario.nomeResponsavel, razao: usuario.razaoSocial };
  const pedido = await Pedido.findOne({ clienteId }).select("nomeFantasiaCliente razaoSocialCliente nomeResponsavel").session(session).lean();
  return { nome: pedido?.nomeFantasiaCliente || pedido?.razaoSocialCliente || pedido?.nomeResponsavel, razao: pedido?.razaoSocialCliente };
};

const instantaneoDoEstado = (estado, now) => ({
  totalCompras: paraReais(estado.totalCentavos),
  ciclosConcluidos: estado.ciclosConcluidos,
  cicloAtual: estado.cicloAtual,
  acumuladoCiclo: paraReais(estado.acumuladoCicloCentavos),
  nivelFaixa: estado.faixaAtual.nivel,
  cuponsDevidos: estado.cuponsDevidos,
  atualizadoEm: now,
});

// Cria a conta do distribuidor e reconhece os lotes antigos ainda não importados, sem
// conceder nada. Só roda na migração controlada ou, depois da ativação, em operações
// de escrita. Lotes, cupons e cadastros não são alterados, e cada lote entra uma
// única vez (lotesImportados e a chave do movimento).
const importarConta = async ({ clienteId, usuario, now, session }) => {
  let conta = await NatalConta.findOne({ campanha: CAMPANHA, clienteId }).session(session);
  const lotes = await NatalLote.find({ clienteId, _id: { $nin: conta?.lotesImportados || [] } }).session(session).lean();
  if (conta && lotes.length === 0) return conta;

  const autor = buildAutorNatal(usuario);
  if (!conta) {
    const { nome, razao } = await nomeDoDistribuidor(clienteId, lotes, session);
    const possuiLinkAntigo = lotes.some((lote) => lote.status === "ativo");
    [conta] = await NatalConta.create([{
      campanha: CAMPANHA,
      clienteId,
      distribuidorNome: nome,
      distribuidorRazaoSocial: razao,
      ...(possuiLinkAntigo ? {} : { codigoPublico: gerarCodigoPublico() }),
      criadoPor: autor,
    }], { session });
  }

  const estado = calcularEstadoCumulativo(somarCentavos(await coletarCompras(clienteId, { session })));
  const totalCompras = estado.totalCentavos;

  if (lotes.length > 0) {
    const ativos = lotes.filter((lote) => lote.status === "ativo");
    const legado = ativos.reduce((soma, lote) => soma + Number(lote.cuponsConcedidos || 0), 0);
    const contadores = await contarParticipacoes(clienteId, session);
    const totalDepois = Number(conta.cupons?.total || 0) + legado;
    // Cupons antigos acima do novo cálculo são reconhecidos como estão: a divergência
    // vai para o relatório e nunca vira pendência ou retirada automática.
    const legadoAcimaDoCalculo = cuponsAutomaticos(conta) + legado > estado.cuponsDevidos;
    await NatalConta.updateOne(
      { _id: conta._id },
      {
        $inc: { "cupons.legado": legado, "cupons.total": legado },
        $set: { contadores, ...(legadoAcimaDoCalculo ? { revisaoReferenciaCentavos: totalCompras } : {}) },
        $addToSet: { lotesImportados: { $each: lotes.map((lote) => lote._id) } },
      },
      { session }
    );
    await NatalMovimentoCupom.create(ativos.map((lote) => ({
      clienteId,
      chave: `legado:${lote._id}`,
      tipo: "legado",
      quantidade: Number(lote.cuponsConcedidos || 0),
      saldoTotalApos: totalDepois,
      motivo: `Cupons concedidos ao pedido ${lote.numeroPedido} antes do modelo cumulativo`,
      origem: { tipo: "lote", loteId: lote._id, pedidoId: lote.pedidoId, numeroPedido: lote.numeroPedido },
      em: now,
      autor,
    })), { session, ordered: true });
  }

  await NatalConta.updateOne({ _id: conta._id }, { $set: { acumulado: instantaneoDoEstado(estado, now) } }, { session });

  await NatalAuditoria.create([{
    acao: "conta_criada",
    em: now,
    autor,
    clienteId,
    detalhes: { lotesImportados: lotes.length, cuponsLegados: lotes.filter((lote) => lote.status === "ativo").reduce((soma, lote) => soma + Number(lote.cuponsConcedidos || 0), 0) },
  }], { session });

  return NatalConta.findById(conta._id).session(session);
};

export const garantirConta = async ({ clienteId, usuario, now = new Date(), session }) => {
  if (session) return importarConta({ clienteId, usuario, now, session });
  await garantirIndicesNatal();
  const conta = await NatalConta.findOne({ campanha: CAMPANHA, clienteId });
  const novos = await NatalLote.countDocuments({ clienteId, _id: { $nin: conta?.lotesImportados || [] } });
  if (conta && novos === 0) return conta;
  return executarTransacaoNatal((tx) => importarConta({ clienteId, usuario, now, session: tx }));
};

const pedidoParaCompra = (pedido) => ({
  id: String(pedido._id),
  tipo: "pedido",
  pedidoId: pedido._id,
  referencia: pedido.numeroPedido,
  status: pedido.status,
  valorCentavos: paraCentavos(pedido.valorTotal),
  data: pedido.aprovacao?.aprovadoEm || pedido.createdAt,
});

// Compras que contam para o acumulado: pedidos aprovados na campanha e externas
// validadas. Pedido substituído continua no sistema, mas sai da conta: a compra que o
// substituiu entra no lugar, então as duas origens nunca somam juntas.
export const coletarCompras = async (clienteId, { session, config = NATAL_2026 } = {}) => {
  const substituidos = await NatalSubstituicaoCompra.find({ campanha: CAMPANHA, clienteId }).select("pedidoId").session(session || null).lean();
  const pedidos = await Pedido.find({
    clienteId,
    _id: { $nin: substituidos.map((item) => item.pedidoId) },
    status: { $nin: STATUS_FORA_DA_CAMPANHA },
    createdAt: { $gte: config.inicio, $lte: config.fimCadastros },
  }).select("_id numeroPedido valorTotal status aprovacao createdAt").session(session || null).lean();

  const externas = await NatalCompraExterna.find({ clienteId, status: "validada" })
    .select("_id valor data referencia").session(session || null).lean();

  return [
    ...pedidos.map(pedidoParaCompra),
    ...externas.map((compra) => ({
      id: String(compra._id),
      tipo: "compra_externa",
      compraExternaId: compra._id,
      referencia: compra.referencia,
      status: "validada",
      valorCentavos: paraCentavos(compra.valor),
      data: new Date(`${compra.data}T12:00:00-03:00`),
    })),
  ];
};

export const somarCentavos = (lista) => lista.reduce((soma, compra) => soma + compra.valorCentavos, 0);

const origemPadrao = Object.freeze({ tipo: "reconciliacao" });

const atualizarBonificacoes = async ({ clienteId, estado, origem, autor, now, session }) => {
  const docs = await NatalBonificacao.find({ campanha: CAMPANHA, clienteId }).session(session);
  const porChave = new Map(docs.map((doc) => [`${doc.ciclo}:${doc.tipo}`, doc]));
  const complementos = [];
  const ciclos = new Map(estado.ciclos.map((ciclo) => [ciclo.numero, ciclo]));
  const ultimoCiclo = Math.max(estado.ciclos.length, ...docs.map((doc) => doc.ciclo), 0);

  for (let numero = 1; numero <= ultimoCiclo; numero += 1) {
    const ciclo = ciclos.get(numero);
    for (const tipo of TIPOS_BONIFICACAO) {
      const devido = ciclo ? ciclo[tipo].devidoCentavos : 0;
      const percentual = ciclo ? ciclo[tipo].percentual : 0;
      const nivelFaixa = ciclo?.faixa.nivel || 0;
      const acumulado = ciclo?.acumuladoCentavos || 0;
      let doc = porChave.get(`${numero}:${tipo}`);
      if (!doc && devido === 0) continue;
      if (!doc) doc = new NatalBonificacao({ clienteId, ciclo: numero, tipo });

      const anterior = paraCentavos(doc.valorConcedido);
      const entregue = paraCentavos(doc.valorEntregue);
      const mudouCalculo = paraCentavos(doc.valorDevido) !== devido || paraCentavos(doc.valorAcumulado) !== acumulado;
      if (devido <= anterior && !mudouCalculo && !doc.isNew) continue;

      const complemento = Math.max(devido - anterior, 0);
      const concedido = anterior + complemento;
      doc.nivelFaixa = nivelFaixa;
      doc.percentual = percentual;
      doc.valorAcumulado = paraReais(acumulado);
      doc.valorDevido = paraReais(devido);
      doc.valorConcedido = paraReais(concedido);
      doc.saldoPendente = paraReais(concedido - entregue);
      doc.historico.push({
        em: now,
        tipo: complemento > 0 ? "complemento" : "recalculo",
        nivelFaixa,
        valorAcumulado: paraReais(acumulado),
        percentual,
        valorDevido: paraReais(devido),
        valorAnterior: paraReais(anterior),
        complemento: paraReais(complemento),
        valorEntregue: paraReais(entregue),
        origem,
        autor,
      });
      await doc.save({ session });
      if (complemento > 0) complementos.push({ ciclo: numero, tipo, complemento: paraReais(complemento), devido: paraReais(devido), anterior: paraReais(anterior), percentual });
    }
  }
  return complementos;
};

const totalConcedidoAcimaDoDevido = async ({ clienteId, estado, session }) => {
  const docs = await NatalBonificacao.find({ campanha: CAMPANHA, clienteId }).select("ciclo tipo valorConcedido").session(session || null).lean();
  const ciclos = new Map(estado.ciclos.map((ciclo) => [ciclo.numero, ciclo]));
  return docs.some((doc) => paraCentavos(doc.valorConcedido) > (ciclos.get(doc.ciclo)?.[doc.tipo].devidoCentavos || 0));
};

// Benefícios acima do cálculo exigem decisão, salvo se o total ainda respeita a
// referência aceita antes (decisão de manter ou divergência reconhecida na migração).
export const avaliarExcesso = async ({ conta, clienteId, estado, session }) => {
  const excesso = cuponsAutomaticos(conta) > estado.cuponsDevidos ||
    await totalConcedidoAcimaDoDevido({ clienteId, estado, session });
  const referencia = conta.revisaoReferenciaCentavos;
  return { excesso, exigeDecisao: excesso && (referencia === undefined || referencia === null || estado.totalCentavos < referencia) };
};

const corpoRecalculo = async ({ clienteId, usuario, origem, now, config, session }) => {
  const contaInicial = await garantirConta({ clienteId, usuario, now, session });
  const compras = await coletarCompras(clienteId, { session, config });
  const totalCompras = somarCentavos(compras);
  const estado = calcularEstadoCumulativo(totalCompras, config);
  const autor = buildAutorNatal(usuario);
  const automatico = cuponsAutomaticos(contaInicial);
  const cuponsLiberados = Math.max(estado.cuponsDevidos - automatico, 0);

  const complementos = await atualizarBonificacoes({ clienteId, estado, origem, autor, now, session });

  const set = {};
  const unset = {};
  const inc = {};
  if (cuponsLiberados > 0) {
    inc["cupons.conquistados"] = cuponsLiberados;
    inc["cupons.total"] = cuponsLiberados;
    await NatalMovimentoCupom.create([{
      clienteId,
      chave: `conquista:${clienteId}:${contaInicial.geracao}:${automatico + cuponsLiberados}`,
      tipo: "conquista",
      quantidade: cuponsLiberados,
      saldoTotalApos: Number(contaInicial.cupons.total) + cuponsLiberados,
      motivo: `Compras acumuladas de R$ ${paraReais(totalCompras).toFixed(2)}: direito a ${estado.cuponsDevidos} cupons`,
      origem,
      em: now,
      autor,
    }], { session });
  }

  const contaParaAvaliar = { ...contaInicial.toObject(), cupons: { ...contaInicial.cupons.toObject(), conquistados: Number(contaInicial.cupons.conquistados) + cuponsLiberados } };
  const { excesso, exigeDecisao } = await avaliarExcesso({ conta: contaParaAvaliar, clienteId, estado, session });
  const totalAntes = paraCentavos(contaInicial.acumulado?.totalCompras);
  let novaPendencia = false;

  if (exigeDecisao) {
    const dadosPendencia = {
      detectadaEm: contaInicial.revisaoPendente?.detectadaEm || now,
      origem: origem.tipo,
      numeroPedido: origem.numeroPedido,
      valorAnterior: contaInicial.revisaoPendente?.valorAnterior ?? paraReais(totalAntes),
      valorNovo: paraReais(totalCompras),
      cuponsConcedidos: automatico + cuponsLiberados,
      cuponsDevidos: estado.cuponsDevidos,
    };
    if (!contaInicial.revisaoPendente || paraCentavos(contaInicial.revisaoPendente.valorNovo) !== totalCompras) {
      set.revisaoPendente = dadosPendencia;
      novaPendencia = !contaInicial.revisaoPendente;
    }
  } else if (!excesso) {
    if (contaInicial.revisaoPendente) unset.revisaoPendente = 1;
    if (contaInicial.revisaoReferenciaCentavos !== undefined) unset.revisaoReferenciaCentavos = 1;
  }

  const { atualizadoEm, ...instantaneo } = instantaneoDoEstado(estado, now);
  const instantaneoMudou = Object.entries(instantaneo).some(([campo, valor]) => contaInicial.acumulado?.[campo] !== valor);
  if (instantaneoMudou) set.acumulado = { ...instantaneo, atualizadoEm };

  const operacao = {
    ...(Object.keys(set).length ? { $set: set } : {}),
    ...(Object.keys(unset).length ? { $unset: unset } : {}),
    ...(Object.keys(inc).length ? { $inc: inc } : {}),
  };
  const conta = Object.keys(operacao).length === 0
    ? contaInicial
    : await NatalConta.findOneAndUpdate({ _id: contaInicial._id }, operacao, { returnDocument: "after", session, runValidators: true });

  const auditorias = [];
  if (cuponsLiberados > 0) {
    auditorias.push({ acao: "cupons_liberados", em: now, autor, clienteId, pedidoId: origem.pedidoId, detalhes: { cuponsLiberados, totalCompras: paraReais(totalCompras), cuponsDevidos: estado.cuponsDevidos, origem } });
  }
  if (complementos.length > 0) {
    auditorias.push({ acao: "bonificacao_calculada", em: now, autor, clienteId, pedidoId: origem.pedidoId, detalhes: { complementos, origem } });
  }
  if (novaPendencia) {
    auditorias.push({ acao: "revisao_pendente", em: now, autor, clienteId, pedidoId: origem.pedidoId, detalhes: set.revisaoPendente });
  }
  if (auditorias.length > 0) await NatalAuditoria.create(auditorias, { session, ordered: true });

  return { conta, estado, cuponsLiberados, complementos };
};

// Ponto único do cálculo cumulativo. O resultado depende só das compras gravadas:
// reprocessar não concede nada, e apenas a diferença é liberada ao subir de faixa.
// Antes da ativação nada é calculado, salvo no processamento autorizado da migração.
export const recalcularConta = async ({
  clienteId,
  usuario = null,
  origem = origemPadrao,
  now = new Date(),
  config = NATAL_2026,
  session,
  processamentoAutorizado = false,
}) => {
  if (!processamentoAutorizado && await obterModoCumulativo(session) !== "ativo") return { ignorado: true };
  await garantirIndicesNatal();
  const args = { clienteId, usuario, origem, now, config };
  if (session) return corpoRecalculo({ ...args, session });
  return executarTransacaoNatal((tx) => corpoRecalculo({ ...args, session: tx }));
};

// Atualiza o saldo e, quando o cadastro veio de link antigo, o contador do lote.
export const incrementarContadores = async ({ clienteId, loteId, incrementos, session }) => {
  const prefixados = Object.fromEntries(Object.entries(incrementos).map(([campo, valor]) => [`contadores.${campo}`, valor]));
  await NatalConta.updateOne({ campanha: CAMPANHA, clienteId }, { $inc: prefixados }, session ? { session } : {});
  if (loteId) await NatalLote.updateOne({ _id: loteId }, { $inc: prefixados }, session ? { session } : {});
};

export const recalcularContadoresConta = async (clienteId) => {
  const contadores = await contarParticipacoes(clienteId);
  await NatalConta.updateOne({ campanha: CAMPANHA, clienteId }, { $set: { contadores } });
  return contadores;
};

const MOTIVO_MINIMO_AJUSTE = 10;
const LIMITE_AJUSTE = 100000;

// Ajuste manual: contado à parte dos cupons conquistados por compras, por isso o
// recálculo automático nunca o apaga nem o duplica.
export const ajustarCuponsConta = async ({ clienteId, quantidade, motivo, justificativa, chave, usuario, now = new Date() }) => {
  if (!isGestorCampanha(usuario)) throw new NatalError(403, "Somente o Comercial ou o Administrador ajustam cupons.", "sem_permissao");
  await exigirCumulativoAtivo();
  const valor = Number(quantidade);
  if (!Number.isInteger(valor) || valor === 0 || Math.abs(valor) > LIMITE_AJUSTE) {
    throw new NatalError(400, "Informe a quantidade a adicionar ou retirar (número inteiro diferente de zero).", "quantidade_invalida");
  }
  const texto = typeof motivo === "string" ? motivo.trim() : "";
  if (texto.length < MOTIVO_MINIMO_AJUSTE || texto.length > 500) {
    throw new NatalError(400, "Informe o motivo do ajuste (10 a 500 caracteres).", "motivo_invalido");
  }
  const cliente = await Usuario.findById(clienteId).select("tipo").lean();
  if (!cliente || cliente.tipo !== "cliente") throw new NatalError(404, "Distribuidor não encontrado.", "nao_encontrado");
  const fechamento = await verificarListaAberta(usuario, justificativa);
  const autor = buildAutorNatal(usuario);
  const chaveMovimento = `ajuste:${typeof chave === "string" && /^[\w-]{8,64}$/.test(chave) ? chave : new mongoose.Types.ObjectId()}`;

  return executarTransacaoNatal(async (session) => {
    const repetido = await NatalMovimentoCupom.findOne({ campanha: CAMPANHA, chave: chaveMovimento }).session(session);
    if (repetido) return { conta: await NatalConta.findOne({ campanha: CAMPANHA, clienteId }).session(session), movimento: repetido, repetido: true };

    const conta = await garantirConta({ clienteId, usuario, now, session });
    const total = Number(conta.cupons.total);
    const aprovados = Number(conta.contadores?.aprovados || 0);
    const pendentes = Number(conta.contadores?.pendentes || 0);
    // Cupons aguardando validação também ocupam saldo: a retirada não pode deixá-lo negativo.
    if (total + valor < aprovados + pendentes) {
      throw new NatalError(409, `Não é possível retirar ${Math.abs(valor)} cupons: ${aprovados + pendentes} já estão em uso ou aguardando validação e o saldo ficaria negativo.`, "ajuste_excede_saldo");
    }
    const atualizada = await NatalConta.findOneAndUpdate(
      { _id: conta._id, "cupons.total": total, "contadores.aprovados": aprovados, "contadores.pendentes": pendentes },
      { $inc: { "cupons.ajustes": valor, "cupons.total": valor } },
      { returnDocument: "after", session }
    );
    if (!atualizada) throw new RepetirTransacaoNatal();

    const [movimento] = await NatalMovimentoCupom.create([{
      clienteId,
      chave: chaveMovimento,
      tipo: "ajuste_manual",
      quantidade: valor,
      saldoTotalApos: total + valor,
      motivo: texto,
      origem: { tipo: "ajuste_manual" },
      em: now,
      autor,
    }], { session });
    await NatalAuditoria.create([{
      acao: "cupons_ajustados",
      em: now,
      autor,
      clienteId,
      aposFechamento: fechamento.aposFechamento,
      detalhes: { quantidade: valor, motivo: texto, saldoTotalAntes: total, saldoTotalDepois: total + valor, justificativa: fechamento.justificativa },
    }], { session });
    return { conta: atualizada, movimento, repetido: false };
  });
};
