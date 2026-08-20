import { isValidObjectId } from "./validation.js";
import { buildOrderAuditTimeline } from "./pedidoAuditoria.js";

export const PEDIDO_STATUS = Object.freeze([
  "aguardando_aprovacao",
  "aprovado",
  "novo",
  "em_analise",
  "separando",
  "separado",
  "faturado",
  "enviado",
  "entregue",
  "cancelado",
]);

export const STATUS_CONCLUIDOS = Object.freeze(["entregue", "cancelado"]);
export const STATUS_APOS_CONFERENCIA = Object.freeze([
  "faturado",
  "enviado",
  "entregue",
]);

const TRANSICOES_LOGISTICA = Object.freeze({
  aguardando_aprovacao: [],
  aprovado: ["separando"],
  novo: ["separando"],
  em_analise: ["separando"],
  separando: ["separado"],
  separado: [],
  faturado: ["enviado"],
  enviado: [],
  entregue: [],
  cancelado: [],
});

const TRANSICOES_ADMIN = Object.freeze({
  aguardando_aprovacao: ["cancelado"],
  aprovado: ["separando", "cancelado"],
  novo: ["separando", "cancelado"],
  em_analise: ["separando", "cancelado"],
  separando: ["separado", "cancelado"],
  separado: ["faturado", "cancelado"],
  faturado: ["enviado", "cancelado"],
  enviado: ["cancelado"],
  entregue: [],
  cancelado: [],
});

const CAMPOS_LOGISTICOS = Object.freeze([
  "versaoPedido",
  "status",
  "numeroNotaFiscal",
  "dataFaturamento",
  "transportadora",
  "codigoRastreio",
  "linkRastreio",
  "dataEnvio",
  "observacaoLogistica",
  "observacaoHistorico",
  "separacaoItens",
  "conferencia",
  "fechamentoLogistico",
  "novaOcorrencia",
]);

export const CAMPOS_FATURAMENTO = Object.freeze([
  "numeroNotaFiscal",
  "dataFaturamento",
]);

export const CAMPOS_EXPEDICAO = Object.freeze([
  "transportadora",
  "codigoRastreio",
  "linkRastreio",
  "dataEnvio",
]);

export const CAMPOS_OBRIGATORIOS_ENVIO = Object.freeze([
  ["numeroNotaFiscal", "número da Nota Fiscal"],
  ["dataFaturamento", "data de faturamento"],
  ["dataEnvio", "data de envio"],
]);

export const CAMPOS_OBRIGATORIOS_FATURAMENTO = Object.freeze([
  ["numeroNotaFiscal", "número da Nota Fiscal"],
  ["dataFaturamento", "data de faturamento"],
]);

export const OCORRENCIA_TIPOS = Object.freeze([
  "observacao",
  "falta_produto",
  "informacao_operacional",
]);

export const OCORRENCIA_VISIBILIDADES = Object.freeze(["interna", "cliente"]);

const LIMITES_TEXTO = Object.freeze({
  numeroNotaFiscal: 100,
  transportadora: 120,
  codigoRastreio: 120,
  linkRastreio: 500,
  observacaoLogistica: 1000,
  observacaoHistorico: 500,
});

const CAMPOS_DATA = Object.freeze([
  "dataFaturamento",
  "dataEnvio",
]);

const possuiCampo = (source, field) => Object.hasOwn(source, field);

const normalizarTexto = (value, maxLength) => {
  if (value === null || value === "") return { value: "" };
  if (typeof value !== "string" || value.trim().length > maxLength) {
    return { error: `Informe um texto de até ${maxLength} caracteres` };
  }
  return { value: value.trim() };
};

