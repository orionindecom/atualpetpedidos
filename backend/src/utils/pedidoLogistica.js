import { isValidObjectId } from "./validation.js";
import { buildOrderAuditTimeline } from "./pedidoAuditoria.js";

export const PEDIDO_STATUS = Object.freeze([
  "aguardando_aprovacao",
  "aprovado",
  "novo",
  "em_analise",
  "separando",
  "separado",
  "faturado",
  "enviado",
  "entregue",
  "cancelado",
]);

export const STATUS_CONCLUIDOS = Object.freeze(["entregue", "cancelado"]);
export const STATUS_APOS_CONFERENCIA = Object.freeze([
  "faturado",
  "enviado",
  "entregue",
]);

const TRANSICOES_LOGISTICA = Object.freeze({
  aguardando_aprovacao: [],
  aprovado: ["separando"],
  novo: ["separando"],
  em_analise: ["separando"],
  separando: ["separado"],
  separado: ["faturado"],
  faturado: ["enviado"],
  enviado: [],
  entregue: [],
  cancelado: [],
});

const TRANSICOES_ADMIN = Object.freeze({
  aguardando_aprovacao: ["cancelado"],
  aprovado: ["separando", "cancelado"],
  novo: ["separando", "cancelado"],
  em_analise: ["separando", "cancelado"],
  separando: ["separado", "cancelado"],
  separado: ["faturado", "cancelado"],
  faturado: ["enviado", "cancelado"],
  enviado: ["cancelado"],
  entregue: [],
  cancelado: [],
});

const CAMPOS_LOGISTICOS = Object.freeze([
  "status",
  "numeroNotaFiscal",
  "dataFaturamento",
  "transportadora",
  "codigoRastreio",
  "linkRastreio",
  "dataEnvio",
  "observacaoLogistica",
  "observacaoHistorico",
  "separacaoItens",
  "conferencia",
  "novaOcorrencia",
]);

export const OCORRENCIA_TIPOS = Object.freeze([
  "observacao",
  "falta_produto",
  "informacao_operacional",
]);

export const OCORRENCIA_VISIBILIDADES = Object.freeze(["interna", "cliente"]);

const LIMITES_TEXTO = Object.freeze({
  numeroNotaFiscal: 100,
  transportadora: 120,
  codigoRastreio: 120,
  linkRastreio: 500,
  observacaoLogistica: 1000,
  observacaoHistorico: 500,
});

const CAMPOS_DATA = Object.freeze([
  "dataFaturamento",
  "dataEnvio",
]);

const possuiCampo = (source, field) => Object.hasOwn(source, field);

const normalizarTexto = (value, maxLength) => {
  if (value === null || value === "") return { value: "" };
  if (typeof value !== "string" || value.trim().length > maxLength) {
    return { error: `Informe um texto de até ${maxLength} caracteres` };
  }
  return { value: value.trim() };
};

