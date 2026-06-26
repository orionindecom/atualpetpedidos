import Pedido from "../models/Pedido.js";
import Usuario from "../models/Usuario.js";
import PrecoProduto from "../models/PrecoProduto.js";
import Produto from "../models/Produto.js";
import TabelaPreco from "../models/TabelaPreco.js";
import { gerarNumeroPedido } from "../utils/gerarNumeroPedido.js";
import { gerarPdfPedido } from "../services/pdfService.js";
import {
  isOptionalString,
  isValidObjectId,
  sendServerError,
  toPositiveNumber,
} from "../utils/validation.js";

const statusPermitidos = new Set([
  "novo",
  "em_analise",
  "separando",
  "faturado",
  "enviado",
  "entregue",
  "cancelado",
]);

const validarItens = (itens) => (
  Array.isArray(itens) &&
  itens.length > 0 &&
  itens.length <= 200
);

const montarItensPedido = async (itens, tabelaPrecoId) => {
  const itensPedido = [];
  let valorTotal = 0;

  for (const item of itens) {
    if (!isValidObjectId(item?.produtoId)) {
      continue;
    }

    const quantidade = toPositiveNumber(item.quantidade);

    if (!quantidade || quantidade > 999999) {
      continue;
    }

    const produto = await Produto.findById(item.produtoId);

    if (!produto || !produto.ativo) {
      continue;
    }

    const preco = await PrecoProduto.findOne({
      produtoId: produto._id,
      tabelaPrecoId,
    });

    if (!preco) {
      continue;
    }

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

  return {
    itensPedido,
    valorTotal,
  };
};

export const criarPedido = async (req, res) => {
  try {
    const { itens, observacao } = req.body;

    if (!validarItens(itens) || !isOptionalString(observacao, 1000)) {
      return res.status(400).json({
        message: "Dados do pedido inválidos",
      });
    }

    const cliente = await Usuario.findById(req.usuario._id);

    if (!cliente?.tabelaPrecoId) {
      return res.status(400).json({
        message: "Cliente sem tabela de preço vinculada",
      });
    }

    const tabela = await TabelaPreco.findById(cliente.tabelaPrecoId);

    if (!tabela || !tabela.ativa) {
      return res.status(400).json({
        message: "Tabela de preço indisponível",
      });
    }

    const { itensPedido, valorTotal } = await montarItensPedido(
      itens,
      cliente.tabelaPrecoId
    );

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
      nomeTabela: tabela.nome,

      dia: agora.getDate(),
      mes: agora.getMonth() + 1,
      ano: agora.getFullYear(),

      itens: itensPedido,
      valorTotal,
      observacao: observacao?.trim(),
    });

    return res.status(201).json({
      message: "Pedido criado com sucesso",
      pedido,
    });
  } catch (error) {
    return sendServerError(res);
  }
};

export const listarMeusPedidos = async (req, res) => {
  try {
    const pedidos = await Pedido.find({
      clienteId: req.usuario._id,
    }).sort({ createdAt: -1 });

    return res.status(200).json(pedidos);
  } catch (error) {
    return sendServerError(res);
  }
};

export const listarTodosPedidos = async (req, res) => {
  try {
    const pedidos = await Pedido.find().sort({ createdAt: -1 });

    return res.status(200).json(pedidos);
  } catch (error) {
    return sendServerError(res);
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

    return res.status(200).json(pedido);
  } catch (error) {
    return sendServerError(res);
  }
};

export const gerarPdf = async (req, res) => {
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
        message: "Sem permissão",
      });
    }

    return gerarPdfPedido(pedido, res);
  } catch (error) {
    return sendServerError(res);
  }
};

export const atualizarStatusPedido = async (req, res) => {
  try {
    const { status } = req.body;

    if (!statusPermitidos.has(status)) {
      return res.status(400).json({
        message: "Status inválido",
      });
    }

    const pedido = await Pedido.findById(req.params.id);

    if (!pedido) {
      return res.status(404).json({
        message: "Pedido não encontrado",
      });
    }

    pedido.status = status;

    await pedido.save();

    return res.status(200).json({
      message: "Status atualizado",
      pedido,
    });
  } catch (error) {
    return sendServerError(res);
  }
};

export const atualizarPedidoAdmin = async (req, res) => {
  try {
    const { itens, observacao } = req.body;

    if (!validarItens(itens) || !isOptionalString(observacao, 1000)) {
      return res.status(400).json({
        message: "Dados do pedido inválidos",
      });
    }

    const pedido = await Pedido.findById(req.params.id);

    if (!pedido) {
      return res.status(404).json({
        message: "Pedido não encontrado",
      });
    }

    const { itensPedido, valorTotal } = await montarItensPedido(
      itens,
      pedido.tabelaPrecoId
    );

    if (itensPedido.length === 0) {
      return res.status(400).json({
        message: "Nenhum item válido encontrado",
      });
    }

    pedido.itens = itensPedido;
    pedido.valorTotal = valorTotal;
    pedido.observacao = observacao?.trim() ?? pedido.observacao;

    await pedido.save();

    return res.status(200).json({
      message: "Pedido atualizado com sucesso",
      pedido,
    });
  } catch (error) {
    return sendServerError(res);
  }
};

export const excluirPedidoAdmin = async (req, res) => {
  try {
    const pedido = await Pedido.findById(req.params.id);

    if (!pedido) {
      return res.status(404).json({
        message: "Pedido não encontrado",
      });
    }

    await Pedido.findByIdAndDelete(req.params.id);

    return res.status(200).json({
      message: "Pedido excluído com sucesso",
    });
  } catch (error) {
    return sendServerError(res);
  }
};