const normalizarData = (value) => {
  if (value === null || value === "") return { value: null };
  if (typeof value !== "string" && !(value instanceof Date)) {
    return { error: "Informe uma data válida" };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { error: "Informe uma data válida" };
  return { value: parsed };
};

export const isSafeTrackingUrl = (value) => {
  if (value === "") return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
};

export const transicoesPermitidasLogistica = (status) => (
  TRANSICOES_LOGISTICA[status] || []
);

export const conferenciaConcluida = (pedido) => (
  pedido?.conferencia?.status === "concluida" &&
  (
    pedido?.conferencia?.versaoOperacional === undefined ||
    Number(pedido.conferencia.versaoOperacional) ===
      Number(pedido.versaoOperacional || 1)
  ) &&
  (
    Array.isArray(pedido?.conferencia?.itens) &&
    pedido.conferencia.itens.length > 0
      ? getConferenceCompletionBlockers(
        pedido,
        pedido.conferencia.itens
      ).length === 0
      : (pedido?.itens || []).every((item) => {
        const separation = getItemSeparation(item);
        return separation.quantidadeSeparada !== null &&
          separation.quantidadeSeparada === separation.quantidadeSolicitada;
      })
  )
);

export const pedidoExigeConferencia = (pedido) => (
  pedido?.conferenciaObrigatoria === true
);

export const pedidoExigeFechamentoLogistico = (pedido) => (
  pedido?.fechamentoLogisticoObrigatorio === true
);

export const fechamentoLogisticoConcluido = (pedido) => {
  const fechamento = pedido?.fechamentoLogistico;
  return Boolean(
    Number.isInteger(Number(fechamento?.quantidadeVolumes)) &&
    Number(fechamento?.quantidadeVolumes) > 0 &&
    Number.isFinite(Number(fechamento?.pesoTotalKg)) &&
    Number(fechamento?.pesoTotalKg) > 0 &&
    typeof fechamento?.observacaoVolumes === "string" &&
    fechamento.observacaoVolumes.trim().length > 0 &&
    fechamento?.preenchidoEm &&
    fechamento?.preenchidoPor?.usuarioId &&
    fechamento?.preenchidoPor?.operadorId
  );
};

export const pedidoPossuiEntregaConfirmada = (pedido) => (
  pedido?.status === "entregue" ||
  Boolean(pedido?.dataEntrega) ||
  (pedido?.historicoStatus || []).some((entry) => entry.novoStatus === "entregue")
);

export const transicoesPermitidasParaPedido = (
  pedido,
  { admin = false } = {}
) => {
  if (pedidoPossuiEntregaConfirmada(pedido)) return [];

  const transicoes = admin
    ? TRANSICOES_ADMIN[pedido?.status] || []
    : transicoesPermitidasLogistica(pedido?.status);

  if (
    pedido?.status === "separado" &&
    pedidoExigeConferencia(pedido) &&
    !conferenciaConcluida(pedido)
  ) {
    return transicoes.filter((status) => !STATUS_APOS_CONFERENCIA.includes(status));
  }

  if (
    pedido?.status === "separado" &&
    pedidoExigeFechamentoLogistico(pedido) &&
    !fechamentoLogisticoConcluido(pedido)
  ) {
    return transicoes.filter((status) => status !== "faturado");
  }

  return transicoes;
};

const valorPreenchido = (value) => (
  value instanceof Date
    ? !Number.isNaN(value.getTime())
    : typeof value === "string"
      ? value.trim().length > 0
      : value !== null && value !== undefined
);

const valorEfetivo = (pedido, data, field) => (
  Object.hasOwn(data || {}, field) ? data[field] : pedido?.[field]
);

export const validarTransicaoPedido = ({
  pedido,
  novoStatus,
  usuarioTipo = "logistica",
  data = {},
}) => {
  const statusAtual = pedido?.status;

  if (pedidoPossuiEntregaConfirmada(pedido)) {
    return {
      valid: false,
      message: "Pedido entregue é um estado terminal e não pode ser alterado",
    };
  }

  if (!novoStatus || novoStatus === statusAtual) return { valid: true };

  if (["aguardando_aprovacao", "aprovado"].includes(novoStatus)) {
    return {
      valid: false,
      message: "Estados de aprovação só podem ser alterados pela ação de aprovação do Admin",
    };
  }

  if (novoStatus === "entregue") {
    return {
      valid: false,
      message: "O status Entregue deve ser confirmado pelo cliente",
    };
  }

  const transicoes = usuarioTipo === "admin"
    ? transicoesPermitidasParaPedido(pedido, { admin: true })
    : transicoesPermitidasParaPedido(pedido);
  if (!transicoes.includes(novoStatus)) {
    if (
      statusAtual === "separado" &&
      STATUS_APOS_CONFERENCIA.includes(novoStatus) &&
      pedidoExigeConferencia(pedido) &&
      !conferenciaConcluida(pedido)
    ) {
      return {
        valid: false,
        message: "Conclua a conferência de todos os itens antes de liberar o pedido para faturamento",
      };
    }
    if (
      statusAtual === "separado" &&
      novoStatus === "faturado" &&
      pedidoExigeFechamentoLogistico(pedido) &&
      !fechamentoLogisticoConcluido(pedido)
    ) {
      return {
        valid: false,
        message: "Conclua o fechamento logístico com volumes, peso e descrição antes de faturar o pedido",
      };
    }
    return {
      valid: false,
      message: `Transição de ${statusAtual} para ${novoStatus} não permitida`,
    };
  }

  if (novoStatus === "faturado") {
    const ausentes = CAMPOS_OBRIGATORIOS_FATURAMENTO
      .filter(([field]) => !valorPreenchido(valorEfetivo(pedido, data, field)))
      .map(([, label]) => label);
    if (ausentes.length > 0) {
      return {
        valid: false,
        message: `Preencha ${ausentes.join(", ")} antes de faturar o pedido`,
      };
    }
  }

  if (novoStatus === "enviado") {
    const ausentes = CAMPOS_OBRIGATORIOS_ENVIO
      .filter(([field]) => !valorPreenchido(valorEfetivo(pedido, data, field)))
      .map(([, label]) => label);
    if (ausentes.length > 0) {
      return {
        valid: false,
        message: `Preencha ${ausentes.join(", ")} antes de marcar o pedido como enviado`,
      };
    }
  }

  return { valid: true };
};

export const validarCamposPedidoPorEtapa = ({
  pedido,
  data = {},
  separacaoItens,
  usuarioTipo = "logistica",
}) => {
  const iniciandoFaturamento = pedido?.status === "separado" && data.status === "faturado";
  const podeInformarFaturamento = usuarioTipo === "admin" && (
    iniciandoFaturamento || pedido?.status === "faturado"
  );
  const faturamentoForaDaEtapa = CAMPOS_FATURAMENTO.some((field) => (
    Object.hasOwn(data, field) && !podeInformarFaturamento
  ));
  if (faturamentoForaDaEtapa) {
    return {
      valid: false,
      message: "Número e data da Nota Fiscal só podem ser informados pelo Admin ao faturar o pedido",
    };
  }

  if (
    pedido?.status === "faturado" &&
    CAMPOS_FATURAMENTO.some((field) => Object.hasOwn(data, field)) &&
    CAMPOS_OBRIGATORIOS_FATURAMENTO.some(([field]) => (
      !valorPreenchido(valorEfetivo(pedido, data, field))
    ))
  ) {
    return {
      valid: false,
      message: "Número e data da Nota Fiscal não podem ser removidos de um pedido faturado",
    };
  }

  const expedicaoForaDaEtapa = CAMPOS_EXPEDICAO.some((field) => (
    Object.hasOwn(data, field) && pedido?.status !== "faturado"
  ));
  if (expedicaoForaDaEtapa) {
    return {
      valid: false,
      message: "Dados de envio só podem ser informados depois que o pedido estiver faturado",
    };
  }

  const correcaoAntesDaConclusaoDaConferencia =
    pedido?.status === "separado" &&
    pedidoExigeConferencia(pedido) &&
    !conferenciaConcluida(pedido);
  if (
    separacaoItens &&
    pedido?.status !== "separando" &&
    !correcaoAntesDaConclusaoDaConferencia
  ) {
    return {
      valid: false,
      message: "As quantidades separadas só podem ser registradas durante a separação ou corrigidas antes da conclusão da conferência",
    };
  }

  return { valid: true };
};

export const transicaoLogisticaPermitida = (statusAtual, novoStatus) => (
  statusAtual === novoStatus ||
  transicoesPermitidasLogistica(statusAtual).includes(novoStatus)
);

export const pedidoAguardandoAprovacao = (pedidoOuStatus) => (
  (typeof pedidoOuStatus === "string" ? pedidoOuStatus : pedidoOuStatus?.status) ===
  "aguardando_aprovacao"
);

export const pedidoDisponivelParaLogistica = (pedidoOuStatus) => (
  !pedidoAguardandoAprovacao(pedidoOuStatus)
);

export const getItemSeparation = (item = {}) => {
  const quantidadeSolicitada = Number(item.quantidade || 0);
  const possuiQuantidadeSeparada =
    item.quantidadeSeparada !== undefined &&
    item.quantidadeSeparada !== null &&
    item.quantidadeSeparada !== "" &&
    Number.isFinite(Number(item.quantidadeSeparada));
  const quantidadeSeparada = possuiQuantidadeSeparada
    ? Number(item.quantidadeSeparada)
    : null;
  const quantidadeFaltanteSeparacao = quantidadeSeparada === null
    ? null
    : Math.max(quantidadeSolicitada - quantidadeSeparada, 0);
  const possuiQuantidadeFinal =
    item.quantidadeFinal !== undefined &&
    item.quantidadeFinal !== null &&
    item.quantidadeFinal !== "" &&
    Number.isFinite(Number(item.quantidadeFinal));
  const quantidadeFinal = possuiQuantidadeFinal
    ? Number(item.quantidadeFinal)
    : null;
  const quantidadeAtendida = quantidadeFinal ?? quantidadeSeparada;
  const quantidadeFaltante = quantidadeAtendida === null
    ? null
    : Math.max(quantidadeSolicitada - quantidadeAtendida, 0);

  let situacaoSeparacao = "pendente";
  if (quantidadeSeparada !== null) {
    if (quantidadeSeparada > quantidadeSolicitada) {
      situacaoSeparacao = "excedente";
    } else if (quantidadeSeparada === 0 && quantidadeSolicitada > 0) {
      situacaoSeparacao = "indisponivel";
    } else if (quantidadeFaltanteSeparacao > 0) {
      situacaoSeparacao = "parcial";
    } else {
      situacaoSeparacao = "completo";
    }
  }

  return {
    quantidadeSolicitada,
    quantidadeSeparada,
    quantidadeFaltanteSeparacao,
    quantidadeExcedenteSeparacao: quantidadeSeparada === null
      ? null
      : Math.max(quantidadeSeparada - quantidadeSolicitada, 0),
    quantidadeConferida: item.quantidadeConferida ?? null,
    quantidadeFinal,
    quantidadeAtendida,
    quantidadeFaltante,
    situacaoSeparacao,
    situacaoFinal: item.situacaoFinal || undefined,
  };
};

export const getSeparationCompletionBlockers = (
  pedido,
  separationItems = []
) => {
  const items = Array.isArray(pedido?.itens) ? pedido.itens : [];
  const separationByProduct = new Map(
    (Array.isArray(separationItems) ? separationItems : []).map((item) => [
      String(item.produtoId),
      item.quantidadeSeparada,
    ])
  );

  return items.flatMap((item) => {
    const produtoId = String(item.produtoId);
    const separation = getItemSeparation({
      ...item,
      quantidadeSeparada: separationByProduct.has(produtoId)
        ? separationByProduct.get(produtoId)
        : item.quantidadeSeparada,
    });

    if (separation.quantidadeSeparada === separation.quantidadeSolicitada) {
      return [];
    }

    if (separation.quantidadeSeparada === null) {
      return [{
        produtoId: item.produtoId,
        nomeProduto: item.nomeProduto,
        tipo: "nao_processado",
        quantidadePedida: separation.quantidadeSolicitada,
        quantidadeSeparada: null,
        message: `${item.nomeProduto}: separação ainda não processada`,
      }];
    }

    const tipo = separation.quantidadeSeparada > separation.quantidadeSolicitada
      ? "quantidade_excedente"
      : "quantidade_pendente";
    return [{
      produtoId: item.produtoId,
      nomeProduto: item.nomeProduto,
      tipo,
      quantidadePedida: separation.quantidadeSolicitada,
      quantidadeSeparada: separation.quantidadeSeparada,
      message: `${item.nomeProduto}: pedido atual ${separation.quantidadeSolicitada}, separado ${separation.quantidadeSeparada}`,
    }];
  });
};

export const getConferenceCompletionBlockers = (
  pedido,
  conferenceItems = []
) => {
  const items = Array.isArray(pedido?.itens) ? pedido.itens : [];
  const conferenceByProduct = new Map(
    (Array.isArray(conferenceItems) ? conferenceItems : []).map((item) => [
      String(item.produtoId),
      item,
    ])
  );
  const blockers = [];

  for (const item of items) {
    const separation = getItemSeparation(item);
    const conferenceItem = conferenceByProduct.get(String(item.produtoId));
    const checkedValue = conferenceItem?.quantidadeConferida;
    const hasCheckedValue =
      checkedValue !== undefined &&
      checkedValue !== null &&
      checkedValue !== "" &&
      Number.isFinite(Number(checkedValue));

    if (separation.quantidadeSeparada === null) {
      blockers.push({
        produtoId: item.produtoId,
        nomeProduto: item.nomeProduto,
        tipo: "nao_processado",
        quantidadePedida: separation.quantidadeSolicitada,
        quantidadeSeparada: null,
        message: `${item.nomeProduto}: separação ainda não processada`,
      });
      continue;
    }

    if (separation.quantidadeSeparada !== separation.quantidadeSolicitada) {
      blockers.push({
        produtoId: item.produtoId,
        nomeProduto: item.nomeProduto,
        tipo: "quantidade_separada_divergente",
        quantidadePedida: separation.quantidadeSolicitada,
        quantidadeSeparada: separation.quantidadeSeparada,
        message: `${item.nomeProduto}: pedido atual ${separation.quantidadeSolicitada}, separado ${separation.quantidadeSeparada}`,
      });
      continue;
    }

    if (!conferenceItem || !hasCheckedValue) {
      blockers.push({
        produtoId: item.produtoId,
        nomeProduto: item.nomeProduto,
        tipo: "nao_conferido",
        quantidadePedida: separation.quantidadeSolicitada,
        quantidadeSeparada: separation.quantidadeSeparada,
        message: `${item.nomeProduto}: item ainda não conferido`,
      });
      continue;
    }

    if (Number(checkedValue) !== separation.quantidadeSolicitada) {
      blockers.push({
        produtoId: item.produtoId,
        nomeProduto: item.nomeProduto,
        tipo: "quantidade_conferida_divergente",
        quantidadePedida: separation.quantidadeSolicitada,
        quantidadeSeparada: separation.quantidadeSeparada,
        quantidadeConferida: Number(checkedValue),
        message: `${item.nomeProduto}: pedido atual ${separation.quantidadeSolicitada}, conferido ${Number(checkedValue)}`,
      });
    }
  }

  for (const conferenceItem of conferenceByProduct.values()) {
    if (items.some((item) => String(item.produtoId) === String(conferenceItem.produtoId))) {
      continue;
    }
    blockers.push({
      produtoId: conferenceItem.produtoId,
      nomeProduto: conferenceItem.nomeProduto || "Item removido",
      tipo: "item_removido",
      message: `${conferenceItem.nomeProduto || "Item"}: não pertence mais ao pedido atual`,
    });
  }

  return blockers;
};

export const enrichOrderSeparation = (pedido) => {
  const source = typeof pedido?.toObject === "function" ? pedido.toObject() : { ...pedido };
  const itens = Array.isArray(source.itens)
    ? source.itens.map((item) => ({
      ...item,
      ...getItemSeparation(item),
    }))
    : [];

  return {
    ...source,
    itens,
    temDivergencia: itens.some((item) => (
      item.quantidadeSeparada !== null &&
      Number(item.quantidadeSeparada) !== Number(item.quantidadeSolicitada)
    )),
    temItemNaoProcessado: itens.some((item) => item.quantidadeSeparada === null),
    entregaFinalizada: pedidoPossuiEntregaConfirmada(source),
  };
};

const validateSeparationItems = (value) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    return { error: "Informe de 1 a 200 itens de separação" };
  }

  const seen = new Set();
  const itens = [];
  for (const item of value) {
    const fields = item && typeof item === "object" && !Array.isArray(item)
      ? Object.keys(item)
      : [];
    const produtoId = item?.produtoId;
    const quantidadeInformada = item?.quantidadeSeparada;
    const quantidadeSeparada = Number(quantidadeInformada);
    if (
      fields.some((field) => !["produtoId", "quantidadeSeparada"].includes(field)) ||
      !isValidObjectId(produtoId) ||
      seen.has(String(produtoId)) ||
      quantidadeInformada === "" ||
      quantidadeInformada === null ||
      quantidadeInformada === undefined ||
      !Number.isFinite(quantidadeSeparada) ||
      quantidadeSeparada < 0 ||
      quantidadeSeparada > 999999
    ) {
      return { error: "Itens de separação inválidos ou duplicados" };
    }
    seen.add(String(produtoId));
    itens.push({ produtoId: String(produtoId), quantidadeSeparada });
  }

  return { value: itens };
};

