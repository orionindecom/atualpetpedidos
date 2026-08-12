const toDateInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
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
  ocorrenciaConteudo: "",
  ocorrenciaTipo: "observacao",
});

export const buildOrderOperationsPayload = (pedido, form) => {
  const payload = {
    status: form.status,
    numeroNotaFiscal: form.numeroNotaFiscal,
    dataFaturamento: form.dataFaturamento,
    transportadora: form.transportadora,
    codigoRastreio: form.codigoRastreio,
    linkRastreio: form.linkRastreio,
    dataEnvio: form.dataEnvio,
    observacaoHistorico: form.observacaoHistorico,
  };

  const possuiSeparacaoRegistrada = (pedido.itens || []).some((item) => (
    item.quantidadeSeparada !== null && item.quantidadeSeparada !== undefined
  ));
  const statusUsaSeparacao = [
    "separando",
    "separado",
    "faturado",
    "enviado",
    "entregue",
  ].includes(form.status);
  const conferenciaProtegeSeparacao = [
    "pendente",
    "em_andamento",
    "concluida",
    "concluida_com_divergencia",
  ].includes(pedido.conferencia?.status);
  if (!conferenciaProtegeSeparacao && (possuiSeparacaoRegistrada || statusUsaSeparacao)) {
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
