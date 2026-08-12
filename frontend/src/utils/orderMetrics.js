export const METRICS_PERIODS = Object.freeze([
  { value: "hoje", label: "Hoje" },
  { value: "7dias", label: "Últimos 7 dias" },
  { value: "30dias", label: "Últimos 30 dias" },
  { value: "mes_atual", label: "Mês atual" },
  { value: "personalizado", label: "Período personalizado" },
]);

export const buildOrderMetricsParams = (filters) => ({
  periodo: filters.periodo,
  ...(filters.periodo === "personalizado"
    ? { dataInicio: filters.dataInicio, dataFim: filters.dataFim }
    : {}),
  ...(filters.operadorId ? { operadorId: filters.operadorId } : {}),
});

export const formatDuration = (milliseconds) => {
  if (!Number.isFinite(milliseconds)) return "Sem amostra";
  const totalMinutes = Math.round(milliseconds / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}min`);
  return parts.join(" ");
};

export const formatPercentage = (value) => (
  `${Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
);

export const getMetricsErrorMessage = (error, fallback) => {
  const validationErrors = error.response?.data?.errors;
  if (validationErrors) return Object.values(validationErrors)[0];
  return error.response?.data?.message || fallback;
};

export const getAttentionLabel = (classification) => ({
  aguardando: "Aguardando",
  em_andamento: "Em andamento",
  acima_tempo_normal: "Acima do tempo normal",
}[classification] || classification);

