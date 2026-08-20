import mongoose from "mongoose";
import OperadorLogistica from "../models/OperadorLogistica.js";
import Pedido from "../models/Pedido.js";
import { buildOrderAuditTimeline } from "../utils/pedidoAuditoria.js";
import {
  asValidDate,
  duracaoValida,
  obterLimiteEtapa,
  resumirDuracoes,
} from "../utils/pedidoMetricas.js";

const MAX_ANALYSIS_ORDERS = 20000;
const MAX_ACTIVE_CANDIDATES = 500;
const MAX_DETAIL_ROWS = 10;
const MAX_ATTENTION_ROWS = 30;

const ACTIVE_STATUSES = Object.freeze([
  "aguardando_aprovacao",
  "aprovado",
  "novo",
  "em_analise",
  "separando",
  "separado",
]);

const OPERATIONAL_EVENT_TYPES = new Set([
  "separacao_iniciada",
  "separacao_concluida",
  "conferencia_iniciada",
  "conferencia_concluida",
  "divergencia_conferencia",
  "fechamento_logistico",
  "ocorrencia",
]);

const ORDER_PROJECTION = Object.freeze({
  numeroPedido: 1,
  nomeFantasiaCliente: 1,
  razaoSocialCliente: 1,
  status: 1,
  createdAt: 1,
  aprovacao: 1,
  conferenciaObrigatoria: 1,
  conferencia: 1,
  historicoConferencias: 1,
  fechamentoLogisticoObrigatorio: 1,
  fechamentoLogistico: 1,
  historicoStatus: 1,
  ocorrencias: 1,
  "itens.produtoId": 1,
  "itens.nomeProduto": 1,
  "itens.quantidade": 1,
  "itens.quantidadeSeparada": 1,
  "itens.quantidadeConferida": 1,
  "itens.quantidadeFinal": 1,
  "itens.situacaoSeparacao": 1,
  "itens.situacaoFinal": 1,
});

export class PedidoMetricasQueryError extends Error {
  constructor(message, statusCode = 422) {
    super(message);
    this.name = "PedidoMetricasQueryError";
    this.statusCode = statusCode;
  }
}

const stringId = (value) => value ? String(value) : "";

const eventDate = (event) => asValidDate(event?.alteradoEm);

const sortedHistory = (pedido) => (pedido?.historicoStatus || [])
  .filter((entry) => eventDate(entry))
  .sort((left, right) => eventDate(left) - eventDate(right));

const findStatusEvent = (history, status, after) => history.find((entry) => {
  if (entry.novoStatus !== status) return false;
  const date = eventDate(entry);
  return date && (!after || date >= after);
});

export const extrairMarcosPedido = (pedido = {}) => {
  const history = sortedHistory(pedido);
  const createdAt = asValidDate(pedido.createdAt);
  const approvalHistory = findStatusEvent(history, "aprovado");
  const approvalAt = asValidDate(pedido.aprovacao?.aprovadoEm) || eventDate(approvalHistory);
  const separationStartEvent = findStatusEvent(history, "separando", approvalAt);
  const separationStartAt = eventDate(separationStartEvent);
  const separationEndEvent = findStatusEvent(history, "separado", separationStartAt);
  const separationEndAt = eventDate(separationEndEvent);
  const conferenceStartAt = asValidDate(pedido.conferencia?.iniciadaEm);
  const conferenceEndAt = asValidDate(pedido.conferencia?.concluidaEm);

  const approvalMs = duracaoValida(createdAt, approvalAt);
  const separationWaitMs = duracaoValida(approvalAt, separationStartAt);
  const separationMs = duracaoValida(separationStartAt, separationEndAt);
  const conferenceWaitMs = duracaoValida(separationEndAt, conferenceStartAt);
  const conferenceMs = duracaoValida(conferenceStartAt, conferenceEndAt);
  const totalMs = duracaoValida(createdAt, conferenceEndAt);
  const operationalMs = separationMs !== null && conferenceMs !== null
    ? separationMs + conferenceMs
    : null;
  const stoppedMs = totalMs !== null && operationalMs !== null && totalMs >= operationalMs
    ? totalMs - operationalMs
    : null;

  const invalidPairs = [
    [createdAt, approvalAt, approvalMs],
    [approvalAt, separationStartAt, separationWaitMs],
    [separationStartAt, separationEndAt, separationMs],
    [separationEndAt, conferenceStartAt, conferenceWaitMs],
    [conferenceStartAt, conferenceEndAt, conferenceMs],
    [createdAt, conferenceEndAt, totalMs],
  ].filter(([start, end, duration]) => start && end && duration === null).length;

  return {
    createdAt,
    approvalAt,
    approvalEvent: pedido.aprovacao || approvalHistory,
    separationStartAt,
    separationStartEvent,
    separationEndAt,
    separationEndEvent,
    conferenceStartAt,
    conferenceEndAt,
    approvalMs,
    separationWaitMs,
    separationMs,
    conferenceWaitMs,
    conferenceMs,
    totalMs,
    operationalMs,
    stoppedMs,
    invalidPairs,
  };
};