const normalizarData = (value) => {
  if (value === null || value === "") return { value: null };
  if (typeof value !== "string" && !(value instanceof Date)) {
    return { error: "Informe uma data válida" };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { error: "Informe uma data válida" };
  return { value: parsed };
};

export const isSafeTrackingUrl = (value) => {
  if (value === "") return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
};

export const transicoesPermitidasLogistica = (status) => (
  TRANSICOES_LOGISTICA[status] || []
);

export const conferenciaConcluida = (pedido) => (
  ["concluida", "concluida_com_divergencia"].includes(pedido?.conferencia?.status)
);

export const pedidoExigeConferencia = (pedido) => (
  pedido?.conferenciaObrigatoria === true
);

export const pedidoPossuiEntregaConfirmada = (pedido) => (
  pedido?.status === "entregue" ||
  Boolean(pedido?.dataEntrega) ||
  (pedido?.historicoStatus || []).some((entry) => entry.novoStatus === "entregue")
);

export const transicoesPermitidasParaPedido = (
  pedido,
  { admin = false } = {}
) => {
  if (pedidoPossuiEntregaConfirmada(pedido)) return [];

  const transicoes = admin
    ? TRANSICOES_ADMIN[pedido?.status] || []
    : transicoesPermitidasLogistica(pedido?.status);

  if (
    pedido?.status === "separado" &&
    pedidoExigeConferencia(pedido) &&
    !conferenciaConcluida(pedido)
  ) {
    return transicoes.filter((status) => !STATUS_APOS_CONFERENCIA.includes(status));
  }

  return transicoes;
};

export const transicaoLogisticaPermitida = (statusAtual, novoStatus) => (
  statusAtual === novoStatus ||
  transicoesPermitidasLogistica(statusAtual).includes(novoStatus)
);

export const pedidoAguardandoAprovacao = (pedidoOuStatus) => (
  (typeof pedidoOuStatus === "string" ? pedidoOuStatus : pedidoOuStatus?.status) ===
  "aguardando_aprovacao"
);

export const pedidoDisponivelParaLogistica = (pedidoOuStatus) => (
  !pedidoAguardandoAprovacao(pedidoOuStatus)
);

export const getItemSeparation = (item = {}) => {
  const quantidadeSolicitada = Number(item.quantidade || 0);
  const possuiQuantidadeSeparada =
    item.quantidadeSeparada !== undefined &&
    item.quantidadeSeparada !== null &&
    item.quantidadeSeparada !== "" &&
    Number.isFinite(Number(item.quantidadeSeparada));
  const quantidadeSeparada = possuiQuantidadeSeparada
    ? Number(item.quantidadeSeparada)
    : null;
  const quantidadeFaltanteSeparacao = quantidadeSeparada === null
    ? null
    : Math.max(quantidadeSolicitada - quantidadeSeparada, 0);
  const possuiQuantidadeFinal =
    item.quantidadeFinal !== undefined &&
    item.quantidadeFinal !== null &&
    item.quantidadeFinal !== "" &&
    Number.isFinite(Number(item.quantidadeFinal));
  const quantidadeFinal = possuiQuantidadeFinal
    ? Number(item.quantidadeFinal)
    : null;
  const quantidadeAtendida = quantidadeFinal ?? quantidadeSeparada;
  const quantidadeFaltante = quantidadeAtendida === null
    ? null
    : Math.max(quantidadeSolicitada - quantidadeAtendida, 0);

  let situacaoSeparacao = "pendente";
  if (quantidadeSeparada !== null) {
    if (quantidadeSeparada === 0 && quantidadeSolicitada > 0) {
      situacaoSeparacao = "indisponivel";
    } else if (quantidadeFaltanteSeparacao > 0) {
      situacaoSeparacao = "parcial";
    } else {
      situacaoSeparacao = "completo";
    }
  }

  return {
    quantidadeSolicitada,
    quantidadeSeparada,
    quantidadeFaltanteSeparacao,
    quantidadeConferida: item.quantidadeConferida ?? null,
    quantidadeFinal,
    quantidadeAtendida,
    quantidadeFaltante,
    situacaoSeparacao,
    situacaoFinal: item.situacaoFinal || undefined,
  };
};

export const enrichOrderSeparation = (pedido) => {
  const source = typeof pedido?.toObject === "function" ? pedido.toObject() : { ...pedido };
  const itens = Array.isArray(source.itens)
    ? source.itens.map((item) => ({
      ...item,
      ...getItemSeparation(item),
    }))
    : [];

  return {
    ...source,
    itens,
    temDivergencia: itens.some((item) => Number(item.quantidadeFaltante) > 0),
    entregaFinalizada: pedidoPossuiEntregaConfirmada(source),
  };
};

const validateSeparationItems = (value) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    return { error: "Informe de 1 a 200 itens de separação" };
  }

  const seen = new Set();
  const itens = [];
  for (const item of value) {
    const fields = item && typeof item === "object" && !Array.isArray(item)
      ? Object.keys(item)
      : [];
    const produtoId = item?.produtoId;
    const quantidadeInformada = item?.quantidadeSeparada;
    const quantidadeSeparada = Number(quantidadeInformada);
    if (
      fields.some((field) => !["produtoId", "quantidadeSeparada"].includes(field)) ||
      !isValidObjectId(produtoId) ||
      seen.has(String(produtoId)) ||
      quantidadeInformada === "" ||
      quantidadeInformada === null ||
      quantidadeInformada === undefined ||
      !Number.isFinite(quantidadeSeparada) ||
      quantidadeSeparada < 0 ||
      quantidadeSeparada > 999999
    ) {
      return { error: "Itens de separação inválidos ou duplicados" };
    }
    seen.add(String(produtoId));
    itens.push({ produtoId: String(produtoId), quantidadeSeparada });
  }

  return { value: itens };
};