const validateOccurrence = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Informe uma ocorrência válida" };
  }
  const allowedFields = ["conteudo", "tipo", "visibilidade"];
  if (Object.keys(value).some((field) => !allowedFields.includes(field))) {
    return { error: "A ocorrência possui campos não permitidos" };
  }
  const conteudo = typeof value.conteudo === "string" ? value.conteudo.trim() : "";
  if (!conteudo || conteudo.length > 1000) {
    return { error: "Informe um conteúdo de até 1000 caracteres" };
  }
  if (!OCORRENCIA_TIPOS.includes(value.tipo)) {
    return { error: "Tipo de ocorrência inválido" };
  }
  if (
    value.visibilidade !== undefined &&
    !OCORRENCIA_VISIBILIDADES.includes(value.visibilidade)
  ) {
    return { error: "Visibilidade da ocorrência inválida" };
  }
  return {
    value: {
      conteudo,
      tipo: value.tipo,
      visibilidade: "interna",
    },
  };
};

const validateConference = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Informe uma conferência válida" };
  }

  const allowedFields = ["acao", "itens", "observacao"];
  if (Object.keys(value).some((field) => !allowedFields.includes(field))) {
    return { error: "A conferência possui campos não permitidos" };
  }
  if (!["iniciar", "concluir"].includes(value.acao)) {
    return { error: "Ação de conferência inválida" };
  }

  if (value.acao === "iniciar") {
    if (Object.keys(value).some((field) => field !== "acao")) {
      return { error: "A ação de iniciar não aceita itens ou observações" };
    }
    return { value: { acao: "iniciar" } };
  }

  const observacao = value.observacao === undefined || value.observacao === null
    ? ""
    : typeof value.observacao === "string"
      ? value.observacao.trim()
      : null;
  if (observacao === null || observacao.length > 1000) {
    return { error: "Informe uma observação de até 1000 caracteres" };
  }
  if (!Array.isArray(value.itens) || value.itens.length === 0 || value.itens.length > 200) {
    return { error: "Informe de 1 a 200 itens de conferência" };
  }

  const seen = new Set();
  const itens = [];
  for (const item of value.itens) {
    const fields = item && typeof item === "object" && !Array.isArray(item)
      ? Object.keys(item)
      : [];
    const produtoId = item?.produtoId;
    const quantidadeInformada = item?.quantidadeConferida;
    const quantidadeConferida = Number(quantidadeInformada);
    if (
      fields.some((field) => !["produtoId", "quantidadeConferida"].includes(field)) ||
      !isValidObjectId(produtoId) ||
      seen.has(String(produtoId)) ||
      quantidadeInformada === "" ||
      quantidadeInformada === null ||
      quantidadeInformada === undefined ||
      !Number.isFinite(quantidadeConferida) ||
      quantidadeConferida < 0 ||
      quantidadeConferida > 999999
    ) {
      return { error: "Itens de conferência inválidos ou duplicados" };
    }
    seen.add(String(produtoId));
    itens.push({ produtoId: String(produtoId), quantidadeConferida });
  }

  return {
    value: {
      acao: "concluir",
      itens,
      observacao,
    },
  };
};

