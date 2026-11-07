import { NATAL_2026 } from "../config/natalPremiado2026.js";
import NatalBonificacao from "../models/NatalBonificacao.js";
import NatalConta from "../models/NatalConta.js";
import NatalLote from "../models/NatalLote.js";
import NatalMovimentoCupom from "../models/NatalMovimentoCupom.js";
import NatalCupom from "../models/NatalCupom.js";
import Pedido from "../models/Pedido.js";
import Usuario from "../models/Usuario.js";
import { saldoConta, STATUS_FORA_DA_CAMPANHA } from "../utils/natalCampanha.js";
import { alocarComprasNosCiclos, calcularEstadoCumulativo, paraCentavos, paraReais } from "../utils/natalCumulativo.js";
import { NatalError, obterModoCumulativo } from "./natalBaseService.js";
import { listarComprasExternas } from "./natalCompraExternaService.js";
import { coletarCompras, cuponsAutomaticos, somarCentavos } from "./natalContaService.js";

const CAMPANHA = NATAL_2026.slug;
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Visão somente leitura. Sem conta gravada, os lotes antigos e as compras aprovadas
// compõem uma conta virtual, que nunca é salva e não concede nada.
export const carregarContaLeitura = async (clienteId, { config = NATAL_2026 } = {}) => {
  const conta = await NatalConta.findOne({ campanha: CAMPANHA, clienteId }).lean();
  if (conta) return conta;
  const [lotes, compras, usuario] = await Promise.all([
    NatalLote.find({ clienteId }).select("status cuponsConcedidos contadores distribuidorNome").lean(),
    coletarCompras(clienteId, { config }),
    Usuario.findById(clienteId).select("nomeFantasia razaoSocial nomeResponsavel").lean(),
  ]);
  const legado = lotes.filter((lote) => lote.status === "ativo").reduce((soma, lote) => soma + Number(lote.cuponsConcedidos || 0), 0);
  const somarContador = (campo) => lotes.reduce((soma, lote) => soma + Number(lote.contadores?.[campo] || 0), 0);
  return {
    virtual: true,
    clienteId,
    distribuidorNome: lotes[0]?.distribuidorNome || usuario?.nomeFantasia || usuario?.razaoSocial || usuario?.nomeResponsavel,
    cupons: { legado, conquistados: 0, reduzidos: 0, ajustes: 0, total: legado },
    contadores: {
      aprovados: somarContador("aprovados"),
      pendentes: somarContador("pendentes"),
      rejeitados: somarContador("rejeitados"),
      cancelados: somarContador("cancelados"),
      invalidados: somarContador("invalidados"),
      invalidadosRevisao: somarContador("invalidadosRevisao"),
    },
    acumulado: { totalCompras: paraReais(somarCentavos(compras)) },
    revisoes: [],
  };
};

const faixaResumo = (faixa) => (faixa ? {
  nivel: faixa.nivel,
  valorMinimo: faixa.valorMinimo,
  cupons: faixa.cupons,
  marketingPercentual: faixa.marketingPercentual,
  produtosPercentual: faixa.produtosPercentual,
} : null);

const totaisBonificacao = (docs) => {
  const somar = (tipo, campo) => docs.filter((doc) => doc.tipo === tipo).reduce((soma, doc) => soma + paraCentavos(doc[campo]), 0);
  const montar = (tipo) => {
    const concedido = somar(tipo, "valorConcedido");
    const entregue = somar(tipo, "valorEntregue");
    return {
      devido: paraReais(somar(tipo, "valorDevido")),
      concedido: paraReais(concedido),
      entregue: paraReais(entregue),
      pendente: paraReais(Math.max(concedido - entregue, 0)),
    };
  };
  return { produtos: montar("produtos"), marketing: montar("marketing") };
};

// O link principal é o mais antigo em uso: quem já divulgou um link continua com ele.
// Novos pedidos e ciclos não mudam essa escolha, porque nenhum link novo é criado.
const linksDaConta = (conta, lotes) => {
  const antigos = [...lotes]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((lote) => ({
      tipo: "pedido",
      codigoPublico: lote.codigoPublico,
      numeroPedido: lote.numeroPedido,
      pedidoId: lote.pedidoId,
      status: lote.status,
    }));
  const proprio = conta.codigoPublico ? [{ tipo: "distribuidor", codigoPublico: conta.codigoPublico, status: "ativo" }] : [];
  const links = [...antigos, ...proprio];
  const principal = links.find((link) => link.status === "ativo");
  return links.map((link) => ({ ...link, principal: link === principal }));
};

