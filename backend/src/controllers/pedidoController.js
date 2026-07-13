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

const MAX_TENTATIVAS_NUMERO_PEDIDO = 5;

const criarPedidoComNumeroUnico = async (dadosPedido) => {
  for (
    let tentativa = 1;
    tentativa <= MAX_TENTATIVAS_NUMERO_PEDIDO;
    tentativa += 1
  ) {
    try {
      return await Pedido.create({
        ...dadosPedido,
        numeroPedido: await gerarNumeroPedido(),
      });
    } catch (error) {
      const colisaoNumeroPedido =
        error?.code === 11000 &&
        (error?.keyPattern?.numeroPedido || error?.keyValue?.numeroPedido);

      if (!colisaoNumeroPedido || tentativa === MAX_TENTATIVAS_NUMERO_PEDIDO) {
        throw error;
      }
    }
  }

  throw new Error("Não foi possível gerar um número de pedido único");
};

const montarItensPedido = async (itens, tabelaPrecoId) => {
  const itensPedido = [];
  let valorTotal = 0;

  const itensValidos = itens
    .map((item) => ({
      produtoId: item?.produtoId,
      quantidade: toPositiveNumber(item?.quantidade),
    }))
    .filter(
      (item) =>
        isValidObjectId(item.produtoId) &&
        item.quantidade &&
        item.quantidade <= 999999
    );

  if (itensValidos.length === 0) {
    return { itensPedido, valorTotal };
  }

  const produtoIds = [...new Set(itensValidos.map((item) => item.produtoId))];
  const [produtos, precos] = await Promise.all([
    Produto.find({
      _id: { $in: produtoIds },
      ativo: true,
    })
      .select("_id nome")
      .lean()
      .maxTimeMS(5000),
    PrecoProduto.find({
      produtoId: { $in: produtoIds },
      tabelaPrecoId,
    })
      .select("produtoId valor")
      .lean()
      .maxTimeMS(5000),
  ]);

  const produtosPorId = new Map(
    produtos.map((produto) => [String(produto._id), produto])
  );
  const precosPorProduto = new Map(
    precos.map((preco) => [String(preco.produtoId), preco.valor])
  );

  for (const item of itensValidos) {
    const produto = produtosPorId.get(String(item.produtoId));
    const valorUnitario = precosPorProduto.get(String(item.produtoId));

    if (!produto || valorUnitario === undefined) {
      continue;
    }

    const subtotal = valorUnitario * item.quantidade;

    valorTotal += subtotal;

    itensPedido.push({
      produtoId: produto._id,
      nomeProduto: produto.nome,
      quantidade: item.quantidade,
      valorUnitario,
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

    const pedido = await criarPedidoComNumeroUnico({
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
