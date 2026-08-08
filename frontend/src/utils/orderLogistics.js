export const ORDER_STATUS = Object.freeze([
  "novo",
  "em_analise",
  "separando",
  "separado",
  "faturado",
  "enviado",
  "entregue",
  "cancelado",
]);

export const ORDER_STATUS_LABELS = Object.freeze({
  novo: "Pedido recebido",
  em_analise: "Em análise",
  separando: "Em separação",
  separado: "Separado",
  faturado: "Faturado",
  enviado: "Enviado",
  entregue: "Entregue",
  cancelado: "Cancelado",
});

export const ORDER_PROGRESS_STEPS = Object.freeze([
  "novo",
  "separando",
  "separado",
  "faturado",
  "enviado",
  "entregue",
]);

export const formatOrderStatus = (status) => ORDER_STATUS_LABELS[status] || status || "-";

export const getOrderProgress = (status) => {
  if (status === "cancelado") return { canceled: true, currentIndex: -1 };
  if (status === "em_analise") return { canceled: false, currentIndex: 0 };
  const currentIndex = ORDER_PROGRESS_STEPS.indexOf(status);
  return { canceled: false, currentIndex: Math.max(currentIndex, 0) };
};

export const formatOrderDate = (value, fallback = "-") => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? fallback
    : date.toLocaleDateString("pt-BR");
};

export const formatOrderDateTime = (value, fallback = "-") => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? fallback
    : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

export const formatCurrency = (value) => Number(value || 0).toLocaleString("pt-BR", {
  style: "currency",
  currency: "BRL",
});
