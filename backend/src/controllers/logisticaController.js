import Pedido from "../models/Pedido.js";
import { gerarPdfSeparacaoPedido } from "../services/pdfSeparacaoService.js";
import {
  buildOccurrenceEntry,
  buildStatusHistoryEntry,
  conferenciaConcluida,
  enrichInternalOrderDetail,
  enrichOrderSeparation,
  getItemSeparation,
  PEDIDO_STATUS,
  pedidoAguardandoAprovacao,
  pedidoExigeConferencia,
  pedidoExigeFechamentoLogistico,
  pedidoPossuiEntregaConfirmada,
  STATUS_CONCLUIDOS,
  transicoesPermitidasParaPedido,
  validarCamposPedidoPorEtapa,
  validarTransicaoPedido,
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

export const buildLogisticsOrderFilter = (
  query,
  { includePendingApproval = false } = {}
) => {
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

  if (query.status) {
    filter.status = !includePendingApproval && query.status === "aguardando_aprovacao"
      ? { $in: [] }
      : query.status;
  } else if (query.aguardandoAcao) {
    filter.status = {
      $nin: includePendingApproval
        ? STATUS_CONCLUIDOS
        : [...STATUS_CONCLUIDOS, "aguardando_aprovacao"],
    };
  } else if (!includePendingApproval) {
    filter.status = { $ne: "aguardando_aprovacao" };
  }

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
  separacaoItens,
  conferencia,
  fechamentoLogistico,
  novaOcorrencia,
  usuario,
  operador,
  now = new Date(),
}) => {
  const statusAnterior = pedido.status;
  const novoStatus = data.status ?? statusAnterior;
  const conferenciaStatus = pedido.conferencia?.status;

  if (pedidoPossuiEntregaConfirmada(pedido) && statusAnterior !== "entregue") {
    return {
      valid: false,
      message: "Este pedido já possui entrega confirmada e permanece em estado terminal",
    };
  }

  if (statusAnterior === "entregue" && novoStatus !== "entregue") {
    return {
      valid: false,
      message: "Pedido entregue é um estado terminal e não pode regredir",
    };
  }

  if (statusAnterior === "entregue") {
    return {
      valid: false,
      message: "As operações deste pedido foram encerradas após a entrega",
    };
  }

  if (
    (conferencia || fechamentoLogistico) &&
    (
      Object.keys(data).length > 0 ||
      separacaoItens ||
      novaOcorrencia ||
      (conferencia && fechamentoLogistico)
    )
  ) {
    return {
      valid: false,
      message: conferencia
        ? "A conferência deve ser registrada em uma operação própria"
        : "O fechamento logístico deve ser registrado em uma operação própria",
    };
  }

  if (pedidoAguardandoAprovacao(statusAnterior)) {
    return {
      valid: false,
      message: "O pedido precisa ser aprovado pelo Admin antes da operação logística",
    };
  }

  const validacaoCampos = validarCamposPedidoPorEtapa({
    pedido,
    data,
    separacaoItens,
    usuarioTipo: usuario.tipo,
  });
  if (!validacaoCampos.valid) return validacaoCampos;

  const validacaoTransicao = validarTransicaoPedido({
    pedido,
    novoStatus,
    usuarioTipo: usuario.tipo,
    data,
  });
  if (!validacaoTransicao.valid) return validacaoTransicao;

  if (
    separacaoItens &&
    ["em_andamento", "concluida", "concluida_com_divergencia"].includes(conferenciaStatus)
  ) {
    return {
      valid: false,
      message: "A separação original não pode ser alterada após o início da conferência",
    };
  }

  const itensPedido = Array.isArray(pedido.itens) ? pedido.itens : [];
  const itensPorProduto = new Map(
    itensPedido.map((item) => [String(item.produtoId), item])
  );
  const alteracoesSeparacao = [];

  for (const separacao of separacaoItens || []) {
    const item = itensPorProduto.get(String(separacao.produtoId));
    if (!item) {
      return {
        valid: false,
        message: "A separação contém um produto que não pertence ao pedido",
      };
    }
    if (separacao.quantidadeSeparada > Number(item.quantidade)) {
      return {
        valid: false,
        message: `A quantidade separada de ${item.nomeProduto} não pode exceder a solicitada`,
      };
    }
    if (getItemSeparation(item).quantidadeSeparada !== separacao.quantidadeSeparada) {
      alteracoesSeparacao.push({
        item,
        quantidadeSeparada: separacao.quantidadeSeparada,
      });
    }
  }

  if (
    alteracoesSeparacao.length > 0 &&
    pedidoExigeConferencia(pedido) &&
    statusAnterior === "separado"
  ) {
    return {
      valid: false,
      message: "A separação original não pode ser alterada depois de concluída",
    };
  }

  if (novoStatus === "separado" && novoStatus !== statusAnterior) {
    const separacaoPorProduto = new Map(
      (separacaoItens || []).map((item) => [
        String(item.produtoId),
        item.quantidadeSeparada,
      ])
    );
    const possuiItemPendente = itensPedido.some((item) => {
      const quantidade = separacaoPorProduto.has(String(item.produtoId))
        ? separacaoPorProduto.get(String(item.produtoId))
        : getItemSeparation(item).quantidadeSeparada;
      return quantidade === null;
    });
    if (possuiItemPendente) {
      return {
        valid: false,
        message: "Informe a quantidade separada de todos os itens antes de concluir a separação",
      };
    }
  }

  const novasOcorrencias = [];

  if (conferencia) {
    if (!pedidoExigeConferencia(pedido)) {
      return {
        valid: false,
        message: "Este pedido histórico não exige conferência",
      };
    }
    if (statusAnterior !== "separado") {
      return {
        valid: false,
        message: "A conferência só pode começar depois da conclusão da separação",
      };
    }

    const usuarioConferencia = {
      usuarioId: usuario._id,
      usuarioNome:
        usuario.nomeResponsavel || usuario.nomeFantasia || "Usuário interno",
      usuarioTipo: usuario.tipo,
      ...(operador
        ? { operadorId: operador._id, operadorNome: operador.nome }
        : {}),
    };

    if (conferencia.acao === "iniciar") {
      if ((conferenciaStatus || "pendente") !== "pendente") {
        return {
          valid: false,
          message: conferenciaConcluida(pedido)
            ? "A conferência deste pedido já foi concluída"
            : "A conferência deste pedido já está em andamento",
        };
      }
      pedido.conferencia = {
        status: "em_andamento",
        iniciadaEm: now,
        iniciadoPor: usuarioConferencia,
      };
      novasOcorrencias.push(buildOccurrenceEntry({
        conteudo: "Conferência dos itens iniciada.",
        tipo: "informacao_operacional",
        visibilidade: "interna",
        usuario,
        operador,
        now,
      }));
    }

    if (conferencia.acao === "concluir") {
      if (conferenciaStatus !== "em_andamento") {
        return {
          valid: false,
          message: conferenciaConcluida(pedido)
            ? "A conferência deste pedido já foi concluída"
            : "Inicie a conferência antes de concluí-la",
        };
      }

      const conferenciaPorProduto = new Map(
        conferencia.itens.map((item) => [String(item.produtoId), item])
      );
      if (
        conferencia.itens.length !== itensPedido.length ||
        itensPedido.some((item) => !conferenciaPorProduto.has(String(item.produtoId)))
      ) {
        return {
          valid: false,
          message: "Todos os itens do pedido devem ser conferidos",
        };
      }

      const itensConferencia = [];
      for (const item of itensPedido) {
        const separacao = getItemSeparation(item);
        const itemConferencia = conferenciaPorProduto.get(String(item.produtoId));
        if (separacao.quantidadeSeparada === null) {
          return {
            valid: false,
            message: "Todos os itens precisam estar separados antes da conferência",
          };
        }
        if (itemConferencia.quantidadeConferida > separacao.quantidadeSeparada) {
          return {
            valid: false,
            message: `A quantidade conferida de ${item.nomeProduto} não pode exceder a separada`,
          };
        }

        const quantidadeConferida = itemConferencia.quantidadeConferida;
        const quantidadeFaltante = Math.max(
          separacao.quantidadeSolicitada - quantidadeConferida,
          0
        );
        const situacaoFinal = quantidadeConferida === 0 && separacao.quantidadeSolicitada > 0
          ? "indisponivel"
          : quantidadeFaltante > 0
            ? "parcial"
            : "completo";

        item.quantidadeConferida = quantidadeConferida;
        item.quantidadeFinal = quantidadeConferida;
        item.situacaoFinal = situacaoFinal;
        itensConferencia.push({
          produtoId: item.produtoId,
          nomeProduto: item.nomeProduto,
          quantidadeSolicitada: separacao.quantidadeSolicitada,
          quantidadeSeparada: separacao.quantidadeSeparada,
          quantidadeFaltanteSeparacao: separacao.quantidadeFaltanteSeparacao,
          quantidadeConferida,
          diferenca: quantidadeConferida - separacao.quantidadeSeparada,
          situacaoFinal,
        });
      }

      const divergencias = itensConferencia.filter((item) => item.diferenca !== 0);
      pedido.conferencia.status = divergencias.length > 0
        ? "concluida_com_divergencia"
        : "concluida";
      pedido.conferencia.concluidaEm = now;
      pedido.conferencia.concluidoPor = usuarioConferencia;
      pedido.conferencia.observacao = conferencia.observacao || undefined;
      pedido.conferencia.itens = itensConferencia;
      pedido.conferencia.totalItens = itensConferencia.length;
      pedido.conferencia.totalDivergencias = divergencias.length;

      novasOcorrencias.push(buildOccurrenceEntry({
        conteudo: divergencias.length > 0
          ? `Conferência concluída com ${divergencias.length} divergência(s) em ${itensConferencia.length} item(ns).`
          : `Conferência concluída em ${itensConferencia.length} item(ns), sem divergências.`,
        tipo: "informacao_operacional",
        visibilidade: "interna",
        usuario,
        operador,
        now,
      }));
      for (const divergencia of divergencias) {
        novasOcorrencias.push(buildOccurrenceEntry({
          conteudo: `${divergencia.nomeProduto}: separado ${divergencia.quantidadeSeparada}, conferido ${divergencia.quantidadeConferida}, diferença ${divergencia.diferenca}.`,
          tipo: "falta_produto",
          visibilidade: "interna",
          usuario,
          operador,
          produtoId: divergencia.produtoId,
          nomeProduto: divergencia.nomeProduto,
          now,
        }));
      }
    }
  }

  if (fechamentoLogistico) {
    if (!pedidoExigeFechamentoLogistico(pedido)) {
      return {
        valid: false,
        message: "Este pedido histórico não exige fechamento logístico",
      };
    }
    if (statusAnterior !== "separado") {
      return {
        valid: false,
        message: "O fechamento logístico só pode ser preenchido após a separação e antes do faturamento",
      };
    }
    if (pedidoExigeConferencia(pedido) && !conferenciaConcluida(pedido)) {
      return {
        valid: false,
        message: "Conclua a conferência antes de preencher o fechamento logístico",
      };
    }
    if (usuario.tipo !== "logistica" || !operador) {
      return {
        valid: false,
        message: "O fechamento logístico exige identificação de um operador da Logística por PIN",
      };
    }

    const fechamentoJaExistia = Boolean(pedido.fechamentoLogistico?.preenchidoEm);
    pedido.fechamentoLogistico = {
      ...fechamentoLogistico,
      preenchidoEm: now,
      preenchidoPor: {
        usuarioId: usuario._id,
        usuarioNome:
          usuario.nomeResponsavel || usuario.nomeFantasia || "Usuário interno",
        usuarioTipo: usuario.tipo,
        operadorId: operador._id,
        operadorNome: operador.nome,
      },
    };
    novasOcorrencias.push(buildOccurrenceEntry({
      conteudo: `${fechamentoJaExistia ? "Fechamento logístico atualizado" : "Fechamento logístico concluído"}: ${fechamentoLogistico.quantidadeVolumes} volume(s), ${fechamentoLogistico.pesoTotalKg} kg.`,
      tipo: "informacao_operacional",
      usuario,
      operador,
      now,
    }));
  }

  for (const [field, value] of Object.entries(data)) {
    if (field !== "status") pedido[field] = value;
  }

  for (const alteracao of alteracoesSeparacao) {
    alteracao.item.quantidadeSeparada = alteracao.quantidadeSeparada;
    alteracao.item.situacaoSeparacao = getItemSeparation({
      quantidade: alteracao.item.quantidade,
      quantidadeSeparada: alteracao.quantidadeSeparada,
    }).situacaoSeparacao;
  }

  if (novoStatus !== statusAnterior) {
    pedido.status = novoStatus;
    pedido.historicoStatus ||= [];
    pedido.historicoStatus.push(buildStatusHistoryEntry({
      statusAnterior,
      novoStatus,
      usuario,
      operador,
      observacao: observacaoHistorico,
      now,
    }));

    if (
      novoStatus === "separado" &&
      pedidoExigeConferencia(pedido) &&
      !pedido.conferencia
    ) {
      pedido.conferencia = { status: "pendente" };
      novasOcorrencias.push(buildOccurrenceEntry({
        conteudo: "Separação concluída. Pedido aguardando conferência dos itens.",
        tipo: "informacao_operacional",
        visibilidade: "interna",
        usuario,
        operador,
        now,
      }));
    }
  }

  novasOcorrencias.push(...alteracoesSeparacao.map(({ item, quantidadeSeparada }) => {
    const separacao = getItemSeparation({
      quantidade: item.quantidade,
      quantidadeSeparada,
    });
    return buildOccurrenceEntry({
      conteudo: `${item.nomeProduto}: solicitado ${separacao.quantidadeSolicitada}, separado ${quantidadeSeparada}, faltante ${separacao.quantidadeFaltante}.`,
      tipo: separacao.quantidadeFaltante > 0
        ? "falta_produto"
        : "informacao_operacional",
      visibilidade: "interna",
      usuario,
      operador,
      produtoId: item.produtoId,
      nomeProduto: item.nomeProduto,
      now,
    });
  }));

  if (novaOcorrencia) {
    novasOcorrencias.push(buildOccurrenceEntry({
      ...novaOcorrencia,
      usuario,
      operador,
      now,
    }));
  }

  if (novasOcorrencias.length > 0) {
    pedido.ocorrencias ||= [];
    pedido.ocorrencias.push(...novasOcorrencias);
  }

  return {
    valid: true,
    statusAlterado: novoStatus !== statusAnterior,
    separacaoAlterada: alteracoesSeparacao.length > 0,
    conferenciaAlterada: Boolean(conferencia),
    fechamentoLogisticoAlterado: Boolean(fechamentoLogistico),
  };
};

