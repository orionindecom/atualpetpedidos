import { enrichOrderSeparation } from "./pedidoLogistica.js";
import { buildOrderAuditTimeline } from "./pedidoAuditoria.js";

const OPERATIONAL_FIELDS = [
  "_id", "__v", "numeroPedido", "clienteId", "nomeResponsavel", "origem", "criadoPor",
  "nomeFantasiaCliente", "razaoSocialCliente", "cnpjCliente", "emailCliente",
  "telefoneCliente", "whatsappCliente", "dataPedido", "dia", "mes", "ano",
  "createdAt", "updatedAt", "status", "itens", "aprovacao", "versaoOperacional",
  "conferenciaObrigatoria", "conferencia", "historicoConferencias", "historicoAlteracoes",
  "fechamentoLogisticoObrigatorio", "fechamentoLogistico", "observacao", "observacaoLogistica",
  "numeroNotaFiscal", "dataFaturamento", "transportadora", "codigoRastreio", "linkRastreio",
  "dataEnvio", "dataEntrega", "retiradoEm", "retiradoPor", "historicoStatus", "ocorrencias", "temDivergencia",
  "temItemNaoProcessado", "entregaFinalizada",
];

// Também elimina valores em snapshots aninhados e em ocorrências antigas de edição.
const withoutFinancialData = (value) => {
  if (typeof value === "string") {
    return value
      .replace(/(?:Total:|; total de)\s*R\$\s*[\d.,]+\s*(?:->|para)\s*R\$\s*[\d.,]+(?=\.\s|\.$|$)/g, "")
      .replace(/^\.\s*/, "")
      .replace(/R\$\s*-?\s*\d+(?:[.,]\d+)*/g, "[restrito]");
  }
  if (Array.isArray(value)) {
    return value.filter((entry) => entry?.tipo !== "preco_alterado").map(withoutFinancialData);
  }
  // Datas e ObjectIds mantêm sua serialização original.
  if (value?.constructor !== Object) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/^(valor|preco|subtotal|totalAnterior$|totalNovo$|tabelaPrecoId$|nomeTabela$)/i.test(key))
    .map(([key, entry]) => [key, withoutFinancialData(entry)]));
};

export const sanitizeLogisticsOrder = (pedido) => {
  const enriched = enrichOrderSeparation(pedido);
  const source = withoutFinancialData(Object.fromEntries(OPERATIONAL_FIELDS
    .filter((field) => Object.hasOwn(enriched, field))
    .map((field) => [field, enriched[field]])));

  return {
    ...source,
    historicoPedido: buildOrderAuditTimeline(source, { showPrices: false }),
  };
};