export const pedidoTemParticipacaoOperador = (pedido, operadorId) => {
  const expected = stringId(operadorId);
  if (!expected) return true;
  return (pedido.historicoStatus || []).some((entry) => stringId(entry.operadorId) === expected) ||
    (pedido.ocorrencias || []).some((entry) => stringId(entry.operadorId) === expected) ||
    stringId(pedido.conferencia?.iniciadoPor?.operadorId) === expected ||
    stringId(pedido.conferencia?.concluidoPor?.operadorId) === expected ||
    (pedido.historicoConferencias || []).some((entry) => (
      stringId(entry.conferencia?.iniciadoPor?.operadorId) === expected ||
      stringId(entry.conferencia?.concluidoPor?.operadorId) === expected ||
      stringId(entry.invalidadaPor?.operadorId) === expected
    )) ||
    stringId(pedido.fechamentoLogistico?.preenchidoPor?.operadorId) === expected;
};

const pedidoIdentity = (pedido, marcos) => ({
  pedidoId: pedido._id,
  numeroPedido: pedido.numeroPedido || "-",
  cliente: pedido.nomeFantasiaCliente || pedido.razaoSocialCliente || "-",
  status: pedido.status,
  criadoEm: marcos.createdAt,
  totalMs: marcos.totalMs,
  separacaoMs: marcos.separationMs,
  operacionalMs: marcos.operationalMs,
  paradoMs: marcos.stoppedMs,
  itensUnicos: (pedido.itens || []).length,
  unidades: (pedido.itens || []).reduce(
    (total, item) => total + (Number.isFinite(Number(item.quantidade)) ? Number(item.quantidade) : 0),
    0
  ),
});

const productKey = (item) => stringId(item.produtoId) || `nome:${item.nomeProduto || "sem-nome"}`;

const getProductSummary = (map, item) => {
  const key = productKey(item);
  if (!map.has(key)) {
    map.set(key, {
      produtoId: item.produtoId || null,
      produto: item.nomeProduto || "Produto sem nome",
      pedidosComProduto: new Set(),
      pedidosAfetados: new Set(),
      faltasSeparacao: 0,
      divergenciasConferencia: 0,
      unidadesFaltantes: 0,
    });
  }
  return map.get(key);
};

