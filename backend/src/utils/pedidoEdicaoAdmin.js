import {
  buildOccurrenceEntry,
  buildStatusHistoryEntry,
  getItemSeparation,
  initializeOrderItemSeparation,
  pedidoPossuiEntregaConfirmada,
} from "./pedidoLogistica.js";

export const STATUS_EDITAVEIS_ADMIN = Object.freeze([
  "aguardando_aprovacao",
  "aprovado",
  "novo",
  "em_analise",
  "separando",
  "separado",
]);

const CAMPOS_OPERACIONAIS_ITEM = Object.freeze([
  "quantidadeSeparada",
  "situacaoSeparacao",
  "quantidadeConferida",
  "quantidadeFinal",
  "situacaoFinal",
]);

const asPlainObject = (value) => (
  typeof value?.toObject === "function" ? value.toObject() : { ...value }
);

const sameNumber = (first, second) => Number(first) === Number(second);

const mapByProduct = (items = []) => new Map(
  items.map((item) => [String(item.produtoId), item])
);

export const pedidoPodeSerEditadoPeloAdmin = (pedidoOuStatus) => (
  !pedidoPossuiEntregaConfirmada(typeof pedidoOuStatus === "string" ? { status: pedidoOuStatus } : pedidoOuStatus) &&
  STATUS_EDITAVEIS_ADMIN.includes(
    typeof pedidoOuStatus === "string" ? pedidoOuStatus : pedidoOuStatus?.status
  )
);

export const buildAdminOrderItemChanges = (currentItems = [], nextItems = []) => {
  const currentByProduct = mapByProduct(currentItems);
  const nextByProduct = mapByProduct(nextItems);
  const changes = [];

  for (const current of currentItems) {
    const next = nextByProduct.get(String(current.produtoId));
    if (!next) {
      changes.push({
        produtoId: current.produtoId,
        nomeProduto: current.nomeProduto,
        tipo: "removido",
        quantidadeAnterior: Number(current.quantidade),
        valorUnitarioAnterior: Number(current.valorUnitario),
        subtotalAnterior: Number(current.subtotal),
        quantidadeSeparadaNoMomento:
          getItemSeparation(current).quantidadeSeparada ?? undefined,
      });
      continue;
    }

    if (!sameNumber(current.quantidade, next.quantidade)) {
      changes.push({
        produtoId: next.produtoId,
        nomeProduto: next.nomeProduto,
        tipo: "quantidade_alterada",
        quantidadeAnterior: Number(current.quantidade),
        quantidadeNova: Number(next.quantidade),
        valorUnitarioAnterior: Number(current.valorUnitario),
        valorUnitarioNovo: Number(next.valorUnitario),
        subtotalAnterior: Number(current.subtotal),
        subtotalNovo: Number(next.subtotal),
        quantidadeSeparadaNoMomento:
          getItemSeparation(current).quantidadeSeparada ?? undefined,
      });
    }

    if (!sameNumber(current.valorUnitario, next.valorUnitario)) {
      changes.push({
        produtoId: next.produtoId,
        nomeProduto: next.nomeProduto,
        tipo: "preco_alterado",
        quantidadeAnterior: Number(current.quantidade),
        quantidadeNova: Number(next.quantidade),
        valorUnitarioAnterior: Number(current.valorUnitario),
        valorUnitarioNovo: Number(next.valorUnitario),
        subtotalAnterior: Number(current.subtotal),
        subtotalNovo: Number(next.subtotal),
        quantidadeSeparadaNoMomento:
          getItemSeparation(current).quantidadeSeparada ?? undefined,
      });
    }
  }

  for (const next of nextItems) {
    if (currentByProduct.has(String(next.produtoId))) continue;
    changes.push({
      produtoId: next.produtoId,
      nomeProduto: next.nomeProduto,
      tipo: "adicionado",
      quantidadeNova: Number(next.quantidade),
      valorUnitarioNovo: Number(next.valorUnitario),
      subtotalNovo: Number(next.subtotal),
    });
  }

  return changes;
};

const buildOrderEditor = (usuario = {}) => ({
  usuarioId: usuario._id,
  usuarioNome:
    usuario.nomeResponsavel || usuario.nomeFantasia || "Administrador",
  usuarioTipo: usuario.tipo,
});

const preserveOperationalWork = ({ currentItems, nextItems, resetConference }) => {
  const currentByProduct = mapByProduct(currentItems);

  return nextItems.map((nextItem) => {
    const current = currentByProduct.get(String(nextItem.produtoId));
    if (!current) return initializeOrderItemSeparation(nextItem);

    const next = { ...nextItem };
    for (const field of CAMPOS_OPERACIONAIS_ITEM) {
      if (current[field] !== undefined && current[field] !== null) {
        next[field] = current[field];
      }
    }

    const separated = getItemSeparation(current).quantidadeSeparada;
    if (separated !== null) {
      next.quantidadeSeparada = separated;
      next.situacaoSeparacao = getItemSeparation({
        quantidade: next.quantidade,
        quantidadeSeparada: separated,
        situacaoSeparacao: current.situacaoSeparacao,
      }).situacaoSeparacao;
    }

    if (resetConference) {
      delete next.quantidadeConferida;
      delete next.quantidadeFinal;
      delete next.situacaoFinal;
    }

    return next;
  });
};