// Visão consolidada de uma conta. O distribuidor vê o próprio saldo e os totais;
// justificativas e extrato completo ficam no detalhe da gestão.
export const serializarConta = (conta, { lotes = [], bonificacoes = [], incluirLinks = true } = {}) => {
  const estado = calcularEstadoCumulativo(paraCentavos(conta.acumulado?.totalCompras));
  const saldo = saldoConta(conta);
  return {
    _id: conta._id,
    clienteId: conta.clienteId,
    distribuidorNome: conta.distribuidorNome,
    migrada: !conta.virtual,
    compras: {
      total: conta.acumulado?.totalCompras || 0,
      ciclosConcluidos: estado.ciclosConcluidos,
      cicloAtual: estado.cicloAtual,
      acumuladoCiclo: paraReais(estado.acumuladoCicloCentavos),
      faixaAtual: faixaResumo(estado.faixaAtual),
      proximaFaixa: faixaResumo(estado.proximaFaixa),
      restanteProximaFaixa: paraReais(estado.restanteProximaFaixaCentavos),
    },
    cupons: {
      total: saldo.concedidos,
      automaticos: cuponsAutomaticos(conta),
      legado: conta.cupons?.legado || 0,
      conquistados: conta.cupons?.conquistados || 0,
      reduzidos: conta.cupons?.reduzidos || 0,
      ajustes: conta.cupons?.ajustes || 0,
      devidosPeloCalculo: estado.cuponsDevidos,
      disponiveis: saldo.disponivel,
      utilizados: saldo.aprovados,
      pendentes: saldo.pendentes,
      rejeitados: saldo.rejeitados,
      cancelados: saldo.cancelados,
      invalidados: saldo.invalidados + saldo.invalidadosRevisao,
    },
    bonificacoes: totaisBonificacao(bonificacoes),
    revisaoPendente: conta.revisaoPendente || undefined,
    ...(incluirLinks ? { links: linksDaConta(conta, lotes) } : {}),
  };
};

export const listarDistribuidores = async ({ busca } = {}) => {
  const filtro = { campanha: CAMPANHA };
  const texto = typeof busca === "string" ? busca.trim().slice(0, 80) : "";
  if (texto) filtro.distribuidorNome = { $regex: escapeRegex(texto), $options: "i" };
  const gravadas = await NatalConta.find(filtro).sort({ "cupons.total": -1, distribuidorNome: 1 }).limit(500).lean().maxTimeMS(8000);
  const clientesDosLotes = await NatalLote.distinct("clienteId", {
    clienteId: { $nin: (await NatalConta.find({ campanha: CAMPANHA }).select("clienteId").lean()).map((conta) => conta.clienteId) },
    ...(texto ? { distribuidorNome: filtro.distribuidorNome } : {}),
  });
  const virtuais = await Promise.all(clientesDosLotes.map((clienteId) => carregarContaLeitura(clienteId)));
  const contas = [...gravadas, ...virtuais];
  const ids = contas.map((conta) => conta.clienteId);
  const [lotes, bonificacoes] = await Promise.all([
    NatalLote.find({ clienteId: { $in: ids } }).select("clienteId codigoPublico numeroPedido pedidoId status createdAt").lean(),
    NatalBonificacao.find({ campanha: CAMPANHA, clienteId: { $in: ids } }).select("clienteId tipo valorDevido valorConcedido valorEntregue").lean(),
  ]);
  return contas.map((conta) => serializarConta(conta, {
    lotes: lotes.filter((lote) => String(lote.clienteId) === String(conta.clienteId)),
    bonificacoes: bonificacoes.filter((doc) => String(doc.clienteId) === String(conta.clienteId)),
  }));
};

const serializarCompraDetalhe = (compra) => ({
  id: compra.id,
  tipo: compra.tipo,
  pedidoId: compra.pedidoId,
  referencia: compra.referencia,
  status: compra.status,
  data: compra.data,
  valor: paraReais(compra.valorCentavos),
  ciclos: (compra.ciclos || []).map((item) => ({ ciclo: item.ciclo, valor: paraReais(item.valorCentavos) })),
});

