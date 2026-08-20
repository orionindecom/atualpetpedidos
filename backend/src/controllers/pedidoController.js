import Pedido from "../models/Pedido.js";
import Usuario from "../models/Usuario.js";
import PrecoProduto from "../models/PrecoProduto.js";
import Produto from "../models/Produto.js";
import TabelaPreco from "../models/TabelaPreco.js";
import { gerarNumeroPedido } from "../utils/gerarNumeroPedido.js";
import { gerarPdfPedido } from "../services/pdfService.js";
import { gerarPdfRelatorioPedido } from "../services/pdfAuditoriaPedidoService.js";
import {
  buildClientReceiptConfirmationUpdate,
  buildStatusHistoryEntry,
  enrichInternalOrderDetail,
  enrichOrderSeparation,
  PEDIDO_STATUS,
  pedidoPossuiEntregaConfirmada,
  sanitizeClientOrder,
  validarTransicaoPedido,
} from "../utils/pedidoLogistica.js";
import {
  applyAdminOrderEdit,
  pedidoPodeSerEditadoPeloAdmin,
} from "../utils/pedidoEdicaoAdmin.js";
import {
  isOptionalString,
  isValidObjectId,
  sendServerError,
  toPositiveNumber,
} from "../utils/validation.js";

const statusPermitidos = new Set(PEDIDO_STATUS);

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
      status: "aguardando_aprovacao",
      conferenciaObrigatoria: true,
      fechamentoLogisticoObrigatorio: true,
      observacao: observacao?.trim(),
    });

    return res.status(201).json({
      message: "Pedido criado com sucesso",
      pedido: sanitizeClientOrder(pedido),
    });
  } catch (error) {
    return sendServerError(res);
  }
};

