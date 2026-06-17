import Pedido from "../models/Pedido.js";
import Usuario from "../models/Usuario.js";
import PrecoProduto from "../models/PrecoProduto.js";
import Produto from "../models/Produto.js";
import TabelaPreco from "../models/TabelaPreco.js";
import { gerarNumeroPedido } from "../utils/gerarNumeroPedido.js";
import { gerarPdfPedido } from "../services/pdfService.js";

export const criarPedido = async (req, res) => {
  try {
    const { itens, observacao } = req.body;

    if (!itens || itens.length === 0) {
      return res.status(400).json({
        message: "Informe pelo menos um item",
      });
    }

    const cliente = await Usuario.findById(req.usuario._id);

    if (!cliente.tabelaPrecoId) {
      return res.status(400).json({
        message: "Cliente sem tabela de preço vinculada",
      });
    }

    const tabela = await TabelaPreco.findById(cliente.tabelaPrecoId);

    const itensPedido = [];
    let valorTotal = 0;

    for (const item of itens) {
      const produto = await Produto.findById(item.produtoId);

      if (!produto) continue;

      const preco = await PrecoProduto.findOne({
        produtoId: produto._id,
        tabelaPrecoId: cliente.tabelaPrecoId,
      });

      if (!preco) continue;

      const quantidade = Number(item.quantidade);

      if (!quantidade || quantidade <= 0) continue;

      const subtotal = preco.valor * quantidade;

      valorTotal += subtotal;

      itensPedido.push({
        produtoId: produto._id,
        nomeProduto: produto.nome,
        quantidade,
        valorUnitario: preco.valor,
        subtotal,
      });
    }

    if (itensPedido.length === 0) {
      return res.status(400).json({
        message:
          "Nenhum item válido encontrado. Verifique se os produtos possuem preço na tabela do cliente.",
      });
    }

    const agora = new Date();

    const pedido = await Pedido.create({
      numeroPedido: await gerarNumeroPedido(),

      clienteId: cliente._id,
      nomeResponsavel: cliente.nomeResponsavel,
      nomeFantasiaCliente: cliente.nomeFantasia,
      razaoSocialCliente: cliente.razaoSocial,
      cnpjCliente: cliente.cnpj,
      emailCliente: cliente.email,
      telefoneCliente: cliente.telefone,
      whatsappCliente: cliente.whatsapp,

      tabelaPrecoId: cliente.tabelaPrecoId,
      nomeTabela: tabela?.nome,

      dia: agora.getDate(),
      mes: agora.getMonth() + 1,
      ano: agora.getFullYear(),

      itens: itensPedido,
      valorTotal,
      observacao,
    });

    res.status(201).json({
      message: "Pedido criado com sucesso",
      pedido,
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
};

export const listarMeusPedidos = async (req, res) => {
  try {
    const pedidos = await Pedido.find({
      clienteId: req.usuario._id,
    }).sort({ createdAt: -1 });

    res.status(200).json(pedidos);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
};

export const listarTodosPedidos = async (req, res) => {
  try {
    const pedidos = await Pedido.find().sort({ createdAt: -1 });

    res.status(200).json(pedidos);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
};

export const buscarPedidoPorId = async (req, res) => {
  try {
    const pedido = await Pedido.findById(req.params.id);

    if (!pedido) {
      return res.status(404).json({
        message: "Pedido não encontrado",
      });
    }

    if (
      req.usuario.tipo !== "admin" &&
      String(pedido.clienteId) !== String(req.usuario._id)
    ) {
      return res.status(403).json({
        message: "Você não tem permissão para acessar este pedido",
      });
    }

    res.status(200).json(pedido);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
};

export const gerarPdf = async (req, res) => {
  try {
    const pedido = await Pedido.findById(
      req.params.id
    );

    if (!pedido) {
      return res.status(404).json({
        message: "Pedido não encontrado",
      });
    }

    if (
      req.usuario.tipo !== "admin" &&
      String(pedido.clienteId) !== String(req.usuario._id)
    ) {
      return res.status(403).json({
        message: "Sem permissão",
      });
    }

    gerarPdfPedido(pedido, res);

  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
};

export const atualizarStatusPedido = async (req, res) => {
  try {
    const { status } = req.body;

    const pedido = await Pedido.findById(
      req.params.id
    );

    if (!pedido) {
      return res.status(404).json({
        message: "Pedido não encontrado",
      });
    }

    pedido.status = status;

    await pedido.save();

    res.status(200).json({
      message: "Status atualizado",
      pedido,
    });

  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
};