const serializarBonificacao = (doc) => ({
  _id: doc._id,
  ciclo: doc.ciclo,
  tipo: doc.tipo,
  nivelFaixa: doc.nivelFaixa,
  percentual: doc.percentual,
  valorAcumulado: doc.valorAcumulado,
  valorDevido: doc.valorDevido,
  valorConcedido: doc.valorConcedido,
  valorEntregue: doc.valorEntregue,
  saldoPendente: doc.saldoPendente,
  historico: (doc.historico || []).map((evento) => ({
    em: evento.em,
    tipo: evento.tipo,
    nivelFaixa: evento.nivelFaixa,
    valorAcumulado: evento.valorAcumulado,
    percentual: evento.percentual,
    valorDevido: evento.valorDevido,
    valorAnterior: evento.valorAnterior,
    complemento: evento.complemento,
    valorEntregue: evento.valorEntregue,
    origem: evento.origem,
    observacao: evento.observacao,
    autorNome: evento.autor?.usuarioNome,
  })),
});

const serializarRevisaoConta = (revisao, { gestor }) => ({
  _id: revisao._id,
  em: revisao.em,
  decisao: revisao.decisao,
  autorNome: revisao.autor?.usuarioNome,
  valorAnterior: revisao.valorAnterior,
  valorNovo: revisao.valorNovo,
  faixaAnterior: revisao.faixaAnterior,
  faixaDoNovoValor: revisao.faixaDoNovoValor,
  faixaResultante: revisao.faixaResultante,
  aprovadasAntes: revisao.aprovadasAntes,
  pendentesNoMomento: revisao.pendentesNoMomento,
  numeroPedido: revisao.numeroPedido,
  totalInvalidadas: (revisao.participacoesInvalidadas || []).length,
  ajusteBonificacaoPendente: revisao.ajusteBonificacaoPendente,
  ...(gestor ? {
    justificativa: revisao.justificativa,
    participacoesInvalidadas: revisao.participacoesInvalidadas || [],
  } : {}),
});

// Detalhe do distribuidor: de quais pedidos vieram os valores e como cada ciclo fechou.
export const detalharDistribuidor = async ({ clienteId, gestor = true }) => {
  if (!await Usuario.exists({ _id: clienteId, tipo: "cliente" }) && !await NatalLote.exists({ clienteId })) {
    throw new NatalError(404, "Distribuidor não encontrado.", "nao_encontrado");
  }
  const conta = await carregarContaLeitura(clienteId);
  const [lotes, bonificacoes, movimentos, compras, comprasExternas] = await Promise.all([
    NatalLote.find({ clienteId }).sort({ createdAt: 1 }).lean(),
    NatalBonificacao.find({ campanha: CAMPANHA, clienteId }).sort({ ciclo: 1, tipo: 1 }).lean(),
    NatalMovimentoCupom.find({ campanha: CAMPANHA, clienteId }).sort({ em: -1, _id: -1 }).limit(200).lean(),
    coletarCompras(clienteId),
    gestor ? listarComprasExternas({ clienteId }) : Promise.resolve([]),
  ]);
  const estado = calcularEstadoCumulativo(somarCentavos(compras));
  return {
    ...serializarConta(conta, { lotes, bonificacoes }),
    ciclos: estado.ciclos.map((ciclo) => ({
      numero: ciclo.numero,
      acumulado: paraReais(ciclo.acumuladoCentavos),
      concluido: ciclo.concluido,
      faixa: faixaResumo(ciclo.faixa),
      cupons: ciclo.cupons,
      produtos: { percentual: ciclo.produtos.percentual, devido: paraReais(ciclo.produtos.devidoCentavos) },
      marketing: { percentual: ciclo.marketing.percentual, devido: paraReais(ciclo.marketing.devidoCentavos) },
    })),
    comprasParticipantes: alocarComprasNosCiclos(compras).map(serializarCompraDetalhe),
    bonificacoesDetalhe: bonificacoes.map(serializarBonificacao),
    revisoes: (conta.revisoes || []).map((revisao) => serializarRevisaoConta(revisao, { gestor })).reverse(),
    ...(gestor ? {
      comprasExternas,
      movimentos: movimentos.map((movimento) => ({
        _id: movimento._id,
        tipo: movimento.tipo,
        quantidade: movimento.quantidade,
        saldoTotalApos: movimento.saldoTotalApos,
        motivo: movimento.motivo,
        origem: movimento.origem,
        em: movimento.em,
        autorNome: movimento.autor?.usuarioNome,
      })),
    } : {}),
  };
};

