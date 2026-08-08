import Pedido from "../models/Pedido.js";
import { gerarPdfSeparacaoPedido } from "../services/pdfSeparacaoService.js";
import {
  buildStatusHistoryEntry,
  PEDIDO_STATUS,
  STATUS_CONCLUIDOS,
  transicaoLogisticaPermitida,
  transicoesPermitidasLogistica,
  validateLogisticsOrderPayload,
} from "../utils/pedidoLogistica.js";
import { sendServerError } from "../utils/validation.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parsePositiveInteger = (value, fallback, maximum) => {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) return null;
  return parsed;
};

const parseDateBoundary = (value, endOfDay = false) => {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.length > 30) return null;
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}${suffix}` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const parseLogisticsOrderQuery = (query = {}) => {
  const pagina = parsePositiveInteger(query.pagina, 1, 1000000);
  const limite = parsePositiveInteger(query.limite, 20, 50);
  const busca = typeof query.busca === "string" ? query.busca.trim() : "";
  const dataInicio = parseDateBoundary(query.dataInicio);
  const dataFim = parseDateBoundary(query.dataFim, true);
  const errors = {};

  if (pagina === null) errors.pagina = "Página inválida";
  if (limite === null) errors.limite = "Limite inválido";
  if (busca.length > 100) errors.busca = "Busca muito longa";
  if (query.status && !PEDIDO_STATUS.includes(query.status)) errors.status = "Status inválido";
  if (dataInicio === null) errors.dataInicio = "Data inicial inválida";
  if (dataFim === null) errors.dataFim = "Data final inválida";
  if (dataInicio && dataFim && dataInicio > dataFim) {
    errors.dataFim = "A data final deve ser posterior à data inicial";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    data: {
      pagina,
      limite,
      busca,
      status: query.status || "",
      dataInicio,
      dataFim,
      aguardandoAcao: query.aguardandoAcao === "true" || query.aguardandoAcao === "1",
    },
  };
};

export const buildLogisticsOrderFilter = (query) => {
  const filter = {};

  if (query.busca) {
    const regex = new RegExp(escapeRegex(query.busca), "i");
    filter.$or = [
      { numeroPedido: regex },
      { nomeResponsavel: regex },
      { nomeFantasiaCliente: regex },
      { razaoSocialCliente: regex },
    ];
  }

  if (query.status) filter.status = query.status;
  else if (query.aguardandoAcao) filter.status = { $nin: STATUS_CONCLUIDOS };

  if (query.dataInicio || query.dataFim) {
    filter.createdAt = {};
    if (query.dataInicio) filter.createdAt.$gte = query.dataInicio;
    if (query.dataFim) filter.createdAt.$lte = query.dataFim;
  }

  return filter;
};

export const applyLogisticsOrderUpdate = ({
  pedido,
  data,
  observacaoHistorico,
  usuario,
  now = new Date(),
}) => {
  const statusAnterior = pedido.status;
  const novoStatus = data.status ?? statusAnterior;

  if (novoStatus === "entregue" && novoStatus !== statusAnterior) {
    return {
      valid: false,
      message: "O status Entregue deve ser confirmado pelo cliente",
    };
  }

  if (
    usuario.tipo === "logistica" &&
    !transicaoLogisticaPermitida(statusAnterior, novoStatus)
  ) {
    return {
      valid: false,
      message: `Transição de ${statusAnterior} para ${novoStatus} não permitida`,
    };
  }

  for (const [field, value] of Object.entries(data)) {
    if (field !== "status") pedido[field] = value;
  }

  if (novoStatus !== statusAnterior) {
    pedido.status = novoStatus;
    pedido.historicoStatus ||= [];
    pedido.historicoStatus.push(buildStatusHistoryEntry({
      statusAnterior,
      novoStatus,
      usuario,
      observacao: observacaoHistorico,
      now,
    }));
  }

  return { valid: true, statusAlterado: novoStatus !== statusAnterior };
};

export const obterDashboardLogistica = async (req, res) => {
  try {
    const aguardandoFilter = { status: { $nin: STATUS_CONCLUIDOS } };
    const [statusCounts, pedidosMaisAntigos] = await Promise.all([
      Pedido.aggregate([
        { $group: { _id: "$status", total: { $sum: 1 } } },
      ]).option({ maxTimeMS: 5000 }),
      Pedido.find(aguardandoFilter)
        .sort({ createdAt: 1 })
        .limit(5)
        .select("numeroPedido nomeFantasiaCliente razaoSocialCliente status createdAt updatedAt")
        .lean()
        .maxTimeMS(5000),
    ]);

    const porStatus = Object.fromEntries(
      statusCounts.map((item) => [item._id, item.total])
    );
    const totalAguardandoAcao = statusCounts
      .filter((item) => !STATUS_CONCLUIDOS.includes(item._id))
      .reduce((total, item) => total + item.total, 0);

    return res.status(200).json({
      metricas: {
        recebidos: (porStatus.novo || 0) + (porStatus.em_analise || 0),
        emSeparacao: porStatus.separando || 0,
        separados: porStatus.separado || 0,
        faturados: porStatus.faturado || 0,
        enviados: porStatus.enviado || 0,
        totalAguardandoAcao,
      },
      pedidosMaisAntigos,
    });
  } catch (error) {
    return sendServerError(res);
  }
};

export const listarPedidosLogistica = async (req, res) => {
  try {
    const parsed = parseLogisticsOrderQuery(req.query);
    if (!parsed.valid) {
      return res.status(400).json({ message: "Filtros inválidos", errors: parsed.errors });
    }

    const { pagina, limite } = parsed.data;
    const filter = buildLogisticsOrderFilter(parsed.data);
    const [pedidos, totalItens] = await Promise.all([
      Pedido.aggregate([
        { $match: filter },
        { $sort: { createdAt: -1, _id: -1 } },
        { $skip: (pagina - 1) * limite },
        { $limit: limite },
        {
          $project: {
            numeroPedido: 1,
            nomeResponsavel: 1,
            nomeFantasiaCliente: 1,
            razaoSocialCliente: 1,
            dataPedido: 1,
            status: 1,
            createdAt: 1,
            updatedAt: 1,
            transportadora: 1,
            numeroNotaFiscal: 1,
            quantidadeItens: { $size: { $ifNull: ["$itens", []] } },
          },
        },
      ]).option({ maxTimeMS: 5000 }),
      Pedido.countDocuments(filter).maxTimeMS(5000),
    ]);
    const totalPaginas = Math.max(Math.ceil(totalItens / limite), 1);

    return res.status(200).json({
      pedidos,
      paginacao: {
        paginaAtual: pagina,
        limite,
        totalItens,
        totalPaginas,
        temProximaPagina: pagina < totalPaginas,
      },
      filtros: {
        busca: parsed.data.busca,
        status: parsed.data.status,
        aguardandoAcao: parsed.data.aguardandoAcao,
        dataInicio: req.query.dataInicio || "",
        dataFim: req.query.dataFim || "",
      },
    });
  } catch (error) {
    return sendServerError(res);
  }
};

export const buscarPedidoLogistica = async (req, res) => {
  try {
    const pedido = await Pedido.findById(req.params.id)
      .select("+historicoStatus +observacaoLogistica")
      .lean()
      .maxTimeMS(5000);

    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado" });

    return res.status(200).json({
      pedido,
      transicoesPermitidas: req.usuario.tipo === "admin"
        ? PEDIDO_STATUS.filter((status) => status !== pedido.status)
        : transicoesPermitidasLogistica(pedido.status),
    });
  } catch (error) {
    return sendServerError(res);
  }
};

export const gerarPdfSeparacao = async (req, res) => {
  try {
    const pedido = await Pedido.findById(req.params.id)
      .select([
        "numeroPedido",
        "nomeFantasiaCliente",
        "razaoSocialCliente",
        "dataPedido",
        "dia",
        "mes",
        "ano",
        "createdAt",
        "itens.nomeProduto",
        "itens.quantidade",
        "observacao",
      ].join(" "))
      .lean()
      .maxTimeMS(5000);

    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado" });

    return gerarPdfSeparacaoPedido(pedido, res);
  } catch (error) {
    return sendServerError(res);
  }
};

export const atualizarPedidoLogistica = async (req, res) => {
  try {
    const parsed = validateLogisticsOrderPayload(req.body);
    if (!parsed.valid) {
      return res.status(400).json({
        message: "Dados logísticos inválidos",
        errors: parsed.errors,
      });
    }

    const pedido = await Pedido.findById(req.params.id)
      .select("+historicoStatus +observacaoLogistica");
    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado" });

    const result = applyLogisticsOrderUpdate({
      pedido,
      data: parsed.data,
      observacaoHistorico: parsed.observacaoHistorico,
      usuario: req.usuario,
    });
    if (!result.valid) return res.status(409).json({ message: result.message });

    await pedido.save();

    return res.status(200).json({
      message: "Dados logísticos atualizados",
      pedido,
      transicoesPermitidas: req.usuario.tipo === "admin"
        ? PEDIDO_STATUS.filter((status) => status !== pedido.status)
        : transicoesPermitidasLogistica(pedido.status),
    });
  } catch (error) {
    return sendServerError(res);
  }
};