export const obterDashboardLogistica = async (req, res) => {
  try {
    const aguardandoFilter = {
      status: { $nin: [...STATUS_CONCLUIDOS, "aguardando_aprovacao"] },
    };
    const [statusCounts, pedidosMaisAntigos] = await Promise.all([
      Pedido.aggregate([
        { $match: { status: { $ne: "aguardando_aprovacao" } } },
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
        recebidos:
          (porStatus.aprovado || 0) +
          (porStatus.novo || 0) +
          (porStatus.em_analise || 0),
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
    const filter = buildLogisticsOrderFilter(parsed.data, {
      includePendingApproval: req.usuario.tipo === "admin",
    });
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
            conferenciaObrigatoria: 1,
            "conferencia.status": 1,
            fechamentoLogisticoObrigatorio: 1,
            "fechamentoLogistico.preenchidoEm": 1,
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
      .select("+historicoStatus +observacaoLogistica +ocorrencias")
      .lean()
      .maxTimeMS(5000);

    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado" });

    if (req.usuario.tipo === "logistica" && pedidoAguardandoAprovacao(pedido)) {
      return res.status(403).json({
        message: "Este pedido ainda aguarda aprovação administrativa",
      });
    }

    return res.status(200).json({
      pedido: enrichInternalOrderDetail(pedido),
      transicoesPermitidas: transicoesPermitidasParaPedido(pedido, {
        admin: req.usuario.tipo === "admin",
      }),
    });
  } catch (error) {
    return sendServerError(res);
  }
};

export const gerarPdfSeparacao = async (req, res) => {
  try {
    const pedido = await Pedido.findById(req.params.id)
      .select([
        "status",
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

    if (req.usuario.tipo === "logistica" && pedidoAguardandoAprovacao(pedido)) {
      return res.status(403).json({
        message: "Este pedido ainda aguarda aprovação administrativa",
      });
    }

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
      .select("+historicoStatus +observacaoLogistica +ocorrencias");
    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado" });

    if (pedidoAguardandoAprovacao(pedido)) {
      return res.status(409).json({
        message: "O pedido precisa ser aprovado pelo Admin antes da operação logística",
      });
    }

    const result = applyLogisticsOrderUpdate({
      pedido,
      data: parsed.data,
      observacaoHistorico: parsed.observacaoHistorico,
      separacaoItens: parsed.separacaoItens,
      conferencia: parsed.conferencia,
      fechamentoLogistico: parsed.fechamentoLogistico,
      novaOcorrencia: parsed.novaOcorrencia,
      usuario: req.usuario,
      operador: req.operadorLogistica,
    });
    if (!result.valid) return res.status(409).json({ message: result.message });

    await pedido.save();

    return res.status(200).json({
      message: "Dados logísticos atualizados",
      pedido: enrichInternalOrderDetail(pedido),
      transicoesPermitidas: transicoesPermitidasParaPedido(pedido, {
        admin: req.usuario.tipo === "admin",
      }),
    });
  } catch (error) {
    return sendServerError(res);
  }
};
