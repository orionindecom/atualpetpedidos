const asPlainObject = (value) => (
  typeof value?.toObject === "function" ? value.toObject() : { ...value }
);

const asValidDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const userData = (source = {}) => ({
  responsavelId: source.operadorId || source.usuarioId || undefined,
  responsavelNome: source.operadorNome || source.usuarioNome || undefined,
  responsavelPerfil: source.operadorId
    ? "operador_logistica"
    : source.usuarioTipo || undefined,
  ...(source.operadorId
    ? {
      operadorId: source.operadorId,
      operadorNome: source.operadorNome || undefined,
    }
    : {}),
});

const STATUS_EVENTS = Object.freeze({
  aprovado: ["pedido_aprovado", "Pedido aprovado"],
  separando: ["separacao_iniciada", "Separação iniciada"],
  separado: ["separacao_concluida", "Separação concluída"],
  faturado: ["pedido_faturado", "Pedido faturado"],
  enviado: ["pedido_enviado", "Pedido enviado"],
  entregue: ["pedido_entregue", "Entrega confirmada"],
  retirado: ["pedido_retirado", "Retirado pelo distribuidor"],
  cancelado: ["pedido_cancelado", "Pedido cancelado"],
});

const occurrenceDuplicatesConference = (entry, conference) => {
  const occurrenceDate = asValidDate(entry.criadaEm)?.getTime();
  if (!occurrenceDate) return false;

  const startDate = asValidDate(conference?.iniciadaEm)?.getTime();
  if (startDate === occurrenceDate && !entry.produtoId) return true;

  const endDate = asValidDate(conference?.concluidaEm)?.getTime();
  if (endDate !== occurrenceDate) return false;
  if (!entry.produtoId) return true;

  return (conference?.itens || []).some((item) => (
    item.diferenca !== 0 && String(item.produtoId) === String(entry.produtoId)
  ));
};

const occurrenceDuplicatesStatus = (entry, statusHistory) => {
  if (entry.produtoId || entry.tipo !== "informacao_operacional") return false;
  const occurrenceDate = asValidDate(entry.criadaEm)?.getTime();
  if (!occurrenceDate) return false;
  return statusHistory.some((statusEntry) => (
    statusEntry.novoStatus === "separado" &&
    asValidDate(statusEntry.alteradoEm)?.getTime() === occurrenceDate &&
    String(entry.conteudo || "").startsWith("Separação concluída.")
  ));
};

const occurrenceDuplicatesLogisticsClosing = (entry, closing) => (
  !entry.produtoId &&
  entry.tipo === "informacao_operacional" &&
  String(entry.conteudo || "").startsWith("Fechamento logístico") &&
  asValidDate(entry.criadaEm)?.getTime() === asValidDate(closing?.preenchidoEm)?.getTime()
);

const occurrenceDuplicatesAdminEdit = (entry, history) => (
  !entry.produtoId &&
  entry.tipo === "informacao_operacional" &&
  String(entry.conteudo || "").startsWith("Pedido alterado pelo Admin") &&
  history.some((change) => (
    asValidDate(change.alteradoEm)?.getTime() ===
    asValidDate(entry.criadaEm)?.getTime()
  ))
);

const separationSummary = (items = []) => {
  const separated = items.filter((item) => (
    item.quantidadeSeparada !== null && item.quantidadeSeparada !== undefined &&
    !(Number(item.quantidadeSeparada) === 0 && item.situacaoSeparacao === "pendente")
  ));
  if (separated.length === 0) return undefined;
  const shortages = separated.filter((item) => (
    Number(item.quantidadeSeparada) < Number(item.quantidade)
  )).length;
  return `${separated.length} item(ns) registrado(s); ${shortages} com falta na separação.`;
};