const hasConferenceWork = (conference) => Boolean(
  conference && (
    conference.status === "em_andamento" ||
    conference.status === "concluida" ||
    conference.status === "concluida_com_divergencia" ||
    conference.iniciadaEm ||
    conference.concluidaEm
  )
);

export const applyAdminOrderEdit = ({
  pedido,
  itensPedido,
  valorTotal,
  observacao,
  usuario,
  now = new Date(),
}) => {
  const currentItems = Array.isArray(pedido.itens) ? pedido.itens : [];
  const changes = buildAdminOrderItemChanges(currentItems, itensPedido);
  const physicalChanges = changes.filter((change) => change.tipo !== "preco_alterado");
  const physicalOrderChanged = physicalChanges.length > 0;
  const commercialOrderChanged = changes.length > 0;
  const previousOperationalVersion = Number(pedido.versaoOperacional || 1);
  const nextOperationalVersion = physicalOrderChanged
    ? previousOperationalVersion + 1
    : previousOperationalVersion;
  const previousTotal = Number(pedido.valorTotal || 0);
  const previousStatus = pedido.status;

  const nextItems = preserveOperationalWork({
    currentItems,
    nextItems: itensPedido,
    resetConference: physicalOrderChanged,
  });

  if (physicalOrderChanged && hasConferenceWork(pedido.conferencia)) {
    pedido.historicoConferencias ||= [];
    pedido.historicoConferencias.push({
      conferencia: asPlainObject(pedido.conferencia),
      invalidadaEm: now,
      invalidadaPor: buildOrderEditor(usuario),
      motivo: "Pedido alterado; a versão atual precisa de nova conferência.",
    });
  }

  pedido.itens = nextItems;
  pedido.valorTotal = Number(valorTotal);
  pedido.observacao = observacao;
  pedido.versaoOperacional = nextOperationalVersion;

  const precisaReabrirSeparacao = physicalOrderChanged && previousStatus === "separado" && (
    nextItems.some((item) => {
      const separated = getItemSeparation(item).quantidadeSeparada;
      return separated === null || separated !== Number(item.quantidade);
    })
  );

  if (physicalOrderChanged && pedido.conferenciaObrigatoria === true) {
    pedido.conferencia = previousStatus === "separado" && !precisaReabrirSeparacao
      ? {
        status: "pendente",
        versaoOperacional: nextOperationalVersion,
      }
      : undefined;
  }

  if (physicalOrderChanged && pedido.fechamentoLogistico) {
    const closing = asPlainObject(pedido.fechamentoLogistico);
    pedido.ocorrencias ||= [];
    pedido.ocorrencias.push(buildOccurrenceEntry({
      conteudo: `Fechamento logístico invalidado após alteração do pedido. Registro anterior: ${closing.quantidadeVolumes} volume(s), ${closing.pesoTotalKg} kg, por ${closing.preenchidoPor?.operadorNome || closing.preenchidoPor?.usuarioNome || "responsável não identificado"}${closing.preenchidoEm ? ` em ${String(closing.preenchidoEm)}` : ""}.`,
      tipo: "informacao_operacional",
      usuario,
      now,
    }));
    pedido.fechamentoLogistico = undefined;
  }

  if (precisaReabrirSeparacao) {
    pedido.status = "separando";
    pedido.historicoStatus ||= [];
    pedido.historicoStatus.push(buildStatusHistoryEntry({
      statusAnterior: previousStatus,
      novoStatus: "separando",
      usuario,
      observacao: "Separação reaberta após alteração administrativa do pedido",
      now,
    }));
  }

  if (commercialOrderChanged) {
    pedido.historicoAlteracoes ||= [];
    pedido.historicoAlteracoes.push({
      alteradoEm: now,
      ...buildOrderEditor(usuario),
      versaoOperacionalAnterior: previousOperationalVersion,
      versaoOperacionalNova: nextOperationalVersion,
      totalAnterior: previousTotal,
      totalNovo: Number(valorTotal),
      itens: changes,
    });

    pedido.ocorrencias ||= [];
    pedido.ocorrencias.push(buildOccurrenceEntry({
      conteudo: `Pedido alterado: ${changes.length} alteração(ões) de item; total de R$ ${previousTotal.toFixed(2)} para R$ ${Number(valorTotal).toFixed(2)}.${physicalOrderChanged ? " Separação e conferência foram reconciliadas com a versão atual." : ""}`,
      tipo: "informacao_operacional",
      usuario,
      now,
    }));
  }

  return {
    changes,
    physicalOrderChanged,
    commercialOrderChanged,
    previousOperationalVersion,
    nextOperationalVersion,
    separationReopened: precisaReabrirSeparacao,
  };
};