export const calcularMetricasGerais = (pedidos = []) => {
  const series = {
    aprovacao: [],
    esperaSeparacao: [],
    separacao: [],
    esperaConferencia: [],
    conferencia: [],
    total: [],
    operacional: [],
    parado: [],
  };
  const products = new Map();
  const slowest = [];
  let invalidTimestampPairs = 0;
  let totalUniqueItems = 0;
  let totalUnits = 0;
  let ordersWithDivergence = 0;
  let divergentItems = 0;
  let ordersWithShortage = 0;
  let shortageItems = 0;
  let totalMissingUnits = 0;
  let ordersWithUnavailableItem = 0;
  let ordersWithPartialItem = 0;

  for (const pedido of pedidos) {
    const marcos = extrairMarcosPedido(pedido);
    invalidTimestampPairs += marcos.invalidPairs;
    const durations = {
      aprovacao: marcos.approvalMs,
      esperaSeparacao: marcos.separationWaitMs,
      separacao: marcos.separationMs,
      esperaConferencia: marcos.conferenceWaitMs,
      conferencia: marcos.conferenceMs,
      total: marcos.totalMs,
      operacional: marcos.operationalMs,
      parado: marcos.stoppedMs,
    };
    for (const [key, value] of Object.entries(durations)) {
      if (value !== null) series[key].push(value);
    }

    const items = pedido.itens || [];
    totalUniqueItems += items.length;
    let orderHasShortage = false;
    let orderHasUnavailable = false;
    let orderHasPartial = false;
    let orderDivergenceCount = 0;

    for (const item of items) {
      const requested = Number(item.quantidade);
      const separated = item.quantidadeSeparada === undefined || item.quantidadeSeparada === null
        ? null
        : Number(item.quantidadeSeparada);
      if (Number.isFinite(requested) && requested >= 0) totalUnits += requested;

      const product = getProductSummary(products, item);
      product.pedidosComProduto.add(stringId(pedido._id));
      if (
        Number.isFinite(requested) &&
        Number.isFinite(separated) &&
        separated >= 0 &&
        separated < requested
      ) {
        const missing = requested - separated;
        orderHasShortage = true;
        orderHasUnavailable ||= separated === 0 && requested > 0;
        orderHasPartial ||= separated > 0;
        shortageItems += 1;
        totalMissingUnits += missing;
        product.faltasSeparacao += 1;
        product.unidadesFaltantes += missing;
        product.pedidosAfetados.add(stringId(pedido._id));
      }
    }

    for (const item of pedido.conferencia?.itens || []) {
      if (!Number.isFinite(Number(item.diferenca)) || Number(item.diferenca) === 0) continue;
      orderDivergenceCount += 1;
      const product = getProductSummary(products, item);
      product.divergenciasConferencia += 1;
      product.pedidosAfetados.add(stringId(pedido._id));
    }

    const reportedDivergences = Number(pedido.conferencia?.totalDivergencias);
    const divergenceTotal = Number.isFinite(reportedDivergences)
      ? Math.max(orderDivergenceCount, reportedDivergences)
      : orderDivergenceCount;
    const orderHasDivergence = divergenceTotal > 0 ||
      pedido.conferencia?.status === "concluida_com_divergencia";

    if (orderHasShortage) ordersWithShortage += 1;
    if (orderHasUnavailable) ordersWithUnavailableItem += 1;
    if (orderHasPartial) ordersWithPartialItem += 1;
    if (orderHasDivergence) {
      ordersWithDivergence += 1;
      divergentItems += divergenceTotal;
    }
    if (marcos.totalMs !== null) slowest.push(pedidoIdentity(pedido, marcos));
  }

  const times = Object.fromEntries(
    Object.entries(series).map(([key, values]) => [key, resumirDuracoes(values)])
  );
  const productRows = [...products.values()]
    .map((product) => {
      const ordersWithProduct = product.pedidosComProduto.size;
      const affectedOrders = product.pedidosAfetados.size;
      return {
        produtoId: product.produtoId,
        produto: product.produto,
        pedidosComProduto: ordersWithProduct,
        pedidosAfetados: affectedOrders,
        faltasSeparacao: product.faltasSeparacao,
        divergenciasConferencia: product.divergenciasConferencia,
        ocorrencias: product.faltasSeparacao + product.divergenciasConferencia,
        unidadesFaltantes: product.unidadesFaltantes,
        taxaPedidosAfetados: ordersWithProduct > 0
          ? (affectedOrders / ordersWithProduct) * 100
          : 0,
      };
    })
    .filter((product) => product.ocorrencias > 0)
    .sort((left, right) => right.ocorrencias - left.ocorrencias || right.pedidosAfetados - left.pedidosAfetados)
    .slice(0, MAX_DETAIL_ROWS);

  return {
    resumo: {
      pedidosNoPeriodo: pedidos.length,
      percentualPedidosComDivergencia: pedidos.length > 0
        ? (ordersWithDivergence / pedidos.length) * 100
        : 0,
      itensUnicos: totalUniqueItems,
      unidadesSolicitadas: totalUnits,
    },
    tempos: times,
    composicaoTempo: {
      total: times.total,
      operacional: times.operacional,
      parado: times.parado,
      amostraComparavel: times.parado.amostra,
    },
    qualidade: {
      pedidosComDivergencia: ordersWithDivergence,
      percentualPedidosComDivergencia: pedidos.length > 0
        ? (ordersWithDivergence / pedidos.length) * 100
        : 0,
      itensComDivergencia: divergentItems,
      pedidosComFalta: ordersWithShortage,
      itensComFalta: shortageItems,
      unidadesFaltantes: totalMissingUnits,
      pedidosComItemIndisponivel: ordersWithUnavailableItem,
      pedidosComFaltaParcial: ordersWithPartialItem,
    },
    produtosOcorrencias: productRows,
    pedidosMaisDemorados: slowest
      .sort((left, right) => right.totalMs - left.totalMs)
      .slice(0, MAX_DETAIL_ROWS),
    diagnostico: { paresDeTimestampInvalidos: invalidTimestampPairs },
  };
};

