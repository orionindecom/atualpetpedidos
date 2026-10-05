// Resumo de pedidos para os painéis. Mantém os status existentes, sem criar novos.
const FINAL = ["entregue", "retirado", "cancelado"];

const orderTime = (pedido) => new Date(pedido.dataPedido || pedido.createdAt || 0).getTime() || 0;

export function summarizeOrders(pedidos = []) {
  const list = Array.isArray(pedidos) ? pedidos : [];
  return {
    total: list.length,
    emAndamento: list.filter((pedido) => !FINAL.includes(pedido.status) && pedido.status !== "enviado").length,
    aguardandoAprovacao: list.filter((pedido) => pedido.status === "aguardando_aprovacao").length,
    aguardandoRecebimento: list.filter((pedido) => pedido.status === "enviado").length,
    concluidos: list.filter((pedido) => ["entregue", "retirado"].includes(pedido.status)).length,
    recentes: [...list].sort((a, b) => orderTime(b) - orderTime(a)).slice(0, 5),
  };
}
