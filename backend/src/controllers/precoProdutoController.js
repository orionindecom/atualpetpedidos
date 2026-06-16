import PrecoProduto from "../models/PrecoProduto.js";

export const definirPrecoProduto = async (req, res) => {
  try {
    const { produtoId, tabelaPrecoId, valor } = req.body;

    const precoExistente = await PrecoProduto.findOne({
      produtoId,
      tabelaPrecoId,
    });

    if (precoExistente) {
      precoExistente.valor = valor;
      await precoExistente.save();

      return res.status(200).json({
        message: "Preço atualizado com sucesso",
        preco: precoExistente,
      });
    }

    const preco = await PrecoProduto.create({
      produtoId,
      tabelaPrecoId,
      valor,
    });

    res.status(201).json({
      message: "Preço cadastrado com sucesso",
      preco,
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
};

export const listarPrecosPorTabela = async (req, res) => {
  try {
    const { tabelaPrecoId } = req.params;

    const precos = await PrecoProduto.find({
      tabelaPrecoId,
    }).populate("produtoId");

    res.status(200).json(precos);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
};