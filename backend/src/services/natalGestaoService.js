import mongoose from "mongoose";
import { NATAL_2026 } from "../config/natalPremiado2026.js";
import NatalAuditoria from "../models/NatalAuditoria.js";
import NatalCupom from "../models/NatalCupom.js";
import NatalLote from "../models/NatalLote.js";
import NatalParticipacao from "../models/NatalParticipacao.js";
import { NatalCampanhaEstado, NatalExportacao } from "../models/NatalCampanhaEstado.js";
import { buildAutorNatal } from "../models/natalSchemas.js";
import { normalizeDigits } from "../utils/cadastroValidation.js";
import { PARTICIPACAO_STATUS, saldoLote } from "../utils/natalCampanha.js";
import { isValidObjectId } from "../utils/validation.js";
import {
  garantirIndicesNatal,
  NatalError,
  obterEstadoCampanha,
  registrarAuditoriaNatal,
} from "./natalBaseService.js";
import { recalcularContadoresLote } from "./natalLoteService.js";

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const textoBusca = (value, max = 80) => (typeof value === "string" ? value.trim().slice(0, max) : "");

const serializarRevisao = (revisao, { gestor }) => ({
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
  totalInvalidadas: (revisao.participacoesInvalidadas || []).length,
  ajusteBonificacaoPendente: revisao.ajusteBonificacaoPendente,
  // Justificativa e lista nominal das invalidações são internas da gestão.
  ...(gestor ? {
    justificativa: revisao.justificativa,
    participacoesInvalidadas: revisao.participacoesInvalidadas || [],
  } : {}),
});

export const serializarLote = (lote, { gestor = true } = {}) => {
  const saldo = saldoLote(lote);
  return {
    _id: lote._id,
    pedidoId: lote.pedidoId,
    numeroPedido: lote.numeroPedido,
    clienteId: lote.clienteId,
    distribuidorNome: lote.distribuidorNome,
    codigoPublico: lote.codigoPublico,
    status: lote.status,
    valorAprovadoInicial: lote.valorAprovadoInicial,
    valorAtual: lote.valorAtual,
    faixaMaxima: lote.faixaMaxima,
    cuponsConcedidos: lote.cuponsConcedidos,
    saldo,
    pedidoAprovadoEm: lote.pedidoAprovadoEm,
    criadoEm: lote.createdAt,
    historicoFaixas: (lote.historicoFaixas || []).map((evento) => ({
      em: evento.em,
      tipo: evento.tipo,
      origem: evento.origem,
      valorPedido: evento.valorPedido,
      valorAnterior: evento.valorAnterior,
      cuponsAnterior: evento.cuponsAnterior,
      cuponsNovo: evento.cuponsNovo,
      acrescimo: evento.acrescimo,
      autorNome: evento.autor?.usuarioNome,
      autorTipo: evento.autor?.usuarioTipo,
    })),
    invalidacao: lote.invalidacao ? { em: lote.invalidacao.em, motivo: lote.invalidacao.motivo } : undefined,
    revisoes: (lote.revisoes || []).map((revisao) => serializarRevisao(revisao, { gestor })).reverse(),
    revisaoPendente: lote.revisaoPendente || undefined,
  };
};

export const serializarParticipacao = (participacao, { gestor = false } = {}) => ({
  _id: participacao._id,
  protocolo: participacao.protocolo,
  loteId: participacao.loteId,
  pedidoId: participacao.pedidoId,
  numeroPedido: participacao.numeroPedido,
  clienteId: participacao.clienteId,
  distribuidorNome: participacao.distribuidorNome,
  vendedorNome: participacao.vendedorNome,
  petshop: {
    ...participacao.petshop,
    documento: participacao.petshop?.documento || participacao.petshop?.cnpj,
    tipoDocumento: participacao.petshop?.tipoDocumento || (participacao.petshop?.cnpj ? "cnpj" : undefined),
  },
  compra: participacao.compra,
  comprovante: participacao.comprovante ? {
    mimetype: participacao.comprovante.mimetype,
    bytes: participacao.comprovante.bytes,
    nomeOriginal: participacao.comprovante.nomeOriginal,
  } : undefined,
  status: participacao.status,
  recebidoEm: participacao.recebidoEm,
  cupom: participacao.cupom,
  decisao: participacao.decisao ? {
    em: participacao.decisao.em,
    motivo: participacao.decisao.motivo,
    autorNome: participacao.decisao.autor?.usuarioNome,
  } : undefined,
  cancelamento: participacao.cancelamento ? {
    em: participacao.cancelamento.em,
    motivo: participacao.cancelamento.motivo,
    statusAnterior: participacao.cancelamento.statusAnterior,
    autorNome: participacao.cancelamento.autor?.usuarioNome,
    autorTipo: participacao.cancelamento.autor?.usuarioTipo,
  } : undefined,
  invalidacao: participacao.invalidacao,
  historico: (participacao.historico || []).map((evento) => ({
    acao: evento.acao,
    em: evento.em,
    motivo: evento.motivo,
    detalhes: evento.detalhes,
    autorNome: evento.autor?.usuarioNome,
    autorTipo: evento.autor?.usuarioTipo,
  })),
  // Alertas citam cadastros de outros distribuidores: exclusivos da gestão.
  ...(gestor ? { alertas: participacao.alertas || [] } : {}),
});

