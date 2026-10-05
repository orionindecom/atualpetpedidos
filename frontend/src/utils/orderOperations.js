const toDateInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

export const isConferenceFinishedForCurrentOrder = (pedido = {}) => {
  if (pedido.conferencia?.status !== "concluida") return false;
  if (
    pedido.conferencia?.versaoOperacional !== undefined &&
    Number(pedido.conferencia.versaoOperacional) !==
      Number(pedido.versaoOperacional || 1)
  ) return false;
  const items = pedido.itens || [];
  const conferenceItems = pedido.conferencia?.itens;

  if (!Array.isArray(conferenceItems) || conferenceItems.length === 0) {
    return items.every((item) => (
      item.quantidadeSeparada !== undefined &&
      item.quantidadeSeparada !== null &&
      Number(item.quantidadeSeparada) === Number(item.quantidade)
    ));
  }

  const conferenceByProduct = new Map(
    conferenceItems.map((item) => [String(item.produtoId), item])
  );
  return conferenceItems.length === items.length && items.every((item) => {
    const conferenceItem = conferenceByProduct.get(String(item.produtoId));
    const requested = Number(item.quantidadeSolicitada ?? item.quantidade ?? 0);
    return conferenceItem &&
      Number(item.quantidadeSeparada) === requested &&
      Number(conferenceItem.quantidadeSolicitada) === requested &&
      Number(conferenceItem.quantidadeSeparada) === requested &&
      Number(conferenceItem.quantidadeConferida) === requested;
  });
};

export const isLogisticsClosingComplete = (pedido = {}) => {
  const closing = pedido.fechamentoLogistico;
  return Boolean(
    Number.isInteger(Number(closing?.quantidadeVolumes)) &&
    Number(closing?.quantidadeVolumes) > 0 &&
    Number(closing?.pesoTotalKg) > 0 &&
    String(closing?.observacaoVolumes || "").trim() &&
    closing?.preenchidoEm &&
    closing?.preenchidoPor
  );
};

export const getOrderFlowStage = (pedido = {}) => {
  const conferenceFinished = isConferenceFinishedForCurrentOrder(pedido);
  const logisticsClosingFinished = isLogisticsClosingComplete(pedido);
  const terminal = pedido.status === "entregue" || pedido.status === "retirado" ||
    pedido.status === "cancelado" ||
    pedido.entregaFinalizada === true;

  if (terminal) return {
    key: pedido.status === "cancelado" ? "canceled" : "delivered",
    title: pedido.status === "cancelado" ? "Pedido cancelado" : pedido.status === "retirado" ? "Retirado pelo distribuidor" : "Pedido entregue — estado final",
    description: "As ações operacionais estão encerradas; histórico e documentos permanecem disponíveis.",
    showConference: Boolean(pedido.conferencia),
    showShippingSummary: !["cancelado", "retirado"].includes(pedido.status),
    terminal: true,
  };

  if (pedido.status === "aguardando_aprovacao") return {
    key: "approval",
    title: "Aguardando aprovação administrativa",
    description: "A operação logística permanece bloqueada até a aprovação do pedido.",
    terminal: false,
  };
  if (["aprovado", "novo", "em_analise"].includes(pedido.status)) return {
    key: "ready_separation",
    title: "Pedido liberado para separação",
    description: "A próxima ação é iniciar a separação dos itens.",
    nextStatus: "separando",
    nextAction: "Iniciar separação",
    terminal: false,
  };
  if (pedido.status === "separando") return {
    key: "separation",
    title: "Separação em andamento",
    description: "Registre as quantidades separadas e conclua todos os itens.",
    nextStatus: "separado",
    nextAction: "Concluir separação",
    showSeparationEditor: true,
    showOccurrence: true,
    terminal: false,
  };
  if (pedido.status === "separado" && pedido.conferenciaObrigatoria === true && !conferenceFinished) {
    return {
      key: pedido.conferencia?.status === "em_andamento"
        ? "conference"
        : "ready_conference",
      title: pedido.conferencia?.status === "em_andamento"
        ? "Conferência em andamento"
        : "Conferência obrigatória pendente",
      description: pedido.conferencia?.status === "em_andamento"
        ? "Confira cada item antes de concluir esta etapa."
        : "A separação terminou; inicie a conferência dos itens.",
      conferenceFocused: true,
      showConference: true,
      showSeparationEditor: true,
      showOccurrence: true,
      terminal: false,
    };
  }
  if (
    pedido.status === "separado" &&
    pedido.fechamentoLogisticoObrigatorio === true &&
    !logisticsClosingFinished
  ) return {
    key: "logistics_closing",
    title: "Preencher dados para faturamento",
    description: "Informe volumes, peso total e a descrição das caixas para concluir a responsabilidade da Logística.",
    showConference: true,
    showLogisticsClosing: true,
    terminal: false,
  };
  if (pedido.status === "separado") return {
    key: "ready_billing",
    title: logisticsClosingFinished
      ? "Operação logística concluída — pedido disponível para faturamento"
      : conferenceFinished
        ? "Conferência concluída — pedido histórico disponível para faturamento"
        : "Pedido histórico disponível para faturamento",
    description: logisticsClosingFinished
      ? "Conferência e fechamento foram concluídos. O Admin pode informar a Nota Fiscal e faturar o pedido."
      : "Este pedido é anterior ao fechamento logístico obrigatório e mantém o fluxo legado.",
    nextStatus: "faturado",
    nextAction: "Faturar pedido",
    showConference: true,
    showLogisticsClosingSummary: logisticsClosingFinished,
    showInvoicing: true,
    showOccurrence: true,
    terminal: false,
  };
  if (pedido.status === "faturado") return {
    key: "shipping",
    title: "Pedido faturado — preparar expedição",
    description: "Informe os dados de transporte e a data de envio antes de marcar o pedido como enviado.",
    nextStatus: "enviado",
    nextAction: "Marcar como enviado",
    showConference: true,
    showOccurrence: true,
    showLogisticsClosingSummary: logisticsClosingFinished,
    showShipping: true,
    terminal: false,
  };
  if (pedido.status === "enviado") return {
    key: "shipped",
    title: "Pedido enviado",
    description: "Os dados de transporte estão disponíveis para consulta e o cliente pode confirmar o recebimento.",
    showConference: true,
    showShippingSummary: true,
    terminal: false,
  };
  return {
    key: "current",
    title: "Consultar etapa atual",
    description: "Nenhuma ação operacional adicional está disponível.",
    terminal: false,
  };
};