export const validateLogisticsClosing = (source) => {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return { error: "Informe os dados do fechamento logístico" };
  }

  const allowedFields = [
    "quantidadeVolumes",
    "pesoTotalKg",
    "observacaoVolumes",
  ];
  const extraFields = Object.keys(source).filter((field) => !allowedFields.includes(field));
  if (extraFields.length > 0) {
    return { error: `Campos de fechamento não permitidos: ${extraFields.join(", ")}` };
  }

  const quantidadeTexto = typeof source.quantidadeVolumes === "string"
    ? source.quantidadeVolumes.trim()
    : source.quantidadeVolumes;
  const quantidadeVolumes = Number(quantidadeTexto);
  if (
    quantidadeTexto === "" ||
    !Number.isInteger(quantidadeVolumes) ||
    quantidadeVolumes <= 0 ||
    quantidadeVolumes > 999999
  ) {
    return { error: "Informe uma quantidade de volumes inteira e maior que zero" };
  }

  const pesoTexto = typeof source.pesoTotalKg === "string"
    ? source.pesoTotalKg.trim()
    : source.pesoTotalKg;
  if (typeof pesoTexto === "string" && !/^\d+(?:[.,]\d+)?$/.test(pesoTexto)) {
    return { error: "Informe um peso total válido e maior que zero" };
  }
  const pesoTotalKg = Number(
    typeof pesoTexto === "string" ? pesoTexto.replace(",", ".") : pesoTexto
  );
  if (!Number.isFinite(pesoTotalKg) || pesoTotalKg <= 0 || pesoTotalKg > 999999999) {
    return { error: "Informe um peso total válido e maior que zero" };
  }

  if (
    typeof source.observacaoVolumes !== "string" ||
    source.observacaoVolumes.trim().length === 0 ||
    source.observacaoVolumes.trim().length > 3000
  ) {
    return { error: "Descreva os volumes/caixas em até 3000 caracteres" };
  }

  return {
    value: {
      quantidadeVolumes,
      pesoTotalKg,
      observacaoVolumes: source.observacaoVolumes.trim(),
    },
  };
};