export const construirFiltroParticipacoes = (query = {}, { clienteId } = {}) => {
  const filtro = {};
  if (clienteId) filtro.clienteId = clienteId;
  else if (isValidObjectId(query.distribuidorId)) filtro.clienteId = new mongoose.Types.ObjectId(String(query.distribuidorId));

  if (isValidObjectId(query.loteId)) filtro.loteId = new mongoose.Types.ObjectId(String(query.loteId));
  if (PARTICIPACAO_STATUS.includes(query.status)) filtro.status = query.status;

  const distribuidor = textoBusca(query.distribuidor);
  if (distribuidor && !clienteId) filtro.distribuidorNome = { $regex: escapeRegex(distribuidor), $options: "i" };
  const pedido = textoBusca(query.pedido, 40);
  if (pedido) filtro.numeroPedido = { $regex: escapeRegex(pedido), $options: "i" };
  const petshop = textoBusca(query.petshop);
  if (petshop) {
    filtro.$or = [
      { "petshop.nomeFantasia": { $regex: escapeRegex(petshop), $options: "i" } },
      { "petshop.razaoSocial": { $regex: escapeRegex(petshop), $options: "i" } },
    ];
  }
  // Busca por CPF ou CNPJ (completo ou início), inclusive nos cadastros antigos ("cnpj").
  const documento = normalizeDigits(query.documento ?? query.cnpj).slice(0, 14);
  if (documento) {
    const valor = [11, 14].includes(documento.length) ? documento : { $regex: `^${documento}` };
    filtro.$and = [...(filtro.$and || []), { $or: [{ "petshop.documento": valor }, { "petshop.cnpj": valor }] }];
  }
  const vendedor = textoBusca(query.vendedor);
  if (vendedor) filtro.vendedorNome = { $regex: escapeRegex(vendedor), $options: "i" };
  const cupom = normalizeDigits(query.cupom).slice(0, 9);
  if (cupom) filtro["cupom.numero"] = Number(cupom);
  const protocolo = textoBusca(query.protocolo, 20).toUpperCase();
  if (protocolo) filtro.protocolo = protocolo;
  if (query.comAlertas === "true") filtro["alertas.0"] = { $exists: true };

  const recebido = {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.dataInicio || "")) recebido.$gte = new Date(`${query.dataInicio}T00:00:00.000-03:00`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.dataFim || "")) recebido.$lte = new Date(`${query.dataFim}T23:59:59.999-03:00`);
  if (Object.keys(recebido).length) filtro.recebidoEm = recebido;
  return filtro;
};

export const listarParticipacoes = async (query = {}, { clienteId, gestor = false } = {}) => {
  await garantirIndicesNatal();
  const filtro = construirFiltroParticipacoes(query, { clienteId });
  const limite = Math.min(Math.max(Number.parseInt(query.limite, 10) || 30, 1), 100);
  const pagina = Math.max(Number.parseInt(query.pagina, 10) || 1, 1);
  // Ordem de recebimento (mais antigos primeiro) orienta a análise da fila.
  const ordem = query.ordem === "antigos" ? 1 : -1;
  const [itens, total] = await Promise.all([
    NatalParticipacao.find(filtro)
      .sort({ recebidoEm: ordem, _id: ordem })
      .skip((pagina - 1) * limite)
      .limit(limite)
      .lean()
      .maxTimeMS(8000),
    NatalParticipacao.countDocuments(filtro).maxTimeMS(8000),
  ]);
  return {
    itens: itens.map((item) => serializarParticipacao(item, { gestor })),
    total,
    pagina,
    limite,
    paginas: Math.max(Math.ceil(total / limite), 1),
  };
};

export const listarLotes = async (query = {}, { clienteId, gestor = !clienteId } = {}) => {
  await garantirIndicesNatal();
  const filtro = {};
  if (clienteId) filtro.clienteId = clienteId;
  if (["ativo", "invalidado"].includes(query.status)) filtro.status = query.status;
  const busca = textoBusca(query.busca);
  if (busca) {
    filtro.$or = [
      { numeroPedido: { $regex: escapeRegex(busca), $options: "i" } },
      { distribuidorNome: { $regex: escapeRegex(busca), $options: "i" } },
    ];
  }
  const lotes = await NatalLote.find(filtro).sort({ createdAt: -1 }).limit(500).lean().maxTimeMS(8000);
  return lotes.map((lote) => serializarLote(lote, { gestor }));
};