const inPeriod = (value, start, end) => {
  const date = asValidDate(value);
  return Boolean(date && date >= start && date <= end);
};

const createOperatorSummary = (operator = {}) => ({
  operadorId: operator._id || operator.operadorId,
  operador: operator.nome || operator.operadorNome || "Operador não identificado",
  ativo: operator.ativo ?? null,
  pedidos: new Set(),
  separacoesIniciadas: 0,
  separacoesConcluidas: 0,
  conferenciasIniciadas: 0,
  conferenciasConcluidas: 0,
  eventosOperacionais: 0,
  itensProcessados: 0,
  unidadesProcessadas: 0,
  divergenciasIdentificadas: 0,
  divergenciasAssociadasSeparacao: 0,
  faltasRegistradas: 0,
  separationDurations: [],
  conferenceDurations: [],
});

export const calcularMetricasOperadores = ({
  pedidos = [],
  operadores = [],
  inicio,
  fim,
  operadorId = "",
}) => {
  const summaries = new Map(
    operadores.map((operator) => [stringId(operator._id), createOperatorSummary(operator)])
  );
  let separationCyclesWithoutAttribution = 0;
  let conferenceCyclesWithoutAttribution = 0;

  const getSummary = (id, snapshot = {}) => {
    const key = stringId(id);
    if (!key || (operadorId && key !== stringId(operadorId))) return null;
    if (!summaries.has(key)) {
      summaries.set(key, createOperatorSummary({
        operadorId: id,
        operadorNome: snapshot.operadorNome,
      }));
    }
    return summaries.get(key);
  };

  for (const pedido of pedidos) {
    const timeline = buildOrderAuditTimeline(pedido);
    for (const event of timeline) {
      if (!event.operadorId || !OPERATIONAL_EVENT_TYPES.has(event.tipo) || !inPeriod(event.data, inicio, fim)) {
        continue;
      }
      const summary = getSummary(event.operadorId, event);
      if (!summary) continue;
      summary.eventosOperacionais += 1;
      summary.pedidos.add(stringId(pedido._id));
      if (event.tipo === "separacao_iniciada") summary.separacoesIniciadas += 1;
      if (event.tipo === "separacao_concluida") summary.separacoesConcluidas += 1;
      if (event.tipo === "conferencia_iniciada") summary.conferenciasIniciadas += 1;
      if (event.tipo === "conferencia_concluida") {
        summary.conferenciasConcluidas += 1;
        summary.divergenciasIdentificadas += Number(event.dados?.totalDivergencias || 0);
      }
      if (event.tipo === "ocorrencia" && event.dados?.tipoOcorrencia === "falta_produto") {
        summary.faltasRegistradas += 1;
      }
    }

    const marcos = extrairMarcosPedido(pedido);
    const separationStartOperator = stringId(marcos.separationStartEvent?.operadorId);
    const separationEndOperator = stringId(marcos.separationEndEvent?.operadorId);
    if (marcos.separationMs !== null && inPeriod(marcos.separationEndAt, inicio, fim)) {
      if (separationStartOperator && separationStartOperator === separationEndOperator) {
        const summary = getSummary(separationEndOperator, marcos.separationEndEvent);
        if (summary) {
          summary.separationDurations.push(marcos.separationMs);
          const processed = (pedido.itens || []).filter((item) => (
            item.quantidadeSeparada !== undefined && item.quantidadeSeparada !== null
          ));
          summary.itensProcessados += processed.length;
          summary.unidadesProcessadas += processed.reduce(
            (total, item) => total + (Number.isFinite(Number(item.quantidadeSeparada))
              ? Number(item.quantidadeSeparada)
              : 0),
            0
          );
        }
      } else if (separationStartOperator || separationEndOperator) {
        separationCyclesWithoutAttribution += 1;
      }
    }

    const conferenceStartOperator = stringId(pedido.conferencia?.iniciadoPor?.operadorId);
    const conferenceEndOperator = stringId(pedido.conferencia?.concluidoPor?.operadorId);
    if (marcos.conferenceMs !== null && inPeriod(marcos.conferenceEndAt, inicio, fim)) {
      if (conferenceStartOperator && conferenceStartOperator === conferenceEndOperator) {
        const summary = getSummary(conferenceEndOperator, pedido.conferencia?.concluidoPor);
        if (summary) {
          summary.conferenceDurations.push(marcos.conferenceMs);
          const checkedItems = pedido.conferencia?.itens || [];
          summary.itensProcessados += checkedItems.length;
          summary.unidadesProcessadas += checkedItems.reduce(
            (total, item) => total + (Number.isFinite(Number(item.quantidadeConferida))
              ? Number(item.quantidadeConferida)
              : 0),
            0
          );
        }
      } else if (conferenceStartOperator || conferenceEndOperator) {
        conferenceCyclesWithoutAttribution += 1;
      }
    }

    for (const archived of pedido.historicoConferencias || []) {
      const conference = archived.conferencia || {};
      const startAt = asValidDate(conference.iniciadaEm);
      const endAt = asValidDate(conference.concluidaEm);
      const duration = duracaoValida(startAt, endAt);
      const startOperator = stringId(conference.iniciadoPor?.operadorId);
      const endOperator = stringId(conference.concluidoPor?.operadorId);
      if (duration === null || !inPeriod(endAt, inicio, fim)) continue;
      if (startOperator && startOperator === endOperator) {
        const summary = getSummary(endOperator, conference.concluidoPor);
        if (summary) {
          summary.conferenceDurations.push(duration);
          const checkedItems = conference.itens || [];
          summary.itensProcessados += checkedItems.length;
          summary.unidadesProcessadas += checkedItems.reduce(
            (total, item) => total + (Number.isFinite(Number(item.quantidadeConferida))
              ? Number(item.quantidadeConferida)
              : 0),
            0
          );
        }
      } else if (startOperator || endOperator) {
        conferenceCyclesWithoutAttribution += 1;
      }
    }

    const divergenceCount = (pedido.conferencia?.itens || []).filter((item) => (
      Number.isFinite(Number(item.diferenca)) && Number(item.diferenca) !== 0
    )).length;
    if (divergenceCount > 0 && inPeriod(marcos.conferenceEndAt, inicio, fim)) {
      const participants = new Set(
        timeline
          .filter((event) => (
            event.operadorId &&
            marcos.separationStartAt &&
            marcos.separationEndAt &&
            asValidDate(event.data) >= marcos.separationStartAt &&
            asValidDate(event.data) <= marcos.separationEndAt
          ))
          .map((event) => stringId(event.operadorId))
      );
      for (const participantId of participants) {
        const summary = getSummary(participantId);
        if (summary) summary.divergenciasAssociadasSeparacao += divergenceCount;
      }
    }
  }

  const rows = [...summaries.values()]
    .filter((summary) => (
      (!operadorId || stringId(summary.operadorId) === stringId(operadorId)) &&
      (summary.eventosOperacionais > 0 || Boolean(operadorId))
    ))
    .map((summary) => ({
      operadorId: summary.operadorId,
      operador: summary.operador,
      ativo: summary.ativo,
      pedidosParticipados: summary.pedidos.size,
      separacoesIniciadas: summary.separacoesIniciadas,
      separacoesConcluidas: summary.separacoesConcluidas,
      conferenciasIniciadas: summary.conferenciasIniciadas,
      conferenciasConcluidas: summary.conferenciasConcluidas,
      eventosOperacionais: summary.eventosOperacionais,
      itensProcessados: summary.itensProcessados,
      unidadesProcessadas: summary.unidadesProcessadas,
      tempoSeparacao: resumirDuracoes(summary.separationDurations),
      tempoConferencia: resumirDuracoes(summary.conferenceDurations),
      divergenciasIdentificadas: summary.divergenciasIdentificadas,
      divergenciasAssociadasSeparacao: summary.divergenciasAssociadasSeparacao,
      faltasRegistradas: summary.faltasRegistradas,
    }))
    .sort((left, right) => left.operador.localeCompare(right.operador, "pt-BR"));

  return {
    operadores: rows,
    atribuicaoDuracao: {
      separacoesNaoAtribuidas: separationCyclesWithoutAttribution,
      conferenciasNaoAtribuidas: conferenceCyclesWithoutAttribution,
      criterio: "Duração atribuída somente quando o mesmo operador iniciou e concluiu o ciclo.",
    },
  };
};

