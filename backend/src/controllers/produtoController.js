import Produto from "../models/Produto.js";

export const cadastrarProduto = async (req, res) => {
  try {
    const produto = await Produto.create(req.body);

    res.status(201).json({
      message: "Produto cadastrado com sucesso",
      produto,
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
};

export const listarProdutos = async (req, res) => {
  try {
    const produtos = await Produto.find({
      ativo: true,
    });

    res.status(200).json(produtos);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
};