export const validateLogisticsOrderPayload = (source) => {
  const body = source && typeof source === "object" && !Array.isArray(source)
    ? source
    : {};
  const errors = {};
  const data = {};
  let observacaoHistorico = "";
  let separacaoItens;
  let conferencia;
  let fechamentoLogistico;
  let novaOcorrencia;
  let versaoPedido;

  const fields = Object.keys(body);
  const forbiddenFields = fields.filter((field) => !CAMPOS_LOGISTICOS.includes(field));
  if (forbiddenFields.length > 0) {
    errors.campos = `Campos não permitidos: ${forbiddenFields.join(", ")}`;
  }

  if (possuiCampo(body, "status")) {
    if (!PEDIDO_STATUS.includes(body.status)) errors.status = "Status inválido";
    else data.status = body.status;
  }

  if (possuiCampo(body, "versaoPedido")) {
    const parsedVersion = Number(body.versaoPedido);
    if (!Number.isInteger(parsedVersion) || parsedVersion < 0) {
      errors.versaoPedido = "Versão do pedido inválida";
    } else {
      versaoPedido = parsedVersion;
    }
  }

  for (const [field, maxLength] of Object.entries(LIMITES_TEXTO)) {
    if (!possuiCampo(body, field)) continue;
    const normalized = normalizarTexto(body[field], maxLength);
    if (normalized.error) errors[field] = normalized.error;
    else if (field === "observacaoHistorico") observacaoHistorico = normalized.value;
    else data[field] = normalized.value;
  }

  for (const field of CAMPOS_DATA) {
    if (!possuiCampo(body, field)) continue;
    const normalized = normalizarData(body[field]);
    if (normalized.error) errors[field] = normalized.error;
    else data[field] = normalized.value;
  }

  if (possuiCampo(body, "separacaoItens")) {
    const normalized = validateSeparationItems(body.separacaoItens);
    if (normalized.error) errors.separacaoItens = normalized.error;
    else separacaoItens = normalized.value;
  }

  if (possuiCampo(body, "novaOcorrencia")) {
    const normalized = validateOccurrence(body.novaOcorrencia);
    if (normalized.error) errors.novaOcorrencia = normalized.error;
    else novaOcorrencia = normalized.value;
  }

  if (possuiCampo(body, "conferencia")) {
    const normalized = validateConference(body.conferencia);
    if (normalized.error) errors.conferencia = normalized.error;
    else conferencia = normalized.value;
  }

  if (possuiCampo(body, "fechamentoLogistico")) {
    const normalized = validateLogisticsClosing(body.fechamentoLogistico);
    if (normalized.error) errors.fechamentoLogistico = normalized.error;
    else fechamentoLogistico = normalized.value;
  }

  if (Object.hasOwn(data, "linkRastreio") && !isSafeTrackingUrl(data.linkRastreio)) {
    errors.linkRastreio = "Informe um link HTTPS válido";
  }

  if (
    Object.keys(data).length === 0 &&
    !separacaoItens &&
    !conferencia &&
    !fechamentoLogistico &&
    !novaOcorrencia &&
    Object.keys(errors).length === 0
  ) {
    errors.campos = "Informe ao menos um campo logístico para atualizar";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    data,
    observacaoHistorico,
    separacaoItens,
    conferencia,
    fechamentoLogistico,
    novaOcorrencia,
    versaoPedido,
  };
};

