import Pedido from "../models/Pedido.js";

const formatarDataPedido = (data) => {
  const dia = String(data.getDate()).padStart(2, "0");
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const ano = data.getFullYear();

  return `${dia}${mes}${ano}`;
};

export const gerarNumeroPedido = async () => {
  const hoje = new Date();

  const inicioDia = new Date(
    hoje.getFullYear(),
    hoje.getMonth(),
    hoje.getDate(),
    0,
    0,
    0
  );

  const fimDia = new Date(
    hoje.getFullYear(),
    hoje.getMonth(),
    hoje.getDate(),
    23,
    59,
    59
  );

  const totalPedidosHoje = await Pedido.countDocuments({
    createdAt: {
      $gte: inicioDia,
      $lte: fimDia,
    },
  });

  const sequencial = String(totalPedidosHoje + 1).padStart(4, "0");

  return `AP-${formatarDataPedido(hoje)}-${sequencial}`;
};