import { validateAudiencePayload } from "./contentAudience.js";
import { isSafeExternalUrl } from "./materialMarketingValidation.js";

const parseBoolean = (value) => {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
};

const parseDate = (value) => {
  if (value === "" || value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export const validateBannerPayload = (
  body = {},
  {
    allowEmpty = false,
    nodeEnv = process.env.NODE_ENV,
    partial = false,
  } = {}
) => {
  const source = body && typeof body === "object" && !Array.isArray(body)
    ? body
    : {};
  const data = {};
  const errors = {};

  if (Object.hasOwn(source, "tituloInterno")) {
    const title = typeof source.tituloInterno === "string"
      ? source.tituloInterno.trim()
      : "";
    if (!title) errors.tituloInterno = "Informe o título interno";
    else if (title.length > 150) {
      errors.tituloInterno = "Use no máximo 150 caracteres";
    } else data.tituloInterno = title;
  } else if (!partial) {
    errors.tituloInterno = "Informe o título interno";
  }

  if (Object.hasOwn(source, "link")) {
    const link = typeof source.link === "string" ? source.link.trim() : source.link;
    if (!isSafeExternalUrl(link, { required: false, nodeEnv })) {
      errors.link = nodeEnv === "production"
        ? "Informe uma URL HTTPS válida"
        : "Informe uma URL HTTP ou HTTPS válida";
    } else data.link = link || "";
  }

  if (Object.hasOwn(source, "ativo")) {
    const active = parseBoolean(source.ativo);
    if (active === undefined) errors.ativo = "Informe verdadeiro ou falso";
    else data.ativo = active;
  }

  if (Object.hasOwn(source, "ordem")) {
    const order = Number(source.ordem);
    if (!Number.isInteger(order) || order < -100000 || order > 100000) {
      errors.ordem = "Informe um número inteiro entre -100000 e 100000";
    } else data.ordem = order;
  }

  for (const field of ["dataInicial", "dataFinal"]) {
    if (!Object.hasOwn(source, field)) continue;
    const date = parseDate(source[field]);
    if (date === undefined) errors[field] = "Informe uma data válida";
    else data[field] = date;
  }

  if (data.dataInicial && data.dataFinal && data.dataInicial > data.dataFinal) {
    errors.dataFinal = "A data final deve ser posterior à data inicial";
  }

  const audience = validateAudiencePayload(source, { partial });
  Object.assign(data, audience.data);
  Object.assign(errors, audience.errors);

  if (
    partial &&
    !allowEmpty &&
    Object.keys(data).length === 0 &&
    Object.keys(errors).length === 0
  ) {
    errors.formulario = "Informe ao menos um campo válido";
  }

  return {
    valid: Object.keys(errors).length === 0,
    data,
    errors,
  };
};

export const parseBannerQuery = (query = {}) => {
  const page = query.pagina === undefined ? 1 : Number(query.pagina);
  const limit = query.limite === undefined ? 20 : Number(query.limite);

  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return null;
  }

  const active = query.ativo === undefined || query.ativo === ""
    ? null
    : parseBoolean(query.ativo);
  if (active === undefined) return null;

  const search = typeof query.busca === "string" ? query.busca.trim() : "";
  if (search.length > 150) return null;

  return { page, limit, active, search };
};