const currentStage = (pedido, marcos) => {
  if (pedido.status === "aguardando_aprovacao" && marcos.createdAt) {
    return { key: "aprovacao", etapa: "Aguardando aprovação", mode: "aguardando", since: marcos.createdAt };
  }
  if (["aprovado", "novo", "em_analise"].includes(pedido.status) && marcos.approvalAt) {
    return { key: "esperaSeparacao", etapa: "Aguardando início da separação", mode: "aguardando", since: marcos.approvalAt };
  }
  if (pedido.status === "separando" && marcos.separationStartAt) {
    return {
      key: "separacao",
      etapa: "Separação em andamento",
      mode: "em_andamento",
      since: marcos.separationStartAt,
      responsible: marcos.separationStartEvent?.operadorNome || marcos.separationStartEvent?.usuarioNome,
    };
  }
  if (pedido.status === "separado" && pedido.conferencia?.status === "em_andamento" && marcos.conferenceStartAt) {
    return {
      key: "conferencia",
      etapa: "Conferência em andamento",
      mode: "em_andamento",
      since: marcos.conferenceStartAt,
      responsible: pedido.conferencia?.iniciadoPor?.operadorNome ||
        pedido.conferencia?.iniciadoPor?.usuarioNome,
    };
  }
  if (
    pedido.status === "separado" &&
    pedido.conferenciaObrigatoria === true &&
    !marcos.conferenceEndAt &&
    marcos.separationEndAt
  ) {
    return {
      key: "esperaConferencia",
      etapa: "Aguardando conferência",
      mode: "aguardando",
      since: marcos.separationEndAt,
    };
  }
  return null;
};

