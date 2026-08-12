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

const separationSummary = (items = []) => {
  const separated = items.filter((item) => (
    item.quantidadeSeparada !== null && item.quantidadeSeparada !== undefined
  ));
  if (separated.length === 0) return undefined;
  const shortages = separated.filter((item) => (
    Number(item.quantidadeSeparada) < Number(item.quantidade)
  )).length;
  return `${separated.length} item(ns) registrado(s); ${shortages} com falta na separação.`;
};

export const buildOrderAuditTimeline = (pedido) => {
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
    responsavelId: source.clienteId || undefined,
    responsavelNome: source.nomeResponsavel || source.nomeFantasiaCliente || "Cliente",
    responsavelPerfil: "cliente",
    detalhes: source.numeroPedido ? `Pedido ${source.numeroPedido}.` : undefined,
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
      tipo,
      data: entry.alteradoEm,
      titulo,
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

  for (const entry of source.ocorrencias || []) {
    if (
      occurrenceDuplicatesConference(entry, conference) ||
      occurrenceDuplicatesStatus(entry, statusHistory)
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