const motivosDaConta = ({ conta, estado, bonificacoes, aprovados }) => {
  const motivos = [];
  if (paraCentavos(conta.acumulado?.totalCompras) !== estado.totalCentavos) motivos.push("acumulado_defasado");
  if (cuponsAutomaticos(conta) < estado.cuponsDevidos) motivos.push("cupons_pendentes");
  const faltaBonificacao = estado.ciclos.some((ciclo) => ["produtos", "marketing"].some((tipo) => {
    const doc = bonificacoes.find((item) => item.ciclo === ciclo.numero && item.tipo === tipo);
    return paraCentavos(doc?.valorConcedido) < ciclo[tipo].devidoCentavos;
  }));
  if (faltaBonificacao) motivos.push("bonificacao_pendente");
  if (Number(conta.contadores?.aprovados || 0) !== aprovados) motivos.push("contadores_divergentes");
  return motivos;
};

// Compara o que está gravado com o que os registros atuais determinam, sem depender de
// logs nem gravar nada. Faixa não atingida não é pendência: o acumulado confere. Benefício
// acima do cálculo também não é: esse caso segue a revisão administrativa.
export const detectarPendenciasSincronizacao = async ({ config = NATAL_2026 } = {}) => {
  if (await obterModoCumulativo() !== "ativo") return [];
  const [contas, lotes, pedidos, bonificacoes, participacoes] = await Promise.all([
    NatalConta.find({ campanha: config.slug }).select("clienteId distribuidorNome cupons contadores acumulado").lean(),
    NatalLote.find({}).select("clienteId distribuidorNome").lean(),
    Pedido.find({
      status: { $nin: STATUS_FORA_DA_CAMPANHA },
      createdAt: { $gte: config.inicio, $lte: config.fimCadastros },
    }).select("clienteId nomeFantasiaCliente razaoSocialCliente").lean().maxTimeMS(8000),
    NatalBonificacao.find({ campanha: config.slug }).select("clienteId ciclo tipo valorConcedido").lean(),
    // Cupons válidos por distribuidor (cada cupom é uma unidade do saldo utilizado).
    NatalCupom.aggregate([{ $match: { status: "valido" } }, { $group: { _id: "$clienteId", total: { $sum: 1 } } }]),
  ]);
  const contaPorCliente = new Map(contas.map((conta) => [String(conta.clienteId), conta]));
  const aprovadosPorCliente = new Map(participacoes.map((item) => [String(item._id), item.total]));
  const clientes = [...new Set([...contas, ...lotes, ...pedidos].map((item) => String(item.clienteId)))];

  const pendencias = [];
  for (const clienteId of clientes) {
    const conta = contaPorCliente.get(clienteId);
    const estado = calcularEstadoCumulativo(somarCentavos(await coletarCompras(clienteId, { config })), config);
    const motivos = conta
      ? motivosDaConta({
        conta,
        estado,
        bonificacoes: bonificacoes.filter((item) => String(item.clienteId) === clienteId),
        aprovados: aprovadosPorCliente.get(clienteId) || 0,
      })
      : ["conta_ausente"];
    if (motivos.length === 0) continue;
    const pedido = pedidos.find((item) => String(item.clienteId) === clienteId);
    pendencias.push({
      clienteId,
      distribuidorNome: conta?.distribuidorNome || lotes.find((lote) => String(lote.clienteId) === clienteId)?.distribuidorNome ||
        pedido?.nomeFantasiaCliente || pedido?.razaoSocialCliente,
      motivos,
    });
  }
  return pendencias;
};

// Distribuidores cadastrados, inclusive os que ainda não têm conta na campanha.
export const buscarClientesDistribuidores = async (busca) => {
  const texto = typeof busca === "string" ? busca.trim().slice(0, 80) : "";
  if (texto.length < 2) return [];
  const regex = { $regex: escapeRegex(texto), $options: "i" };
  const clientes = await Usuario.find({
    tipo: "cliente",
    $or: [{ nomeFantasia: regex }, { razaoSocial: regex }, { nomeResponsavel: regex }],
  }).select("nomeFantasia razaoSocial nomeResponsavel").sort({ nomeFantasia: 1 }).limit(20).lean().maxTimeMS(5000);
  return clientes.map((cliente) => ({
    clienteId: cliente._id,
    nome: cliente.nomeFantasia || cliente.razaoSocial || cliente.nomeResponsavel,
  }));
};