export const listarMeusPedidos = async (req, res) => {
  try {
    const pedidos = await Pedido.find({
      clienteId: req.usuario._id,
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json(pedidos.map(sanitizeClientOrder));
  } catch (error) {
    return sendServerError(res);
  }
};

export const confirmarRecebimento = async (req, res) => {
  try {
    const update = buildClientReceiptConfirmationUpdate({
      usuario: req.usuario,
    });
    update.$inc = { __v: 1 };
    const pedido = await Pedido.findOneAndUpdate(
      {
        _id: req.params.id,
        clienteId: req.usuario._id,
        status: "enviado",
      },
      update,
      {
        new: true,
        runValidators: true,
      }
    );

    if (pedido) {
      return res.status(200).json({
        message: "Recebimento confirmado com sucesso",
        pedido: sanitizeClientOrder(pedido),
      });
    }

    const pedidoExistente = await Pedido.findById(req.params.id)
      .select("clienteId status")
      .lean();

    if (!pedidoExistente) {
      return res.status(404).json({ message: "Pedido não encontrado" });
    }

    if (String(pedidoExistente.clienteId) !== String(req.usuario._id)) {
      return res.status(403).json({
        message: "Você não tem permissão para confirmar este pedido",
      });
    }

    if (pedidoExistente.status === "entregue") {
      return res.status(409).json({ message: "Recebimento já confirmado" });
    }

    return res.status(409).json({
      message: "O recebimento só pode ser confirmado após o envio do pedido",
    });
  } catch (error) {
    return sendServerError(res);
  }
};

export const listarTodosPedidos = async (req, res) => {
  try {
    const pedidos = await Pedido.find().sort({ createdAt: -1 }).lean();

    return res.status(200).json(pedidos.map(enrichOrderSeparation));
  } catch (error) {
    return sendServerError(res);
  }
};

export const buscarPedidoPorId = async (req, res) => {
  try {
    const query = Pedido.findById(req.params.id);
    if (req.usuario.tipo === "admin") {
      query.select("+historicoStatus +observacaoLogistica +ocorrencias +historicoAlteracoes +historicoConferencias");
    }
    const pedido = await query;

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

    return res.status(200).json(
      req.usuario.tipo === "admin"
        ? enrichInternalOrderDetail(pedido)
        : sanitizeClientOrder(pedido)
    );
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

export const gerarRelatorioPedidoAdmin = async (req, res) => {
  try {
    const pedido = await Pedido.findById(req.params.id)
      .select("+historicoStatus +observacaoLogistica +ocorrencias +historicoAlteracoes +historicoConferencias")
      .lean()
      .maxTimeMS(5000);

    if (!pedido) {
      return res.status(404).json({ message: "Pedido não encontrado" });
    }

    return gerarPdfRelatorioPedido(pedido, res);
  } catch {
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

    if (status === "entregue") {
      return res.status(409).json({
        message: "O status Entregue deve ser confirmado pelo cliente",
      });
    }

    if (["aguardando_aprovacao", "aprovado"].includes(status)) {
      return res.status(409).json({
        message: "Use a ação específica de aprovação para liberar o pedido",
      });
    }

    const pedido = await Pedido.findById(req.params.id).select("+historicoStatus");

    if (!pedido) {
      return res.status(404).json({
        message: "Pedido não encontrado",
      });
    }

    const validacaoTransicao = validarTransicaoPedido({
      pedido,
      novoStatus: status,
      usuarioTipo: "admin",
    });
    if (!validacaoTransicao.valid) {
      return res.status(409).json({
        message: validacaoTransicao.message,
      });
    }

    if (pedido.status !== status) {
      const statusAnterior = pedido.status;
      pedido.status = status;
      pedido.historicoStatus ||= [];
      pedido.historicoStatus.push(buildStatusHistoryEntry({
        statusAnterior,
        novoStatus: status,
        usuario: req.usuario,
      }));
    }

    await pedido.save();

    return res.status(200).json({
      message: "Status atualizado",
      pedido,
    });
  } catch (error) {
    return sendServerError(res);
  }
};

export const aprovarPedidoAdmin = async (req, res) => {
  try {
    const now = new Date();
    const aprovacao = {
      aprovadoEm: now,
      usuarioId: req.usuario._id,
      usuarioNome:
        req.usuario.nomeResponsavel || req.usuario.nomeFantasia || "Administrador",
      usuarioTipo: "admin",
    };
    const pedido = await Pedido.findOneAndUpdate(
      {
        _id: req.params.id,
        status: "aguardando_aprovacao",
      },
      {
        $set: {
          status: "aprovado",
          aprovacao,
        },
        $push: {
          historicoStatus: buildStatusHistoryEntry({
            statusAnterior: "aguardando_aprovacao",
            novoStatus: "aprovado",
            usuario: req.usuario,
            observacao: "Pedido aprovado e liberado para a Logística",
            now,
          }),
        },
        $inc: { __v: 1 },
      },
      {
        new: true,
        runValidators: true,
      }
    ).select("+historicoStatus +observacaoLogistica +ocorrencias");

    if (pedido) {
      return res.status(200).json({
        message: "Pedido aprovado e liberado para a Logística",
        pedido: enrichInternalOrderDetail(pedido),
      });
    }

    const pedidoExistente = await Pedido.findById(req.params.id)
      .select("status aprovacao")
      .lean();
    if (!pedidoExistente) {
      return res.status(404).json({ message: "Pedido não encontrado" });
    }

    return res.status(409).json({
      message: pedidoExistente.status === "aprovado"
        ? "Este pedido já foi aprovado"
        : "Somente pedidos aguardando aprovação podem ser aprovados",
    });
  } catch (error) {
    return sendServerError(res);
  }
};

export const atualizarPedidoAdmin = async (req, res) => {
  try {
    const { itens, observacao, versaoPedido } = req.body;

    if (
      !validarItens(itens) ||
      !isOptionalString(observacao, 1000) ||
      !Number.isInteger(Number(versaoPedido)) ||
      Number(versaoPedido) < 0
    ) {
      return res.status(400).json({
        message: "Dados do pedido inválidos",
      });
    }

    const pedido = await Pedido.findById(req.params.id)
      .select("+historicoStatus +ocorrencias +historicoAlteracoes +historicoConferencias");

    if (!pedido) {
      return res.status(404).json({
        message: "Pedido não encontrado",
      });
    }

    if (Number(pedido.__v || 0) !== Number(versaoPedido)) {
      return res.status(409).json({
        message: "Este pedido foi atualizado por outra pessoa. Reabra a edição para usar os dados atuais",
        versaoAtual: Number(pedido.__v || 0),
      });
    }

    if (!pedidoPodeSerEditadoPeloAdmin(pedido)) {
      return res.status(409).json({
        message: pedido.status === "faturado"
          ? "Pedidos faturados não podem mais ter itens ou quantidades alterados"
          : "Os itens deste pedido não podem mais ser alterados nesta etapa",
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

    const result = applyAdminOrderEdit({
      pedido,
      itensPedido,
      valorTotal,
      observacao: observacao?.trim() ?? pedido.observacao,
      usuario: req.usuario,
    });

    await pedido.save();

    return res.status(200).json({
      message: result.separationReopened
        ? "Pedido atualizado. A separação foi reaberta para adequação às quantidades atuais"
        : result.physicalOrderChanged
          ? "Pedido atualizado. A conferência deverá validar a versão atual"
          : "Pedido atualizado com sucesso",
      pedido: enrichInternalOrderDetail(pedido),
    });
  } catch (error) {
    if (error?.name === "VersionError") {
      return res.status(409).json({
        message: "Este pedido foi atualizado por outra pessoa. Reabra a edição antes de salvar novamente",
      });
    }
    return sendServerError(res);
  }
};

export const excluirPedidoAdmin = async (req, res) => {
  try {
    const pedido = await Pedido.findById(req.params.id).select("+historicoStatus");

    if (!pedido) {
      return res.status(404).json({
        message: "Pedido não encontrado",
      });
    }

    if (pedidoPossuiEntregaConfirmada(pedido)) {
      return res.status(409).json({
        message: "Pedidos entregues são mantidos para consulta e não podem ser excluídos",
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
