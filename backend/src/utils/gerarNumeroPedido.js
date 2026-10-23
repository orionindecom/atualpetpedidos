import Pedido from "../models/Pedido.js";

const formatarDataPedido = (data) => {
  const dia = String(data.getDate()).padStart(2, "0");
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const ano = data.getFullYear();

  return `${dia}${mes}${ano}`;
};

export const gerarNumeroPedido = async () => {
  const prefixo = `AP-${formatarDataPedido(new Date())}-`;

  // O sequencial parte do maior número já emitido no dia, e não da contagem
  // de pedidos: excluir um pedido reduz a contagem e geraria número repetido.
  const ultimoPedido = await Pedido.findOne({
    numeroPedido: { $regex: `^${prefixo}\\d+$` },
  })
    .sort({ numeroPedido: -1 })
    .select("numeroPedido")
    .lean();

  const ultimoSequencial = Number(ultimoPedido?.numeroPedido.slice(prefixo.length)) || 0;
  const sequencial = String(ultimoSequencial + 1).padStart(4, "0");

  return `${prefixo}${sequencial}`;
};