const validateOccurrence = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Informe uma ocorrência válida" };
  }
  const allowedFields = ["conteudo", "tipo", "visibilidade"];
  if (Object.keys(value).some((field) => !allowedFields.includes(field))) {
    return { error: "A ocorrência possui campos não permitidos" };
  }
  const conteudo = typeof value.conteudo === "string" ? value.conteudo.trim() : "";
  if (!conteudo || conteudo.length > 1000) {
    return { error: "Informe um conteúdo de até 1000 caracteres" };
  }
  if (!OCORRENCIA_TIPOS.includes(value.tipo)) {
    return { error: "Tipo de ocorrência inválido" };
  }
  if (
    value.visibilidade !== undefined &&
    !OCORRENCIA_VISIBILIDADES.includes(value.visibilidade)
  ) {
    return { error: "Visibilidade da ocorrência inválida" };
  }
  return {
    value: {
      conteudo,
      tipo: value.tipo,
      visibilidade: "interna",
    },
  };
};

const validateConference = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Informe uma conferência válida" };
  }

  const allowedFields = ["acao", "itens", "observacao"];
  if (Object.keys(value).some((field) => !allowedFields.includes(field))) {
    return { error: "A conferência possui campos não permitidos" };
  }
  if (!["iniciar", "concluir"].includes(value.acao)) {
    return { error: "Ação de conferência inválida" };
  }

  if (value.acao === "iniciar") {
    if (Object.keys(value).some((field) => field !== "acao")) {
      return { error: "A ação de iniciar não aceita itens ou observações" };
    }
    return { value: { acao: "iniciar" } };
  }

  const observacao = value.observacao === undefined || value.observacao === null
    ? ""
    : typeof value.observacao === "string"
      ? value.observacao.trim()
      : null;
  if (observacao === null || observacao.length > 1000) {
    return { error: "Informe uma observação de até 1000 caracteres" };
  }
  if (!Array.isArray(value.itens) || value.itens.length === 0 || value.itens.length > 200) {
    return { error: "Informe de 1 a 200 itens de conferência" };
  }

  const seen = new Set();
  const itens = [];
  for (const item of value.itens) {
    const fields = item && typeof item === "object" && !Array.isArray(item)
      ? Object.keys(item)
      : [];
    const produtoId = item?.produtoId;
    const quantidadeInformada = item?.quantidadeConferida;
    const quantidadeConferida = Number(quantidadeInformada);
    if (
      fields.some((field) => !["produtoId", "quantidadeConferida"].includes(field)) ||
      !isValidObjectId(produtoId) ||
      seen.has(String(produtoId)) ||
      quantidadeInformada === "" ||
      quantidadeInformada === null ||
      quantidadeInformada === undefined ||
      !Number.isFinite(quantidadeConferida) ||
      quantidadeConferida < 0 ||
      quantidadeConferida > 999999
    ) {
      return { error: "Itens de conferência inválidos ou duplicados" };
    }
    seen.add(String(produtoId));
    itens.push({ produtoId: String(produtoId), quantidadeConferida });
  }

  return {
    value: {
      acao: "concluir",
      itens,
      observacao,
    },
  };
};

