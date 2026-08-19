const toDateInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

const CONFERENCE_FINISHED = new Set(["concluida", "concluida_com_divergencia"]);

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
  const conferenceFinished = CONFERENCE_FINISHED.has(pedido.conferencia?.status);
  const logisticsClosingFinished = isLogisticsClosingComplete(pedido);
  const terminal = pedido.status === "entregue" ||
    pedido.status === "cancelado" ||
    pedido.entregaFinalizada === true;

  if (terminal) return {
    key: pedido.status === "cancelado" ? "canceled" : "delivered",
    title: pedido.status === "cancelado" ? "Pedido cancelado" : "Pedido entregue — estado final",
    description: "As ações operacionais estão encerradas; histórico e documentos permanecem disponíveis.",
    showConference: Boolean(pedido.conferencia),
    showShippingSummary: pedido.status !== "cancelado",
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
    item.quantidadeSeparada ?? "",
  ])),
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

export const buildOrderOperationsPayload = (pedido, form) => {
  const payload = {
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

  const conferenciaProtegeSeparacao = [
    "pendente",
    "em_andamento",
    "concluida",
    "concluida_com_divergencia",
  ].includes(pedido.conferencia?.status);
  if (
    !conferenciaProtegeSeparacao &&
    pedido.status === "separando" &&
    form.status !== "cancelado"
  ) {
    payload.separacaoItens = (pedido.itens || []).map((item) => ({
      produtoId: item.produtoId,
      quantidadeSeparada: Number(form.separacao[String(item.produtoId)]),
    }));
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
  fechamentoLogistico: {
    quantidadeVolumes: form.quantidadeVolumes,
    pesoTotalKg: typeof form.pesoTotalKg === "string"
      ? form.pesoTotalKg.trim().replace(",", ".")
      : form.pesoTotalKg,
    observacaoVolumes: form.observacaoVolumes.trim(),
  },
});