export const obterPainelGestao = async () => {
  await garantirIndicesNatal();
  const [lotes, participacoes, cupons, estado] = await Promise.all([
    NatalLote.find({}).select("clienteId distribuidorNome status cuponsConcedidos contadores revisaoPendente").lean().maxTimeMS(8000),
    NatalParticipacao.aggregate([{ $group: { _id: "$status", total: { $sum: 1 } } }]),
    NatalCupom.aggregate([{ $group: { _id: "$status", total: { $sum: 1 } } }]),
    obterEstadoCampanha(),
  ]);
  const porStatus = Object.fromEntries(participacoes.map((item) => [item._id, item.total]));
  const cuponsPorStatus = Object.fromEntries(cupons.map((item) => [item._id, item.total]));
  const ativos = lotes.filter((lote) => lote.status === "ativo");

  const distribuidores = new Map();
  for (const lote of lotes) {
    const chave = String(lote.clienteId);
    const atual = distribuidores.get(chave) || {
      clienteId: lote.clienteId,
      distribuidorNome: lote.distribuidorNome,
      lotesAtivos: 0,
      lotesInvalidados: 0,
      cuponsConcedidos: 0,
      aprovados: 0,
      pendentes: 0,
      rejeitados: 0,
      cancelados: 0,
      disponiveis: 0,
    };
    const saldo = saldoLote(lote);
    if (lote.status === "ativo") {
      atual.lotesAtivos += 1;
      atual.cuponsConcedidos += saldo.concedidos;
      atual.disponiveis += saldo.disponivel;
    } else {
      atual.lotesInvalidados += 1;
    }
    atual.aprovados += saldo.aprovados;
    atual.pendentes += saldo.pendentes;
    atual.rejeitados += saldo.rejeitados;
    atual.cancelados += saldo.cancelados;
    distribuidores.set(chave, atual);
  }

  return {
    indicadores: {
      distribuidoresParticipantes: new Set(ativos.map((lote) => String(lote.clienteId))).size,
      pedidosElegiveis: ativos.length,
      lotesInvalidados: lotes.length - ativos.length,
      cuponsConcedidos: ativos.reduce((total, lote) => total + Number(lote.cuponsConcedidos || 0), 0),
      participacoesAprovadas: porStatus.aprovado || 0,
      participacoesPendentes: porStatus.pendente || 0,
      participacoesRejeitadas: porStatus.rejeitado || 0,
      participacoesCanceladas: porStatus.cancelado || 0,
      participacoesInvalidadas: porStatus.invalidado_pedido || 0,
      participacoesInvalidadasRevisao: porStatus.invalidado_revisao || 0,
      lotesComRevisaoPendente: lotes.filter((lote) => lote.revisaoPendente).length,
      cuponsDisponiveis: ativos.reduce((total, lote) => total + saldoLote(lote).disponivel, 0),
      cuponsValidos: cuponsPorStatus.valido || 0,
      cuponsCancelados: cuponsPorStatus.cancelado || 0,
      cuponsInvalidados: cuponsPorStatus.invalidado || 0,
    },
    porDistribuidor: [...distribuidores.values()].sort((a, b) => b.cuponsConcedidos - a.cuponsConcedidos),
    estado: {
      listaFechada: Boolean(estado.listaFechada),
      fechadaEm: estado.fechadaEm,
      fechadaPorNome: estado.fechadaPor?.usuarioNome,
      historico: (estado.historico || []).map((evento) => ({
        acao: evento.acao,
        em: evento.em,
        autorNome: evento.autor?.usuarioNome,
        justificativa: evento.justificativa,
        totalCuponsValidos: evento.totalCuponsValidos,
      })),
    },
    campanha: {
      nome: NATAL_2026.nome,
      inicio: NATAL_2026.inicio,
      fimCadastros: NATAL_2026.fimCadastros,
      sorteio: NATAL_2026.sorteio,
    },
  };
};

export const buscarCupom = async (numeroTexto) => {
  await garantirIndicesNatal();
  const digitos = normalizeDigits(numeroTexto).slice(0, 9);
  if (!digitos) throw new NatalError(400, "Informe o número do cupom.");
  const cupom = await NatalCupom.findOne({ numero: Number(digitos) }).lean();
  if (!cupom) return null;
  const participacao = await NatalParticipacao.findById(cupom.participacaoId).lean();
  return {
    cupom: {
      numero: cupom.numero,
      codigo: cupom.codigo,
      status: cupom.status,
      emitidoEm: cupom.emitidoEm,
      emitidoPorNome: cupom.emitidoPor?.usuarioNome,
      encerradoEm: cupom.encerradoEm,
      motivoEncerramento: cupom.motivoEncerramento,
    },
    participacao: participacao ? serializarParticipacao(participacao, { gestor: true }) : null,
  };
};