export const validateLogisticsOrderPayload = (source) => {
  const body = source && typeof source === "object" && !Array.isArray(source)
    ? source
    : {};
  const errors = {};
  const data = {};
  let observacaoHistorico = "";
  let separacaoItens;
  let conferencia;
  let novaOcorrencia;

  const fields = Object.keys(body);
  const forbiddenFields = fields.filter((field) => !CAMPOS_LOGISTICOS.includes(field));
  if (forbiddenFields.length > 0) {
    errors.campos = `Campos não permitidos: ${forbiddenFields.join(", ")}`;
  }

  if (possuiCampo(body, "status")) {
    if (!PEDIDO_STATUS.includes(body.status)) errors.status = "Status inválido";
    else data.status = body.status;
  }

  for (const [field, maxLength] of Object.entries(LIMITES_TEXTO)) {
    if (!possuiCampo(body, field)) continue;
    const normalized = normalizarTexto(body[field], maxLength);
    if (normalized.error) errors[field] = normalized.error;
    else if (field === "observacaoHistorico") observacaoHistorico = normalized.value;
    else data[field] = normalized.value;
  }

  for (const field of CAMPOS_DATA) {
    if (!possuiCampo(body, field)) continue;
    const normalized = normalizarData(body[field]);
    if (normalized.error) errors[field] = normalized.error;
    else data[field] = normalized.value;
  }

  if (possuiCampo(body, "separacaoItens")) {
    const normalized = validateSeparationItems(body.separacaoItens);
    if (normalized.error) errors.separacaoItens = normalized.error;
    else separacaoItens = normalized.value;
  }

  if (possuiCampo(body, "novaOcorrencia")) {
    const normalized = validateOccurrence(body.novaOcorrencia);
    if (normalized.error) errors.novaOcorrencia = normalized.error;
    else novaOcorrencia = normalized.value;
  }

  if (possuiCampo(body, "conferencia")) {
    const normalized = validateConference(body.conferencia);
    if (normalized.error) errors.conferencia = normalized.error;
    else conferencia = normalized.value;
  }

  if (Object.hasOwn(data, "linkRastreio") && !isSafeTrackingUrl(data.linkRastreio)) {
    errors.linkRastreio = "Informe um link HTTPS válido";
  }

  if (
    Object.keys(data).length === 0 &&
    !separacaoItens &&
    !conferencia &&
    !novaOcorrencia &&
    Object.keys(errors).length === 0
  ) {
    errors.campos = "Informe ao menos um campo logístico para atualizar";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    data,
    observacaoHistorico,
    separacaoItens,
    conferencia,
    novaOcorrencia,
  };
};

export const buildStatusHistoryEntry = ({
  statusAnterior,
  novoStatus,
  usuario,
  operador,
  observacao = "",
  now = new Date(),
}) => ({
  statusAnterior,
  novoStatus,
  alteradoEm: now,
  usuarioId: usuario._id,
  usuarioNome: usuario.nomeResponsavel || usuario.nomeFantasia || "Usuário interno",
  usuarioTipo: usuario.tipo,
  ...(operador
    ? { operadorId: operador._id, operadorNome: operador.nome }
    : {}),
  observacao: observacao || undefined,
});

export const buildOccurrenceEntry = ({
  conteudo,
  tipo = "observacao",
  usuario,
  operador,
  produtoId,
  nomeProduto,
  now = new Date(),
}) => ({
  conteudo,
  criadaEm: now,
  usuarioId: usuario._id,
  usuarioNome: usuario.nomeResponsavel || usuario.nomeFantasia || "Usuário interno",
  usuarioTipo: usuario.tipo,
  ...(operador
    ? { operadorId: operador._id, operadorNome: operador.nome }
    : {}),
  tipo,
  visibilidade: "interna",
  produtoId: produtoId || undefined,
  nomeProduto: nomeProduto || undefined,
});

export const buildClientReceiptConfirmationUpdate = ({
  usuario,
  now = new Date(),
}) => ({
  $set: {
    status: "entregue",
    dataEntrega: now,
  },
  $push: {
    historicoStatus: buildStatusHistoryEntry({
      statusAnterior: "enviado",
      novoStatus: "entregue",
      usuario,
      observacao: "Recebimento confirmado pelo cliente",
      now,
    }),
  },
});

export const sanitizeClientOrder = (pedido) => {
  const original = typeof pedido?.toObject === "function" ? pedido.toObject() : pedido;
  const source = { ...original };
  delete source.historicoStatus;
  delete source.historicoPedido;
  delete source.observacaoLogistica;
  delete source.aprovacao;
  delete source.conferencia;
  delete source.conferenciaObrigatoria;
  delete source.ocorrencias;
  delete source.temDivergencia;
  source.itens = Array.isArray(source.itens)
    ? source.itens.map((item) => ({
      produtoId: item.produtoId,
      nomeProduto: item.nomeProduto,
      quantidade: item.quantidade,
      valorUnitario: item.valorUnitario,
      subtotal: item.subtotal,
    }))
    : [];
  return source;
};

export const enrichInternalOrderDetail = (pedido) => {
  const source = enrichOrderSeparation(pedido);
  return {
    ...source,
    entregaFinalizada: pedidoPossuiEntregaConfirmada(source),
    historicoPedido: buildOrderAuditTimeline(source),
  };
};
