import Produto from "../models/Produto.js";
import {
  isNonEmptyString,
  isOptionalString,
  sendServerError,
} from "../utils/validation.js";
import { uploadImageBuffer } from "../utils/cloudinaryUpload.js";

export const cadastrarProduto = async (req, res) => {
  try {
    const { nome, descricao, linha, categoria } = req.body;

    if (
      !isNonEmptyString(nome, 160) ||
      !isOptionalString(descricao, 1000) ||
      !isNonEmptyString(linha, 120) ||
      !isNonEmptyString(categoria, 120)
    ) {
      return res.status(400).json({
        message: "Dados do produto inválidos",
      });
    }

    const fotoUrl = req.file ? await uploadImageBuffer(req.file) : "";

    const produto = await Produto.create({
      nome: nome.trim(),
      descricao: descricao?.trim(),
      linha: linha.trim(),
      categoria: categoria.trim(),
      fotoUrl,
    });

    return res.status(201).json({
      message: "Produto cadastrado com sucesso",
      produto,
    });
  } catch (error) {
    return sendServerError(res);
  }
};

export const listarProdutos = async (req, res) => {
  try {
    const produtos = await Produto.find({
      ativo: true,
    });

    return res.status(200).json(produtos);
  } catch (error) {
    return sendServerError(res);
  }
};

export const atualizarProduto = async (req, res) => {
  try {
    const { nome, descricao, linha, categoria, ativo } = req.body;

    if (
      !isOptionalString(nome, 160) ||
      !isOptionalString(descricao, 1000) ||
      !isOptionalString(linha, 120) ||
      !isOptionalString(categoria, 120)
    ) {
      return res.status(400).json({
        message: "Dados do produto inválidos",
      });
    }

    const produto = await Produto.findById(req.params.id);

    if (!produto) {
      return res.status(404).json({
        message: "Produto não encontrado",
      });
    }

    produto.nome = nome?.trim() ?? produto.nome;
    produto.descricao = descricao?.trim() ?? produto.descricao;
    produto.linha = linha?.trim() ?? produto.linha;
    produto.categoria = categoria?.trim() ?? produto.categoria;

    if (ativo !== undefined) {
      produto.ativo = ativo === "true" || ativo === true;
    }

    if (req.file) {
      produto.fotoUrl = await uploadImageBuffer(req.file);
    }

    await produto.save();

    return res.status(200).json({
      message: "Produto atualizado com sucesso",
      produto,
    });
  } catch (error) {
    return sendServerError(res);
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

    return res.status(200).json({
      message: "Produto inativado com sucesso",
    });
  } catch (error) {
    return sendServerError(res);
  }
};
