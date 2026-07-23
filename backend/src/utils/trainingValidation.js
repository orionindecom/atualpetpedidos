const PAGINA_PADRAO = 1;
const LIMITE_CLIENTE_PADRAO = 12;
const LIMITE_ADMIN_PADRAO = 20;
const LIMITE_MAXIMO = 100;
const FILTRO_MAX_LENGTH = 180;
const MAX_VIDEO_DURATION_SECONDS = 86400;
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export const TRAINING_COMPLETION_THRESHOLD = 90;
export const TRAINING_PROVIDERS = ["youtube"];
export const TRAINING_PROGRESS_STATUSES = [
  "nao_iniciado",
  "em_andamento",
  "concluido",
];

export const TRAINING_SORT = {
  destaque: -1,
  obrigatorio: -1,
  ordem: 1,
  publicadoEm: -1,
  _id: 1,
};

const camposTexto = {
  titulo: { maxLength: 180, required: true },
  descricao: { maxLength: 3000 },
  resumo: { maxLength: 300 },
  categoria: { maxLength: 120, required: true },
  marca: { maxLength: 120 },
  linha: { maxLength: 120 },
  instrutor: { maxLength: 150 },
};

const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const extractYouTubeVideoId = (value) => {
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (YOUTUBE_ID_PATTERN.test(normalized)) return normalized;
  if (!normalized || /[<>"']/.test(normalized)) return null;

  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:" || url.username || url.password) return null;

    const hostname = url.hostname.toLowerCase();
    let candidate = "";

    if (hostname === "youtu.be") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length !== 1) return null;
      [candidate] = parts;
    } else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(hostname)) {
      if (url.pathname === "/watch") {
        candidate = url.searchParams.get("v") || "";
      } else {
        const match = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})\/?$/);
        candidate = match?.[1] || "";
      }
    } else {
      return null;
    }

    return YOUTUBE_ID_PATTERN.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
};

const parsePositiveInteger = (value, fallback) => {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value))) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseBoolean = (value) => {
  if (value === undefined || value === "") return null;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
};