export const buildOrderOperationsForm = (pedido) => ({
  versaoPedido: Number(pedido.__v || 0),
  status: pedido.status || "aguardando_aprovacao",
  numeroNotaFiscal: pedido.numeroNotaFiscal || "",
  dataFaturamento: toDateInput(pedido.dataFaturamento),
  transportadora: pedido.transportadora || "",
  codigoRastreio: pedido.codigoRastreio || "",
  linkRastreio: pedido.linkRastreio || "",
  dataEnvio: toDateInput(pedido.dataEnvio),
  observacaoHistorico: "",
  separacao: Object.fromEntries((pedido.itens || []).map((item) => [
    String(item.produtoId),
    item.quantidadeSeparada ?? 0,
  ])),
  separacaoEditada: {},
  conferencia: Object.fromEntries((pedido.itens || []).map((item) => [
    String(item.produtoId),
    item.quantidadeConferida ?? item.quantidadeSeparada ?? "",
  ])),
  observacaoConferencia: pedido.conferencia?.observacao || "",
  quantidadeVolumes: pedido.fechamentoLogistico?.quantidadeVolumes ?? "",
  pesoTotalKg: pedido.fechamentoLogistico?.pesoTotalKg ?? "",
  observacaoVolumes: pedido.fechamentoLogistico?.observacaoVolumes || "",
  ocorrenciaConteudo: "",
  ocorrenciaTipo: "observacao",
});

export const updateOrderSeparationForm = (form, produtoId, value) => ({
  ...form,
  separacao: { ...form.separacao, [produtoId]: value },
  separacaoEditada: { ...form.separacaoEditada, [produtoId]: true },
});

export const buildOrderOperationsPayload = (pedido, form) => {
  const payload = {
    versaoPedido: Number(pedido.__v || 0),
    status: form.status,
    observacaoHistorico: form.observacaoHistorico,
  };

  if (pedido.status === "separado" && form.status === "faturado") {
    Object.assign(payload, {
      numeroNotaFiscal: form.numeroNotaFiscal,
      dataFaturamento: form.dataFaturamento,
    });
  }

  if (pedido.status === "faturado") {
    Object.assign(payload, {
      transportadora: form.transportadora,
      codigoRastreio: form.codigoRastreio,
      linkRastreio: form.linkRastreio,
      dataEnvio: form.dataEnvio,
    });
  }

  const conferenciaProtegeSeparacao = isConferenceFinishedForCurrentOrder(pedido);
  if (
    !conferenciaProtegeSeparacao &&
    getOrderFlowStage(pedido).showSeparationEditor === true &&
    ["separando", "separado"].includes(pedido.status) &&
    form.status !== "cancelado"
  ) {
    // O zero inicial não registra indisponibilidade ao salvar outro item ou o status.
    const separacaoItens = (pedido.itens || [])
      .filter((item) => {
        const produtoId = String(item.produtoId);
        const value = form.separacao[produtoId];
        if (value === "" || value === null || value === undefined) return false;
        const pending = item.quantidadeSeparada === null || item.quantidadeSeparada === undefined ||
          item.quantidadeSeparada === "" || item.situacaoSeparacao === "pendente";
        return !pending || Number(value) !== 0 || form.separacaoEditada?.[produtoId] === true;
      })
      .map((item) => ({
        produtoId: item.produtoId,
        quantidadeSeparada: Number(form.separacao[String(item.produtoId)]),
      }));
    if (separacaoItens.length > 0) payload.separacaoItens = separacaoItens;
  }

  if (form.ocorrenciaConteudo.trim()) {
    payload.novaOcorrencia = {
      conteudo: form.ocorrenciaConteudo.trim(),
      tipo: form.ocorrenciaTipo,
      visibilidade: "interna",
    };
  }

  return payload;
};