export const buildStatusHistoryEntry = ({
  statusAnterior,
  novoStatus,
  usuario,
  operador,
  observacao = "",
  now = new Date(),
}) => ({
  statusAnterior,
  novoStatus,
  alteradoEm: now,
  usuarioId: usuario._id,
  usuarioNome: usuario.nomeResponsavel || usuario.nomeFantasia || "Usuário interno",
  usuarioTipo: usuario.tipo,
  ...(operador
    ? { operadorId: operador._id, operadorNome: operador.nome }
    : {}),
  observacao: observacao || undefined,
});

export const buildOccurrenceEntry = ({
  conteudo,
  tipo = "observacao",
  usuario,
  operador,
  produtoId,
  nomeProduto,
  now = new Date(),
}) => ({
  conteudo,
  criadaEm: now,
  usuarioId: usuario._id,
  usuarioNome: usuario.nomeResponsavel || usuario.nomeFantasia || "Usuário interno",
  usuarioTipo: usuario.tipo,
  ...(operador
    ? { operadorId: operador._id, operadorNome: operador.nome }
    : {}),
  tipo,
  visibilidade: "interna",
  produtoId: produtoId || undefined,
  nomeProduto: nomeProduto || undefined,
});

export const buildClientReceiptConfirmationUpdate = ({
  usuario,
  now = new Date(),
}) => ({
  $set: {
    status: "entregue",
    dataEntrega: now,
  },
  $push: {
    historicoStatus: buildStatusHistoryEntry({
      statusAnterior: "enviado",
      novoStatus: "entregue",
      usuario,
      observacao: "Recebimento confirmado pelo cliente",
      now,
    }),
  },
});

export const sanitizeClientOrder = (pedido) => {
  const original = typeof pedido?.toObject === "function" ? pedido.toObject() : pedido;
  const source = { ...original };
  delete source.historicoStatus;
  delete source.historicoPedido;
  delete source.observacaoLogistica;
  delete source.aprovacao;
  delete source.conferencia;
  delete source.conferenciaObrigatoria;
  delete source.fechamentoLogistico;
  delete source.fechamentoLogisticoObrigatorio;
  delete source.ocorrencias;
  delete source.historicoAlteracoes;
  delete source.historicoConferencias;
  delete source.versaoOperacional;
  delete source.__v;
  delete source.temDivergencia;
  source.itens = Array.isArray(source.itens)
    ? source.itens.map((item) => ({
      produtoId: item.produtoId,
      nomeProduto: item.nomeProduto,
      quantidade: item.quantidade,
      valorUnitario: item.valorUnitario,
      subtotal: item.subtotal,
    }))
    : [];
  return source;
};

export const enrichInternalOrderDetail = (pedido) => {
  const source = enrichOrderSeparation(pedido);
  return {
    ...source,
    entregaFinalizada: pedidoPossuiEntregaConfirmada(source),
    historicoPedido: buildOrderAuditTimeline(source),
  };
};
