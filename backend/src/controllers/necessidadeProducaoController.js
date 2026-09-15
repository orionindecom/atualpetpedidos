import Pedido from "../models/Pedido.js";
import { calcularNecessidadeProducao, STATUS_NECESSIDADE_PRODUCAO } from "../utils/necessidadeProducao.js";
import { sendServerError } from "../utils/validation.js";

export const obterNecessidadeProducao = async (req, res) => {
  try {
    // Incluir todos os itens, mesmo sem registro de separação.
    // Não paginar antes de consolidar as faltas.
    const pedidos = await Pedido.find({ status: { $in: STATUS_NECESSIDADE_PRODUCAO } })
      .select("numeroPedido clienteId nomeFantasiaCliente razaoSocialCliente nomeResponsavel status createdAt dataPedido dataEntrega +historicoStatus itens.produtoId itens.nomeProduto itens.quantidade itens.quantidadeSeparada")
      .lean().maxTimeMS(5000);
    res.set("Cache-Control", "no-store");
    return res.status(200).json(calcularNecessidadeProducao(pedidos));
  } catch {
    return sendServerError(res, "Não foi possível carregar a necessidade de produção");
  }
};