export const buildOrderAuditTimeline = (pedido, { showPrices = true } = {}) => {
  const source = asPlainObject(pedido || {});
  const events = [];
  let sequence = 0;
  const addEvent = (event) => {
    const date = asValidDate(event.data);
    if (!date) return;
    events.push({ ...event, data: date, sequence: sequence += 1 });
  };

  addEvent({
    tipo: "pedido_criado",
    data: source.createdAt || source.dataPedido,
    titulo: "Pedido criado",
    ...(source.origem === "comercial" ? userData(source.criadoPor) : {
      responsavelId: source.clienteId || undefined,
      responsavelNome: source.nomeResponsavel || source.nomeFantasiaCliente || "Cliente",
      responsavelPerfil: "cliente",
    }),
    detalhes: `${source.numeroPedido ? `Pedido ${source.numeroPedido}. ` : ""}Origem: ${source.origem === "comercial" ? "Comercial" : "Cliente"}.`,
  });

  const statusHistory = Array.isArray(source.historicoStatus)
    ? source.historicoStatus
    : [];
  for (const entry of statusHistory) {
    const [tipo, titulo] = STATUS_EVENTS[entry.novoStatus] || [
      "status_alterado",
      "Status alterado",
    ];
    addEvent({
      tipo: entry.acao === "envio_direto_admin" ? "envio_direto_admin" : tipo,
      data: entry.alteradoEm,
      titulo: entry.acao === "envio_direto_admin" ? "Avanço direto para Enviado pelo Admin" : titulo,
      ...userData(entry),
      detalhes: entry.novoStatus === "separado"
        ? entry.observacao || separationSummary(source.itens)
        : entry.observacao || undefined,
      statusAnterior: entry.statusAnterior,
      statusNovo: entry.novoStatus,
    });
  }

  const hasApprovalHistory = statusHistory.some((entry) => (
    entry.novoStatus === "aprovado"
  ));
  if (source.aprovacao?.aprovadoEm && !hasApprovalHistory) {
    addEvent({
      tipo: "pedido_aprovado",
      data: source.aprovacao.aprovadoEm,
      titulo: "Pedido aprovado",
      ...userData(source.aprovacao),
      detalhes: "Registro de aprovação administrativa.",
      statusNovo: "aprovado",
    });
  }

  const addDatedStatusFallback = ({ status, date, title, details }) => {
    if (!date || statusHistory.some((entry) => entry.novoStatus === status)) return;
    const [tipo] = STATUS_EVENTS[status] || ["status_alterado"];
    addEvent({
      tipo,
      data: date,
      titulo: title,
      detalhes: details,
      statusNovo: status,
    });
  };
  addDatedStatusFallback({
    status: "faturado",
    date: source.dataFaturamento,
    title: "Pedido faturado",
    details: source.numeroNotaFiscal
      ? `Nota fiscal ${source.numeroNotaFiscal}.`
      : "Data de faturamento registrada.",
  });
  addDatedStatusFallback({
    status: "enviado",
    date: source.dataEnvio,
    title: "Pedido enviado",
    details: source.transportadora
      ? `Transportadora: ${source.transportadora}.`
      : "Data de envio registrada.",
  });
  addDatedStatusFallback({
    status: "entregue",
    date: source.dataEntrega,
    title: "Entrega confirmada",
    details: "Data de entrega registrada.",
  });
  if (source.retiradoEm && !statusHistory.some((entry) => entry.novoStatus === "retirado")) {
    addEvent({
      tipo: "pedido_retirado",
      data: source.retiradoEm,
      titulo: "Retirado pelo distribuidor",
      statusNovo: "retirado",
      ...userData(source.retiradoPor),
    });
  }

  for (const entry of source.historicoAlteracoes || []) {
    if (!showPrices && !entry.itens?.length) continue;
    const itemDetails = (entry.itens || []).slice(0, 10).map((item) => {
      if (item.tipo === "adicionado") {
        return `${item.nomeProduto}: adicionado com ${item.quantidadeNova} unidade(s)`;
      }
      if (item.tipo === "removido") {
        return `${item.nomeProduto}: removido (antes ${item.quantidadeAnterior})`;
      }
      if (item.tipo === "quantidade_alterada") {
        return `${item.nomeProduto}: ${item.quantidadeAnterior} -> ${item.quantidadeNova}`;
      }
      return `${item.nomeProduto}: preço unitário alterado`;
    });
    const remaining = Math.max((entry.itens || []).length - itemDetails.length, 0);
    addEvent({
      tipo: "pedido_alterado_admin",
      data: entry.alteradoEm,
      titulo: "Pedido alterado pelo Admin",
      ...userData(entry),
      detalhes: `${showPrices ? `Total: R$ ${Number(entry.totalAnterior ?? 0).toFixed(2)} -> R$ ${Number(entry.totalNovo ?? 0).toFixed(2)}. ` : ""}${itemDetails.join("; ")}${remaining > 0 ? `; e mais ${remaining} alteração(ões)` : ""}.`,
      dados: {
        versaoOperacionalAnterior: entry.versaoOperacionalAnterior,
        versaoOperacionalNova: entry.versaoOperacionalNova,
        ...(showPrices ? { totalAnterior: entry.totalAnterior, totalNovo: entry.totalNovo } : {}),
        itens: entry.itens,
      },
    });
  }

  for (const archived of source.historicoConferencias || []) {
    const archivedConference = archived.conferencia || {};
    if (archivedConference.iniciadaEm) {
      addEvent({
        tipo: "conferencia_iniciada",
        data: archivedConference.iniciadaEm,
        titulo: "Conferência iniciada (versão anterior)",
        ...userData(archivedConference.iniciadoPor),
      });
    }
    if (archivedConference.concluidaEm) {
      const totalItems = archivedConference.totalItens ??
        archivedConference.itens?.length ?? 0;
      const totalDifferences = archivedConference.totalDivergencias ??
        (archivedConference.itens || []).filter((item) => item.diferenca !== 0).length;
      addEvent({
        tipo: "conferencia_concluida",
        data: archivedConference.concluidaEm,
        titulo: "Conferência concluída (versão anterior)",
        ...userData(archivedConference.concluidoPor),
        detalhes: `${totalItems} item(ns) conferido(s) antes da alteração do pedido.`,
        dados: {
          totalItens: totalItems,
          totalDivergencias: totalDifferences,
        },
      });
    }
    addEvent({
      tipo: "conferencia_invalidada",
      data: archived.invalidadaEm,
      titulo: "Conferência invalidada",
      ...userData(archived.invalidadaPor),
      detalhes: archived.motivo,
      dados: {
        versaoOperacional: archivedConference.versaoOperacional,
      },
    });
  }

  const conference = source.conferencia || {};
  if (conference.iniciadaEm) {
    addEvent({
      tipo: "conferencia_iniciada",
      data: conference.iniciadaEm,
      titulo: "Conferência iniciada",
      ...userData(conference.iniciadoPor),
    });
  }
  if (conference.concluidaEm) {
    const totalItems = conference.totalItens ?? conference.itens?.length ?? 0;
    const totalDifferences = conference.totalDivergencias ?? (
      conference.itens || []
    ).filter((item) => item.diferenca !== 0).length;
    addEvent({
      tipo: "conferencia_concluida",
      data: conference.concluidaEm,
      titulo: totalDifferences > 0
        ? "Conferência concluída com divergência"
        : "Conferência concluída",
      ...userData(conference.concluidoPor),
      detalhes: `${totalItems} item(ns) conferido(s); ${totalDifferences} divergência(s).${conference.observacao ? ` ${conference.observacao}` : ""}`,
      dados: {
        totalItens: totalItems,
        totalDivergencias: totalDifferences,
      },
    });

    for (const item of conference.itens || []) {
      if (item.diferenca === 0) continue;
      addEvent({
        tipo: "divergencia_conferencia",
        data: conference.concluidaEm,
        titulo: "Divergência na conferência",
        ...userData(conference.concluidoPor),
        detalhes: `${item.nomeProduto}: separado ${item.quantidadeSeparada}, conferido ${item.quantidadeConferida}, diferença ${item.diferenca}.`,
        produtoId: item.produtoId,
        nomeProduto: item.nomeProduto,
        dados: {
          quantidadeSolicitada: item.quantidadeSolicitada,
          quantidadeSeparada: item.quantidadeSeparada,
          quantidadeConferida: item.quantidadeConferida,
          diferenca: item.diferenca,
        },
      });
    }
  }

  const logisticsClosing = source.fechamentoLogistico || {};
  if (logisticsClosing.preenchidoEm) {
    addEvent({
      tipo: "fechamento_logistico",
      data: logisticsClosing.preenchidoEm,
      titulo: "Fechamento logístico registrado",
      ...userData(logisticsClosing.preenchidoPor),
      detalhes: `${logisticsClosing.quantidadeVolumes} volume(s); ${logisticsClosing.pesoTotalKg} kg. ${logisticsClosing.observacaoVolumes}`,
      dados: {
        quantidadeVolumes: logisticsClosing.quantidadeVolumes,
        pesoTotalKg: logisticsClosing.pesoTotalKg,
        observacaoVolumes: logisticsClosing.observacaoVolumes,
      },
    });
  }

  for (const entry of source.ocorrencias || []) {
    if (
      occurrenceDuplicatesConference(entry, conference) ||
      occurrenceDuplicatesStatus(entry, statusHistory) ||
      occurrenceDuplicatesLogisticsClosing(entry, logisticsClosing) ||
      occurrenceDuplicatesAdminEdit(entry, source.historicoAlteracoes || [])
    ) continue;
    addEvent({
      tipo: "ocorrencia",
      data: entry.criadaEm,
      titulo: entry.nomeProduto
        ? `Ocorrência — ${entry.nomeProduto}`
        : "Ocorrência operacional",
      ...userData(entry),
      detalhes: entry.conteudo,
      produtoId: entry.produtoId || undefined,
      nomeProduto: entry.nomeProduto || undefined,
      dados: { tipoOcorrencia: entry.tipo },
    });
  }

  return events
    .sort((left, right) => left.data - right.data || left.sequence - right.sequence)
    .map(({ sequence: _sequence, ...event }, index) => ({
      id: `${event.tipo}-${event.data.toISOString()}-${index + 1}`,
      ...event,
    }));
};