export const calcularPedidosAtencao = ({ pedidos = [], tempos, now = new Date() }) => {
  const rows = [];
  const thresholds = {};
  for (const key of ["aprovacao", "esperaSeparacao", "separacao", "esperaConferencia", "conferencia"]) {
    thresholds[key] = obterLimiteEtapa(tempos[key], key);
  }

  for (const pedido of pedidos) {
    const marcos = extrairMarcosPedido(pedido);
    const stage = currentStage(pedido, marcos);
    if (!stage) continue;
    const elapsedMs = duracaoValida(stage.since, now);
    if (elapsedMs === null) continue;
    const threshold = thresholds[stage.key];
    rows.push({
      pedidoId: pedido._id,
      numeroPedido: pedido.numeroPedido || "-",
      cliente: pedido.nomeFantasiaCliente || pedido.razaoSocialCliente || "-",
      status: pedido.status,
      etapa: stage.etapa,
      etapaChave: stage.key,
      classificacao: elapsedMs > threshold.limiteMs
        ? "acima_tempo_normal"
        : stage.mode,
      tempoEtapaMs: elapsedMs,
      responsavelAtual: stage.responsible || null,
      limite: threshold,
    });
  }

  rows.sort((left, right) => {
    const leftPriority = left.classificacao === "acima_tempo_normal" ? 1 : 0;
    const rightPriority = right.classificacao === "acima_tempo_normal" ? 1 : 0;
    return rightPriority - leftPriority || right.tempoEtapaMs - left.tempoEtapaMs;
  });

  return {
    pedidos: rows.slice(0, MAX_ATTENTION_ROWS),
    totalAnalisado: rows.length,
    limites: thresholds,
  };
};

