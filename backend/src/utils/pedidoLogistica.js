export const PEDIDO_STATUS = Object.freeze([
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

const TRANSICOES_LOGISTICA = Object.freeze({
  novo: ["separando"],
  em_analise: ["separando"],
  separando: ["separado"],
  separado: ["faturado"],
  faturado: ["enviado"],
  enviado: [],
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
]);

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

export const transicaoLogisticaPermitida = (statusAtual, novoStatus) => (
  statusAtual === novoStatus ||
  transicoesPermitidasLogistica(statusAtual).includes(novoStatus)
);

export const validateLogisticsOrderPayload = (source) => {
  const body = source && typeof source === "object" && !Array.isArray(source)
    ? source
    : {};
  const errors = {};
  const data = {};
  let observacaoHistorico = "";

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

  if (Object.hasOwn(data, "linkRastreio") && !isSafeTrackingUrl(data.linkRastreio)) {
    errors.linkRastreio = "Informe um link HTTPS válido";
  }

  if (Object.keys(data).length === 0 && Object.keys(errors).length === 0) {
    errors.campos = "Informe ao menos um campo logístico para atualizar";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    data,
    observacaoHistorico,
  };
};

export const buildStatusHistoryEntry = ({
  statusAnterior,
  novoStatus,
  usuario,
  observacao = "",
  now = new Date(),
}) => ({
  statusAnterior,
  novoStatus,
  alteradoEm: now,
  usuarioId: usuario._id,
  usuarioNome: usuario.nomeResponsavel || usuario.nomeFantasia || "Usuário interno",
  usuarioTipo: usuario.tipo,
  observacao: observacao || undefined,
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
  const source = typeof pedido?.toObject === "function" ? pedido.toObject() : { ...pedido };
  delete source.historicoStatus;
  delete source.observacaoLogistica;
  return source;
};
