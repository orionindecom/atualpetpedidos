import Pedido from "../models/Pedido.js";
import { calcularNecessidadeProducao, STATUS_NECESSIDADE_PRODUCAO } from "../utils/necessidadeProducao.js";
import { sendServerError } from "../utils/validation.js";

export const obterNecessidadeProducao = async (req, res) => {
  try {
    // O cálculo valida início e itens processados após este pré-filtro.
    // Não paginar antes de consolidar as faltas identificadas.
    const pedidos = await Pedido.find({ status: { $in: STATUS_NECESSIDADE_PRODUCAO } })
      .select("numeroPedido clienteId nomeFantasiaCliente razaoSocialCliente nomeResponsavel status createdAt dataPedido dataEntrega aprovacao +historicoStatus itens.produtoId itens.nomeProduto itens.quantidade itens.quantidadeSeparada itens.situacaoSeparacao itens.quantidadeFinal")
      .lean().maxTimeMS(5000);
    return res.status(200).json(calcularNecessidadeProducao(pedidos));
  } catch {
    return sendServerError(res, "Não foi possível carregar a necessidade de produção");
  }
};