export const alterarFechamentoLista = async ({ acao, justificativa, usuario, now = new Date() }) => {
  if (usuario?.tipo !== "admin") throw new NatalError(403, "Somente o Administrador fecha ou reabre a lista oficial.");
  const texto = typeof justificativa === "string" ? justificativa.trim() : "";
  if (!["fechar", "reabrir"].includes(acao)) throw new NatalError(400, "Ação inválida.");
  if (acao === "reabrir" && (texto.length < 15 || texto.length > 1000)) {
    throw new NatalError(400, "Informe a justificativa da reabertura (mínimo de 15 caracteres).");
  }
  await garantirIndicesNatal();
  const autor = buildAutorNatal(usuario);
  const totalCuponsValidos = await NatalCupom.countDocuments({ status: "valido" });
  const fechar = acao === "fechar";
  const atualizado = await NatalCampanhaEstado.findOneAndUpdate(
    { _id: NATAL_2026.slug, listaFechada: { $ne: fechar } },
    {
      $set: fechar
        ? { listaFechada: true, fechadaEm: now, fechadaPor: autor }
        : { listaFechada: false },
      $push: {
        historico: {
          acao: fechar ? "fechamento" : "reabertura",
          em: now,
          autor,
          justificativa: texto || undefined,
          totalCuponsValidos,
        },
      },
    },
    { upsert: fechar, returnDocument: "after" }
  ).catch((error) => {
    // Upsert concorrente com o estado já na situação pedida.
    if (error?.code === 11000) return null;
    throw error;
  });
  if (!atualizado) throw new NatalError(409, fechar ? "A lista oficial já está fechada." : "A lista oficial já está aberta.");
  await registrarAuditoriaNatal({
    acao: fechar ? "lista_fechada" : "lista_reaberta",
    autor,
    now,
    detalhes: { justificativa: texto || undefined, totalCuponsValidos },
  });
  return atualizado;
};

export const listarAuditoria = async (query = {}) => {
  const filtro = {};
  if (isValidObjectId(query.loteId)) filtro.loteId = query.loteId;
  if (isValidObjectId(query.participacaoId)) filtro.participacaoId = query.participacaoId;
  const limite = Math.min(Math.max(Number.parseInt(query.limite, 10) || 50, 1), 200);
  const itens = await NatalAuditoria.find(filtro).sort({ em: -1 }).limit(limite).lean().maxTimeMS(8000);
  return itens.map((item) => ({
    _id: item._id,
    acao: item.acao,
    em: item.em,
    autorNome: item.autor?.usuarioNome,
    autorTipo: item.autor?.usuarioTipo,
    loteId: item.loteId,
    participacaoId: item.participacaoId,
    cupomNumero: item.cupomNumero,
    aposFechamento: item.aposFechamento,
    detalhes: item.detalhes,
  }));
};

export const listarExportacoes = async () => {
  const itens = await NatalExportacao.find({}).sort({ geradaEm: -1 }).limit(100).lean();
  return itens.map((item) => ({
    _id: item._id,
    tipo: item.tipo,
    geradaEm: item.geradaEm,
    autorNome: item.autor?.usuarioNome,
    listaFechada: item.listaFechada,
    totalCupons: item.totalCupons,
    nomeArquivo: item.nomeArquivo,
    sha256: item.sha256,
  }));
};

// Recalcula os contadores de todos os lotes a partir das participações gravadas.
export const reconciliarContadores = async ({ usuario, now = new Date() }) => {
  if (usuario?.tipo !== "admin") throw new NatalError(403, "Somente o Administrador executa a reconciliação.");
  const lotes = await NatalLote.find({}).select("_id contadores").lean();
  let ajustados = 0;
  for (const lote of lotes) {
    const contadores = await recalcularContadoresLote(lote._id);
    if (JSON.stringify(contadores) !== JSON.stringify({
      aprovados: lote.contadores?.aprovados || 0,
      pendentes: lote.contadores?.pendentes || 0,
      rejeitados: lote.contadores?.rejeitados || 0,
      cancelados: lote.contadores?.cancelados || 0,
      invalidados: lote.contadores?.invalidados || 0,
    })) ajustados += 1;
  }
  await registrarAuditoriaNatal({ acao: "contadores_reconciliados", usuario, now, detalhes: { lotes: lotes.length, ajustados } });
  return { lotes: lotes.length, ajustados };
};
