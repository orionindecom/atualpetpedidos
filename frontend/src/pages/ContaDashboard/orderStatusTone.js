// Mesma leitura de cores usada em Meus Pedidos.
export const orderStatusTone = (status = "") => {
  const value = String(status).toLowerCase();
  if (value.includes("cancel")) return "cancelado";
  if (value.includes("entreg")) return "entregue";
  if (value.includes("envi")) return "enviado";
  if (value.includes("separ") || value.includes("fatur")) return "separacao";
  if (value.includes("nov") || value.includes("aprov") || value.includes("analise")) return "novo";
  return "neutro";
};
