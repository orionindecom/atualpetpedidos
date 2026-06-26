import PrecoProduto from "../models/PrecoProduto.js";
import Produto from "../models/Produto.js";
import TabelaPreco from "../models/TabelaPreco.js";
import {
  isValidObjectId,
  sendServerError,
  toPositiveNumber,
} from "../utils/validation.js";

export const definirPrecoProduto = async (req, res) => {
  try {
    const { produtoId, tabelaPrecoId, valor } = req.body;
    const valorNumerico = toPositiveNumber(valor);

    if (
      !isValidObjectId(produtoId) ||
      !isValidObjectId(tabelaPrecoId) ||
      valorNumerico === null
    ) {
      return res.status(400).json({
        message: "Dados de preço inválidos",
      });
    }

    const [produtoExiste, tabelaExiste] = await Promise.all([
      Produto.exists({ _id: produtoId }),
      TabelaPreco.exists({ _id: tabelaPrecoId }),
    ]);

    if (!produtoExiste || !tabelaExiste) {
      return res.status(400).json({
        message: "Produto ou tabela inválidos",
      });
    }

    const precoExistente = await PrecoProduto.findOne({
      produtoId,
      tabelaPrecoId,
    });

    if (precoExistente) {
      precoExistente.valor = valorNumerico;
      await precoExistente.save();

      return res.status(200).json({
        message: "Preço atualizado com sucesso",
        preco: precoExistente,
      });
    }

    const preco = await PrecoProduto.create({
      produtoId,
      tabelaPrecoId,
      valor: valorNumerico,
    });

    return res.status(201).json({
      message: "Preço cadastrado com sucesso",
      preco,
    });
  } catch (error) {
    return sendServerError(res);
  }
};
export const listarPrecosPorTabela = async (req, res) => {
  try {
    const { tabelaPrecoId } = req.params;

    const precos = await PrecoProduto.find({
      tabelaPrecoId,
    }).populate("produtoId");

    return res.status(200).json(precos);
  } catch (error) {
    return sendServerError(res);
  }
};
