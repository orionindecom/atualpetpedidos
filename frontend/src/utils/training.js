const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export const TRAINING_CATEGORIES = [
  "Produtos",
  "Técnicas de Banho e Tosa",
  "Aplicação de Produtos",
  "Comercial",
  "Vendas",
  "Marketing",
  "Lançamentos",
  "Institucional",
  "Atendimento",
  "Outros",
];

export function extractYouTubeVideoId(value) {
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
        candidate = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})\/?$/)?.[1] || "";
      }
    } else {
      return null;
    }

    return YOUTUBE_ID_PATTERN.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export function getTrainingThumbnail({ provider, videoId, thumbnailUrl }) {
  if (thumbnailUrl) return thumbnailUrl;
  if (provider === "youtube" && YOUTUBE_ID_PATTERN.test(videoId || "")) {
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }
  return "";
}

export function getPlayerKind(provider) {
  return provider === "youtube" ? "youtube" : "unsupported";
}

export function clampProgress(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, number));
}

export function getTrainingProgressState(progress = {}) {
  if (progress.concluido) {
    return { key: "concluido", label: "Concluído", action: "Assistir novamente" };
  }
  if (clampProgress(progress.percentualAssistido) > 0) {
    return { key: "em_andamento", label: "Em andamento", action: "Continuar" };
  }
  return { key: "nao_iniciado", label: "Não iniciado", action: "Começar treinamento" };
}

export function formatTrainingDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (!total) return "Duração não informada";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}min`;
  return `${Math.max(1, minutes)} min`;
}

export function normalizeTrainingResponse(data, { pagina = 1, limite = 12 } = {}) {
  const treinamentos = Array.isArray(data?.treinamentos) ? data.treinamentos : [];
  const pagination = data?.paginacao || {};
  const filters = data?.filtros || {};

  return {
    treinamentos,
    paginacao: {
      paginaAtual: Number(pagination.paginaAtual) || pagina,
      totalPaginas: Number(pagination.totalPaginas) || 0,
      totalItens: Number(pagination.totalItens) || 0,
      limite: Number(pagination.limite) || limite,
      temProximaPagina: Boolean(pagination.temProximaPagina),
    },
    filtros: {
      categorias: Array.isArray(filters.categorias) ? filters.categorias : [],
      marcas: Array.isArray(filters.marcas) ? filters.marcas : [],
      linhas: Array.isArray(filters.linhas) ? filters.linhas : [],
    },
  };
}

export function appendUniqueTrainings(current, next) {
  const ids = new Set(current.map((training) => training.id || training._id));
  return [
    ...current,
    ...next.filter((training) => !ids.has(training.id || training._id)),
  ];
}

const sanitizeWatermarkPart = (value, fallback) => {
  if (typeof value !== "string") return fallback;
  const sanitized = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("").trim();
  return sanitized.slice(0, 60) || fallback;
};

export function buildTrainingWatermark(usuario = {}) {
  const id = String(usuario._id || usuario.id || "").replace(/[^A-Za-z0-9]/g, "");
  return {
    nome: sanitizeWatermarkPart(usuario.nomeResponsavel, "Distribuidor AtualPet"),
    cliente: sanitizeWatermarkPart(usuario.nomeFantasia, "Acesso exclusivo AtualPet"),
    sessao: id ? id.slice(-6).toUpperCase() : "PORTAL",
  };
}

export function createProgressThrottle(
  callback,
  { interval = 15000, now = () => Date.now() } = {}
) {
  let lastSentAt = null;

  return {
    run(payload, { force = false } = {}) {
      const currentTime = now();
      if (
        !force &&
        lastSentAt !== null &&
        currentTime - lastSentAt < interval
      ) {
        return false;
      }
      lastSentAt = currentTime;
      callback(payload);
      return true;
    },
    reset() {
      lastSentAt = null;
    },
  };
}
