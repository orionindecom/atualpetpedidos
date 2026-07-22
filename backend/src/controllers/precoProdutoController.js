import PrecoProduto from "../models/PrecoProduto.js";
import Produto from "../models/Produto.js";
import TabelaPreco from "../models/TabelaPreco.js";
import { Types } from "mongoose";
import {
  isValidObjectId,
  sendServerError,
  toPositiveNumber,
} from "../utils/validation.js";
import { measureStage, measureStageSync } from "../utils/performance.js";

export const criarPipelinePrecosPorTabela = (tabelaPrecoId) => [
  { $match: { tabelaPrecoId: new Types.ObjectId(tabelaPrecoId) } },
  {
    $lookup: {
      from: "produtos",
      localField: "produtoId",
      foreignField: "_id",
      as: "produto",
    },
  },
  {
    $set: {
      produtoId: {
        $ifNull: [
          {
            $arrayElemAt: [
              {
                $map: {
                  input: "$produto",
                  as: "produtoRelacionado",
                  in: {
                    $mergeObjects: [
                      { ativo: true },
                      "$$produtoRelacionado",
                    ],
                  },
                },
              },
              0,
            ],
          },
          null,
        ],
      },
    },
  },
  { $unset: "produto" },
];

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

    const filtroPreco = {
      produtoId,
      tabelaPrecoId,
    };
    let resultado;

    try {
      resultado = await PrecoProduto.updateOne(
        filtroPreco,
        { $set: { valor: valorNumerico } },
        { upsert: true, runValidators: true }
      );
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }

      resultado = await PrecoProduto.updateOne(
        filtroPreco,
        { $set: { valor: valorNumerico } },
        { runValidators: true }
      );
    }

    const preco = await PrecoProduto.findOne(filtroPreco).lean();
    const criado = resultado.upsertedCount > 0;

    return res.status(criado ? 201 : 200).json({
      message: criado
        ? "Preço cadastrado com sucesso"
        : "Preço atualizado com sucesso",
      preco,
    });
  } catch (error) {
    return sendServerError(res);
  }
};
export const listarPrecosPorTabela = async (req, res) => {
  try {
    const { tabelaPrecoId } = req.params;

    const precos = await measureStage(req, "query.precos_lookup", () =>
      PrecoProduto.aggregate(criarPipelinePrecosPorTabela(tabelaPrecoId))
    );

    return measureStageSync(req, "response.precos", () =>
      res.status(200).json(precos)
    );
  } catch (error) {
    return sendServerError(res);
  }
};
