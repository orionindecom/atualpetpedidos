import { isValidObjectId } from "./validation.js";

export const METRICS_TIME_ZONE = "America/Sao_Paulo";
export const METRICS_MAX_PERIOD_DAYS = 366;
export const METRICS_MIN_STATISTICAL_SAMPLE = 5;

export const PEDIDO_METRICAS_LIMITES_MS = Object.freeze({
  aprovacao: 24 * 60 * 60 * 1000,
  esperaSeparacao: 8 * 60 * 60 * 1000,
  separacao: 4 * 60 * 60 * 1000,
  esperaConferencia: 2 * 60 * 60 * 1000,
  conferencia: 2 * 60 * 60 * 1000,
});

const PERIOD_PRESETS = new Set([
  "hoje",
  "7dias",
  "30dias",
  "mes_atual",
  "personalizado",
]);

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const finiteDurations = (values = []) => values
  .map(Number)
  .filter((value) => Number.isFinite(value) && value >= 0);

export const media = (values = []) => {
  const valid = finiteDurations(values);
  if (valid.length === 0) return null;
  return valid.reduce((total, value) => total + value, 0) / valid.length;
};

export const mediana = (values = []) => {
  const valid = finiteDurations(values).sort((left, right) => left - right);
  if (valid.length === 0) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 === 0
    ? (valid[middle - 1] + valid[middle]) / 2
    : valid[middle];
};

export const percentil = (values = [], percentile = 90) => {
  const valid = finiteDurations(values).sort((left, right) => left - right);
  if (valid.length === 0) return null;
  const normalized = Math.min(Math.max(Number(percentile), 0), 100);
  const rank = Math.max(Math.ceil((normalized / 100) * valid.length) - 1, 0);
  return valid[rank];
};

export const resumirDuracoes = (values = []) => {
  const valid = finiteDurations(values);
  return {
    mediaMs: media(valid),
    medianaMs: mediana(valid),
    p90Ms: percentil(valid, 90),
    amostra: valid.length,
  };
};

export const asValidDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const duracaoValida = (inicio, fim) => {
  const start = asValidDate(inicio);
  const end = asValidDate(fim);
  if (!start || !end || end < start) return null;
  return end.getTime() - start.getTime();
};

const zonedFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: METRICS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const getZonedParts = (date) => Object.fromEntries(
  zonedFormatter.formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)])
);

const zonedTimeToUtc = ({ year, month, day, hour = 0, minute = 0, second = 0 }) => {
  const guessedUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstParts = getZonedParts(new Date(guessedUtc));
  const firstAsUtc = Date.UTC(
    firstParts.year,
    firstParts.month - 1,
    firstParts.day,
    firstParts.hour,
    firstParts.minute,
    firstParts.second
  );
  const firstResult = guessedUtc - (firstAsUtc - guessedUtc);
  const secondParts = getZonedParts(new Date(firstResult));
  const secondAsUtc = Date.UTC(
    secondParts.year,
    secondParts.month - 1,
    secondParts.day,
    secondParts.hour,
    secondParts.minute,
    secondParts.second
  );
  return new Date(firstResult - (secondAsUtc - guessedUtc));
};

const parseDateOnly = (value) => {
  if (!DATE_ONLY_PATTERN.test(value || "")) return null;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) return null;
  return { year, month, day };
};

const shiftCalendarDate = (parts, days) => {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
};

const toDateOnly = ({ year, month, day }) => (
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
);

const calendarDistanceDays = (start, end) => (
  Math.floor((
    Date.UTC(end.year, end.month - 1, end.day) -
    Date.UTC(start.year, start.month - 1, start.day)
  ) / (24 * 60 * 60 * 1000)) + 1
);

export const parsePedidoMetricasQuery = (query = {}, now = new Date()) => {
  const preset = query.periodo || "30dias";
  const errors = {};
  if (!PERIOD_PRESETS.has(preset)) errors.periodo = "Período inválido";

  let startParts;
  let endParts;
  const today = getZonedParts(asValidDate(now) || new Date());
  const todayParts = { year: today.year, month: today.month, day: today.day };

  if (preset === "personalizado") {
    startParts = parseDateOnly(query.dataInicio);
    endParts = parseDateOnly(query.dataFim);
    if (!startParts) errors.dataInicio = "Data inicial inválida";
    if (!endParts) errors.dataFim = "Data final inválida";
  } else if (preset === "hoje") {
    startParts = todayParts;
    endParts = todayParts;
  } else if (preset === "7dias") {
    startParts = shiftCalendarDate(todayParts, -6);
    endParts = todayParts;
  } else if (preset === "mes_atual") {
    startParts = { ...todayParts, day: 1 };
    endParts = todayParts;
  } else {
    startParts = shiftCalendarDate(todayParts, -29);
    endParts = todayParts;
  }

  if (startParts && endParts) {
    const days = calendarDistanceDays(startParts, endParts);
    if (days < 1) errors.dataFim = "A data final deve ser posterior à data inicial";
    if (days > METRICS_MAX_PERIOD_DAYS) {
      errors.dataFim = `O período máximo é de ${METRICS_MAX_PERIOD_DAYS} dias`;
    }
  }

  const operadorId = typeof query.operadorId === "string" ? query.operadorId.trim() : "";
  if (operadorId && !isValidObjectId(operadorId)) {
    errors.operadorId = "Operador inválido";
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  const nextDay = shiftCalendarDate(endParts, 1);
  const inicio = zonedTimeToUtc(startParts);
  const fim = new Date(zonedTimeToUtc(nextDay).getTime() - 1);

  return {
    valid: true,
    data: {
      periodo: preset,
      dataInicio: toDateOnly(startParts),
      dataFim: toDateOnly(endParts),
      inicio,
      fim,
      operadorId,
      timezone: METRICS_TIME_ZONE,
    },
  };
};

export const obterLimiteEtapa = (estatistica, etapa) => {
  if (
    estatistica?.amostra >= METRICS_MIN_STATISTICAL_SAMPLE &&
    Number.isFinite(estatistica?.p90Ms)
  ) {
    return {
      limiteMs: estatistica.p90Ms,
      origem: "p90",
      amostra: estatistica.amostra,
    };
  }
  return {
    limiteMs: PEDIDO_METRICAS_LIMITES_MS[etapa],
    origem: "limite_fixo",
    amostra: estatistica?.amostra || 0,
  };
};