const operatorParticipationMatch = (operatorObjectId) => ({
  $or: [
    { "historicoStatus.operadorId": operatorObjectId },
    { "ocorrencias.operadorId": operatorObjectId },
    { "conferencia.iniciadoPor.operadorId": operatorObjectId },
    { "conferencia.concluidoPor.operadorId": operatorObjectId },
    { "historicoConferencias.conferencia.iniciadoPor.operadorId": operatorObjectId },
    { "historicoConferencias.conferencia.concluidoPor.operadorId": operatorObjectId },
    { "historicoConferencias.invalidadaPor.operadorId": operatorObjectId },
    { "fechamentoLogistico.preenchidoPor.operadorId": operatorObjectId },
  ],
});

const eventPeriodMatch = ({ inicio, fim, operatorObjectId }) => {
  const operatorArrayCondition = operatorObjectId ? { operadorId: operatorObjectId } : {
    operadorId: { $exists: true },
  };
  const conferenceStart = {
    "conferencia.iniciadaEm": { $gte: inicio, $lte: fim },
    "conferencia.iniciadoPor.operadorId": operatorObjectId || { $exists: true },
  };
  const conferenceEnd = {
    "conferencia.concluidaEm": { $gte: inicio, $lte: fim },
    "conferencia.concluidoPor.operadorId": operatorObjectId || { $exists: true },
  };
  const logisticsClosing = {
    "fechamentoLogistico.preenchidoEm": { $gte: inicio, $lte: fim },
    "fechamentoLogistico.preenchidoPor.operadorId": operatorObjectId || { $exists: true },
  };
  return {
    $or: [
      {
        historicoStatus: {
          $elemMatch: {
            alteradoEm: { $gte: inicio, $lte: fim },
            ...operatorArrayCondition,
          },
        },
      },
      {
        ocorrencias: {
          $elemMatch: {
            criadaEm: { $gte: inicio, $lte: fim },
            ...operatorArrayCondition,
          },
        },
      },
      conferenceStart,
      conferenceEnd,
      {
        historicoConferencias: {
          $elemMatch: {
            "conferencia.iniciadaEm": { $gte: inicio, $lte: fim },
            "conferencia.iniciadoPor.operadorId": operatorObjectId || { $exists: true },
          },
        },
      },
      {
        historicoConferencias: {
          $elemMatch: {
            "conferencia.concluidaEm": { $gte: inicio, $lte: fim },
            "conferencia.concluidoPor.operadorId": operatorObjectId || { $exists: true },
          },
        },
      },
      logisticsClosing,
    ],
  };
};

const runLimitedAggregate = async (pipeline, label) => {
  const rows = await Pedido.aggregate([
    ...pipeline,
    { $limit: MAX_ANALYSIS_ORDERS + 1 },
  ]).option({ allowDiskUse: true, maxTimeMS: 10000 });
  if (rows.length > MAX_ANALYSIS_ORDERS) {
    throw new PedidoMetricasQueryError(
      `O período contém pedidos demais para ${label}. Reduza o intervalo analisado.`,
      413
    );
  }
  return rows;
};

