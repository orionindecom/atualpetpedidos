const PAGINA_PADRAO = 1;
const LIMITE_CLIENTE_PADRAO = 12;
const LIMITE_ADMIN_PADRAO = 20;
const LIMITE_MAXIMO = 100;
const FILTRO_MAX_LENGTH = 150;

export const CATEGORIAS_MATERIAL_SUGERIDAS = [
  "Fotos de Produtos",
  "Vídeos",
  "Catálogos",
  "Banners",
  "Posts para Instagram",
  "Stories",
  "Logotipos",
  "Campanhas",
  "Lançamentos",
  "Outros",
];

export const TIPOS_MATERIAL_SUGERIDOS = [
  "Imagem",
  "Vídeo",
  "PDF",
  "Pasta",
  "Documento",
  "Link",
  "Outro",
];

const camposTexto = {
  titulo: { maxLength: 150, required: true },
  descricao: { maxLength: 1000 },
  categoria: { maxLength: 100, required: true },
  tipo: { maxLength: 100, required: true },
  marca: { maxLength: 120 },
  linha: { maxLength: 120 },
};

export const CAMPOS_MATERIAL_PERMITIDOS = new Set([
  ...Object.keys(camposTexto),
  "linkExterno",
  "imagemCapaUrl",
  "destaque",
  "ordem",
  "ativo",
]);

export const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const isSafeExternalUrl = (
  value,
  { required = true, nodeEnv = process.env.NODE_ENV } = {}
) => {
  if (typeof value !== "string") {
    return !required && (value === undefined || value === null);
  }

  const normalized = value.trim();

  if (!normalized) {
    return !required;
  }

  if (normalized.length > 2048) {
    return false;
  }

  try {
    const url = new URL(normalized);

    if (url.username || url.password) {
      return false;
    }

    if (url.protocol === "https:") {
      return true;
    }

    return url.protocol === "http:" && nodeEnv !== "production";
  } catch {
    return false;
  }
};

const parsePositiveInteger = (value, fallback) => {
  if (value === undefined) {
    return fallback;
  }

  if (!/^\d+$/.test(String(value))) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseBoolean = (value) => {
  if (value === undefined || value === "") return null;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
};

const normalizeFilterString = (value) => {
  if (value === undefined) return "";
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  return normalized.length <= FILTRO_MAX_LENGTH ? normalized : null;
};

export const parseMaterialQuery = (
  query = {},
  { admin = false } = {}
) => {
  const pagina = parsePositiveInteger(query.pagina, PAGINA_PADRAO);
  const limite = parsePositiveInteger(
    query.limite,
    admin ? LIMITE_ADMIN_PADRAO : LIMITE_CLIENTE_PADRAO
  );
  const busca = normalizeFilterString(query.busca);
  const categoria = normalizeFilterString(query.categoria);
  const tipo = normalizeFilterString(query.tipo);
  const marca = normalizeFilterString(query.marca);
  const linha = normalizeFilterString(query.linha);
  const ativo = parseBoolean(query.ativo);
  const destaque = parseBoolean(query.destaque);

  if (
    pagina === null ||
    limite === null ||
    limite > LIMITE_MAXIMO ||
    [busca, categoria, tipo, marca, linha].includes(null) ||
    ativo === undefined ||
    destaque === undefined
  ) {
    return null;
  }

  return {
    pagina,
    limite,
    busca,
    categoria,
    tipo,
    marca,
    linha,
    ativo,
    destaque,
  };
};

export const buildMaterialFilter = (query, { onlyActive = false } = {}) => {
  const filter = {};

  if (onlyActive) {
    filter.ativo = true;
  } else if (query.ativo !== null) {
    filter.ativo = query.ativo;
  }

  if (query.destaque !== null) filter.destaque = query.destaque;
  if (query.categoria) filter.categoria = query.categoria;
  if (query.tipo) filter.tipo = query.tipo;
  if (query.marca) filter.marca = query.marca;
  if (query.linha) filter.linha = query.linha;

  if (query.busca) {
    const regex = new RegExp(escapeRegex(query.busca), "i");
    filter.$or = [
      { titulo: regex },
      { descricao: regex },
      { categoria: regex },
      { tipo: regex },
      { marca: regex },
      { linha: regex },
    ];
  }

  return filter;
};

export const MATERIAL_SORT = {
  destaque: -1,
  ordem: 1,
  createdAt: -1,
  _id: 1,
};

export const validateMaterialPayload = (
  body = {},
  { partial = false, nodeEnv = process.env.NODE_ENV } = {}
) => {
  const source = body && typeof body === "object" && !Array.isArray(body)
    ? body
    : {};
  const data = {};
  const errors = {};

  for (const [field, rules] of Object.entries(camposTexto)) {
    const supplied = Object.hasOwn(source, field);

    if (!supplied) {
      if (!partial && rules.required) {
        errors[field] = "Campo obrigatório";
      }
      continue;
    }

    if (typeof source[field] !== "string") {
      errors[field] = "Informe um texto válido";
      continue;
    }

    const normalized = source[field].trim();

    if (rules.required && !normalized) {
      errors[field] = "Campo obrigatório";
    } else if (normalized.length > rules.maxLength) {
      errors[field] = `Use no máximo ${rules.maxLength} caracteres`;
    } else {
      data[field] = normalized;
    }
  }

  for (const [field, required] of [["linkExterno", true], ["imagemCapaUrl", false]]) {
    const supplied = Object.hasOwn(source, field);

    if (!supplied) {
      if (!partial && required) errors[field] = "Campo obrigatório";
      continue;
    }

    const normalized = typeof source[field] === "string"
      ? source[field].trim()
      : source[field];

    if (!isSafeExternalUrl(normalized, { required, nodeEnv })) {
      errors[field] = nodeEnv === "production"
        ? "Informe uma URL HTTPS válida"
        : "Informe uma URL HTTP ou HTTPS válida";
    } else {
      data[field] = normalized || "";
    }
  }

  for (const field of ["destaque", "ativo"]) {
    if (!Object.hasOwn(source, field)) continue;

    if (typeof source[field] !== "boolean") {
      errors[field] = "Informe verdadeiro ou falso";
    } else {
      data[field] = source[field];
    }
  }

  if (Object.hasOwn(source, "ordem")) {
    const ordem = Number(source.ordem);

    if (!Number.isInteger(ordem) || ordem < -100000 || ordem > 100000) {
      errors.ordem = "Informe um número inteiro entre -100000 e 100000";
    } else {
      data.ordem = ordem;
    }
  }

  if (partial && Object.keys(data).length === 0 && Object.keys(errors).length === 0) {
    errors.formulario = "Informe ao menos um campo válido";
  }

  return {
    valid: Object.keys(errors).length === 0,
    data,
    errors,
  };
};
