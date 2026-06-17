import Produto from "../models/Produto.js";

export const cadastrarProduto = async (req, res) => {
  try {
    const {
      nome,
      descricao,
      linha,
      categoria,
    } = req.body;

    const fotoUrl = req.file
      ? `/uploads/produtos/${req.file.filename}`
      : "";

    const produto = await Produto.create({
      nome,
      descricao,
      linha,
      categoria,
      fotoUrl,
    });

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

export const atualizarProduto = async (req, res) => {
  try {
    const { nome, descricao, linha, categoria, ativo } = req.body;

    const produto = await Produto.findById(req.params.id);

    if (!produto) {
      return res.status(404).json({
        message: "Produto não encontrado",
      });
    }

    produto.nome = nome ?? produto.nome;
    produto.descricao = descricao ?? produto.descricao;
    produto.linha = linha ?? produto.linha;
    produto.categoria = categoria ?? produto.categoria;

    if (ativo !== undefined) {
      produto.ativo = ativo;
    }

    if (req.file) {
      produto.fotoUrl = `/uploads/produtos/${req.file.filename}`;
    }

    await produto.save();

    res.status(200).json({
      message: "Produto atualizado com sucesso",
      produto,
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
};

export const inativarProduto = async (req, res) => {
  try {
    const produto = await Produto.findById(req.params.id);

    if (!produto) {
      return res.status(404).json({
        message: "Produto não encontrado",
      });
    }

    produto.ativo = false;

    await produto.save();

    res.status(200).json({
      message: "Produto inativado com sucesso",
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
};