export const obterMetricasPedidos = async (filters, { now = new Date() } = {}) => {
  const operatorObjectId = filters.operadorId
    ? new mongoose.Types.ObjectId(filters.operadorId)
    : null;
  const periodPipeline = [
    { $match: { createdAt: { $gte: filters.inicio, $lte: filters.fim } } },
    ...(operatorObjectId ? [{ $match: operatorParticipationMatch(operatorObjectId) }] : []),
    { $project: ORDER_PROJECTION },
  ];
  const eventPipeline = [
    { $match: eventPeriodMatch({
      inicio: filters.inicio,
      fim: filters.fim,
      operatorObjectId,
    }) },
    { $project: ORDER_PROJECTION },
  ];
  const activeMatch = {
    status: { $in: ACTIVE_STATUSES },
    ...(operatorObjectId ? operatorParticipationMatch(operatorObjectId) : {}),
  };
  const activePipeline = [
    { $match: activeMatch },
    { $sort: { createdAt: 1, _id: 1 } },
    {
      $facet: {
        pedidos: [
          { $limit: MAX_ACTIVE_CANDIDATES + 1 },
          { $project: ORDER_PROJECTION },
        ],
        total: [{ $count: "valor" }],
      },
    },
  ];

  const [periodOrders, eventOrders, activeResult, operators] = await Promise.all([
    runLimitedAggregate(periodPipeline, "as métricas gerais"),
    runLimitedAggregate(eventPipeline, "as métricas por operador"),
    Pedido.aggregate(activePipeline).option({ allowDiskUse: true, maxTimeMS: 10000 }),
    OperadorLogistica.find()
      .select("_id nome ativo")
      .sort({ nome: 1 })
      .lean()
      .maxTimeMS(5000),
  ]);

  const general = calcularMetricasGerais(periodOrders);
  const operatorMetrics = calcularMetricasOperadores({
    pedidos: eventOrders,
    operadores: operators,
    inicio: filters.inicio,
    fim: filters.fim,
    operadorId: filters.operadorId,
  });
  const activeCandidates = activeResult[0]?.pedidos || [];
  const attention = calcularPedidosAtencao({
    pedidos: activeCandidates.slice(0, MAX_ACTIVE_CANDIDATES),
    tempos: general.tempos,
    now,
  });
  const selectedOperator = filters.operadorId
    ? operators.find((operator) => stringId(operator._id) === filters.operadorId)
    : null;

  return {
    filtros: {
      periodo: filters.periodo,
      dataInicio: filters.dataInicio,
      dataFim: filters.dataFim,
      inicio: filters.inicio,
      fim: filters.fim,
      timezone: filters.timezone,
      operadorId: filters.operadorId || null,
      operador: selectedOperator?.nome ||
        operatorMetrics.operadores.find((operator) => stringId(operator.operadorId) === filters.operadorId)?.operador ||
        null,
      criterioPedidos: "Pedidos incluídos por createdAt no período.",
      criterioOperadores: "Eventos incluídos pela data real do evento no período.",
    },
    ...general,
    operadores: operatorMetrics.operadores,
    atribuicaoDuracaoOperadores: operatorMetrics.atribuicaoDuracao,
    pedidosAtencao: attention.pedidos,
    limitesAtencao: attention.limites,
    metadados: {
      temposCorridos: true,
      amostraMinimaP90: 5,
      pedidosAtivosEncontrados: activeResult[0]?.total?.[0]?.valor || 0,
      pedidosAtivosAnalisados: Math.min(activeCandidates.length, MAX_ACTIVE_CANDIDATES),
      filaAtivaTruncada: (activeResult[0]?.total?.[0]?.valor || 0) > MAX_ACTIVE_CANDIDATES,
      limitePedidosAnalise: MAX_ANALYSIS_ORDERS,
      ...general.diagnostico,
    },
  };
};