export const buildConferencePayload = (pedido, form) => ({
  versaoPedido: Number(pedido.__v || 0),
  conferencia: {
    acao: "concluir",
    itens: (pedido.itens || []).map((item) => {
      const value = form.conferencia[String(item.produtoId)];
      return {
        produtoId: item.produtoId,
        quantidadeConferida: value === "" ? "" : Number(value),
      };
    }),
    observacao: form.observacaoConferencia.trim(),
  },
});

export const buildLogisticsClosingPayload = (form) => ({
  versaoPedido: Number(form.versaoPedido || 0),
  fechamentoLogistico: {
    quantidadeVolumes: form.quantidadeVolumes,
    pesoTotalKg: typeof form.pesoTotalKg === "string"
      ? form.pesoTotalKg.trim().replace(",", ".")
      : form.pesoTotalKg,
    observacaoVolumes: form.observacaoVolumes.trim(),
  },
});

export const getSeparationCompletionIssues = (pedido, form) => (
  (pedido.itens || []).flatMap((item) => {
    const produtoId = String(item.produtoId);
    const requested = Number(item.quantidadeSolicitada ?? item.quantidade ?? 0);
    const formValue = form?.separacao?.[produtoId];
    const currentValue = item.quantidadeSeparada;
    const separatedValue = formValue !== undefined ? formValue : currentValue;
    const hasSeparated =
      separatedValue !== null &&
      separatedValue !== undefined &&
      separatedValue !== "" &&
      Number.isFinite(Number(separatedValue));
    const separated = hasSeparated ? Number(separatedValue) : null;

    if (separated === requested) return [];
    if (separated === null) {
      return [{
        produtoId,
        nomeProduto: item.nomeProduto,
        tipo: "nao_processado",
        message: `${item.nomeProduto}: separação ainda não processada`,
      }];
    }
    return [{
      produtoId,
      nomeProduto: item.nomeProduto,
      tipo: separated > requested ? "quantidade_excedente" : "quantidade_pendente",
      message: `${item.nomeProduto}: pedido atual ${requested}, separado ${separated}`,
    }];
  })
);

export const getConferenceCompletionIssues = (pedido, form) => (
  (pedido.itens || []).flatMap((item) => {
    const produtoId = String(item.produtoId);
    const requested = Number(item.quantidadeSolicitada ?? item.quantidade ?? 0);
    const hasSeparated =
      item.quantidadeSeparada !== null &&
      item.quantidadeSeparada !== undefined &&
      item.quantidadeSeparada !== "";
    const separated = hasSeparated ? Number(item.quantidadeSeparada) : null;
    const checkedValue = form?.conferencia?.[produtoId];
    const hasChecked =
      checkedValue !== null &&
      checkedValue !== undefined &&
      checkedValue !== "" &&
      Number.isFinite(Number(checkedValue));

    if (separated === null) {
      return [{
        produtoId,
        nomeProduto: item.nomeProduto,
        tipo: "nao_processado",
        message: `${item.nomeProduto}: separação ainda não processada`,
      }];
    }
    if (separated !== requested) {
      return [{
        produtoId,
        nomeProduto: item.nomeProduto,
        tipo: "quantidade_separada_divergente",
        message: `${item.nomeProduto}: pedido atual ${requested}, separado ${separated}`,
      }];
    }
    if (!hasChecked) {
      return [{
        produtoId,
        nomeProduto: item.nomeProduto,
        tipo: "nao_conferido",
        message: `${item.nomeProduto}: item ainda não conferido`,
      }];
    }
    if (Number(checkedValue) !== requested) {
      return [{
        produtoId,
        nomeProduto: item.nomeProduto,
        tipo: "quantidade_conferida_divergente",
        message: `${item.nomeProduto}: pedido atual ${requested}, conferido ${Number(checkedValue)}`,
      }];
    }
    return [];
  })
);