const parsePayloadBoolean = (value) => {
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

export const parseTrainingQuery = (query = {}, { admin = false } = {}) => {
  const pagina = parsePositiveInteger(query.pagina, PAGINA_PADRAO);
  const limite = parsePositiveInteger(
    query.limite,
    admin ? LIMITE_ADMIN_PADRAO : LIMITE_CLIENTE_PADRAO
  );
  const busca = normalizeFilterString(query.busca);
  const categoria = normalizeFilterString(query.categoria);
  const marca = normalizeFilterString(query.marca);
  const linha = normalizeFilterString(query.linha);
  const provider = normalizeFilterString(query.provider);
  const statusProgresso = normalizeFilterString(query.statusProgresso);
  const ativo = parseBoolean(query.ativo);
  const destaque = parseBoolean(query.destaque);
  const obrigatorio = parseBoolean(query.obrigatorio);

  if (
    pagina === null ||
    limite === null ||
    limite > LIMITE_MAXIMO ||
    [busca, categoria, marca, linha, provider, statusProgresso].includes(null) ||
    ativo === undefined ||
    destaque === undefined ||
    obrigatorio === undefined ||
    (provider && !TRAINING_PROVIDERS.includes(provider)) ||
    (statusProgresso && !TRAINING_PROGRESS_STATUSES.includes(statusProgresso))
  ) {
    return null;
  }

  return {
    pagina,
    limite,
    busca,
    categoria,
    marca,
    linha,
    provider,
    statusProgresso,
    ativo,
    destaque,
    obrigatorio,
  };
};

export const buildTrainingFilter = (
  query,
  { onlyAvailable = false, now = new Date() } = {}
) => {
  const filter = {};

  if (onlyAvailable) {
    filter.ativo = true;
    filter.publicadoEm = { $ne: null, $lte: now };
  } else if (query.ativo !== null) {
    filter.ativo = query.ativo;
  }

  if (query.destaque !== null) filter.destaque = query.destaque;
  if (query.obrigatorio !== null) filter.obrigatorio = query.obrigatorio;
  if (query.categoria) filter.categoria = query.categoria;
  if (query.marca) filter.marca = query.marca;
  if (query.linha) filter.linha = query.linha;
  if (query.provider) filter.provider = query.provider;

  if (query.busca) {
    const regex = new RegExp(escapeRegex(query.busca), "i");
    filter.$or = [
      { titulo: regex },
      { descricao: regex },
      { resumo: regex },
      { categoria: regex },
      { marca: regex },
      { linha: regex },
      { instrutor: regex },
    ];
  }

  return filter;
};

export const validateTrainingPayload = (
  body = {},
  { allowEmpty = false, partial = false } = {}
) => {
  const source = body && typeof body === "object" && !Array.isArray(body)
    ? body
    : {};
  const data = {};
  const errors = {};

  for (const [field, rules] of Object.entries(camposTexto)) {
    const supplied = Object.hasOwn(source, field);
    if (!supplied) {
      if (!partial && rules.required) errors[field] = "Campo obrigatório";
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

  if (Object.hasOwn(source, "provider")) {
    if (!TRAINING_PROVIDERS.includes(source.provider)) {
      errors.provider = "Provedor de vídeo inválido";
    } else {
      data.provider = source.provider;
    }
  } else if (!partial) {
    data.provider = "youtube";
  }

  if (Object.hasOwn(source, "videoId")) {
    const videoId = extractYouTubeVideoId(source.videoId);
    if (!videoId) errors.videoId = "Informe um ID ou link válido do YouTube";
    else data.videoId = videoId;
  } else if (!partial) {
    errors.videoId = "Campo obrigatório";
  }

  for (const field of ["destaque", "obrigatorio", "ativo"]) {
    if (!Object.hasOwn(source, field)) continue;
    const parsed = parsePayloadBoolean(source[field]);
    if (parsed === undefined) errors[field] = "Informe verdadeiro ou falso";
    else data[field] = parsed;
  }

  if (Object.hasOwn(source, "duracaoSegundos")) {
    const duration = Number(source.duracaoSegundos);
    if (!Number.isFinite(duration) || duration < 0 || duration > MAX_VIDEO_DURATION_SECONDS) {
      errors.duracaoSegundos = "Informe uma duração válida de até 24 horas";
    } else {
      data.duracaoSegundos = Math.round(duration);
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

  if (Object.hasOwn(source, "publicadoEm")) {
    if (source.publicadoEm === null || source.publicadoEm === "") {
      data.publicadoEm = null;
    } else {
      const date = new Date(source.publicadoEm);
      if (Number.isNaN(date.getTime())) errors.publicadoEm = "Informe uma data válida";
      else data.publicadoEm = date;
    }
  }

  if (
    partial &&
    !allowEmpty &&
    Object.keys(data).length === 0 &&
    Object.keys(errors).length === 0
  ) {
    errors.formulario = "Informe ao menos um campo válido";
  }

  return { valid: Object.keys(errors).length === 0, data, errors };
};

export const validateProgressPayload = (body = {}) => {
  const source = body && typeof body === "object" && !Array.isArray(body)
    ? body
    : {};
  const position = Number(source.posicaoSegundos);
  const duration = Number(source.duracaoSegundos);
  const errors = {};

  if (!Number.isFinite(position) || position < 0 || position > MAX_VIDEO_DURATION_SECONDS) {
    errors.posicaoSegundos = "Informe uma posição válida";
  }
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_DURATION_SECONDS) {
    errors.duracaoSegundos = "Informe uma duração válida";
  }
  if (Object.keys(errors).length === 0 && position > duration + 30) {
    errors.posicaoSegundos = "A posição não pode ultrapassar a duração do vídeo";
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors, data: null };
  }

  const safePosition = Math.min(position, duration);
  const percentualAssistido = Math.min(
    100,
    Math.round((safePosition / duration) * 10000) / 100
  );

  return {
    valid: true,
    errors: {},
    data: {
      posicaoSegundos: Math.round(safePosition),
      duracaoSegundos: Math.round(duration),
      percentualAssistido,
      concluido: percentualAssistido >= TRAINING_COMPLETION_THRESHOLD,
    },
  };
};
