export const ORDER_STATUS = Object.freeze([
  "aguardando_aprovacao",
  "aprovado",
  "novo",
  "em_analise",
  "separando",
  "separado",
  "faturado",
  "enviado",
  "entregue",
  "retirado",
  "cancelado",
]);

export const ORDER_STATUS_LABELS = Object.freeze({
  aguardando_aprovacao: "Aguardando aprovação",
  aprovado: "Aprovado para Logística",
  novo: "Pedido recebido",
  em_analise: "Em análise",
  separando: "Em separação",
  separado: "Separado",
  faturado: "Faturado",
  enviado: "Enviado",
  entregue: "Entregue",
  retirado: "Retirado pelo distribuidor",
  cancelado: "Cancelado",
});

export const ORDER_PROGRESS_STEPS = Object.freeze([
  "aguardando_aprovacao",
  "aprovado",
  "separando",
  "separado",
  "faturado",
  "enviado",
  "entregue",
]);

export const formatOrderStatus = (status) => ORDER_STATUS_LABELS[status] || status || "-";

export const getOrderProgress = (status) => {
  if (status === "retirado") return { canceled: false, collected: true, currentIndex: -1 };
  if (status === "cancelado") return { canceled: true, currentIndex: -1 };
  if (["novo", "em_analise"].includes(status)) {
    return { canceled: false, currentIndex: 1 };
  }
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

export const formatOrderPickupDate = (value, fallback = "-") => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const options = { timeZone: "America/Sao_Paulo" };
  return `${date.toLocaleDateString("pt-BR", options)} às ${date.toLocaleTimeString("pt-BR", { ...options, hour: "2-digit", minute: "2-digit" })}`;
};
