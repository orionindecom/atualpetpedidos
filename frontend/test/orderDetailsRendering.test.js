import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { buildOrderOperationsForm, buildOrderOperationsPayload, updateOrderSeparationForm } from "../src/utils/orderOperations.js";
import { formatOrderPickupDate, ORDER_STATUS, formatOrderStatus } from "../src/utils/orderLogistics.js";
import { summarizeOrders } from "../src/pages/ContaDashboard/orderSummary.js";
import { orderStatusTone } from "../src/pages/ContaDashboard/orderStatusTone.js";
import { readFileSync } from "node:fs";

let server;
let OrderItems;
let OrderDetailModal;
let ConferenceItems;
let OrderPickupDetails;
let OrderProgress;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false, watch: null },
    logLevel: "silent",
  });
  OrderItems = (await server.ssrLoadModule("/src/components/OrderDetails/OrderItems.jsx")).default;
  OrderDetailModal = (await server.ssrLoadModule("/src/components/OrderDetails/OrderDetailModal.jsx")).default;
  ConferenceItems = (await server.ssrLoadModule("/src/components/OrderDetails/ConferenceItems.jsx")).default;
  OrderPickupDetails = (await server.ssrLoadModule("/src/components/OrderDetails/OrderPickupDetails.jsx")).default;
  OrderProgress = (await server.ssrLoadModule("/src/components/OrderProgress/OrderProgress.jsx")).default;
});

after(async () => { await server?.close(); });

const item = {
  produtoId: "produto-a", nomeProduto: "Shampoo", quantidade: 3,
  quantidadeSeparada: 3, valorUnitario: 12.34, subtotal: 37.02,
};
const renderItems = (items, props = {}) => renderToStaticMarkup(createElement(OrderItems, { items, ...props }));
const shortage = (html) => html.match(/<span>Faltante<\/span><strong>([^<]*)<\/strong>/)?.[1];

test("Meus Pedidos usa data real da retirada, preservada mesmo com updatedAt posterior", () => {
  const pedido = { status: "retirado", retiradoEm: "2026-10-05T17:30:00Z", updatedAt: "2026-10-06T20:00:00Z" };
  const html = renderToStaticMarkup(createElement(OrderPickupDetails, { pedido }));
  assert.match(html, /Retirado em: 05\/10\/2026 às 14:30/);
  assert.doesNotMatch(html, /06\/10/);
  assert.match(readFileSync(new URL("../src/pages/MeusPedidos/MeusPedidos.jsx", import.meta.url), "utf8"), /<OrderPickupDetails pedido=\{pedido\} \/>/);
  assert.equal(formatOrderPickupDate(null), "-");
  assert.equal(formatOrderPickupDate("invalida"), "-");
  assert.equal(renderToStaticMarkup(createElement(OrderPickupDetails, { pedido: { status: "entregue" } })), "");
});

test("retirado possui badge próprio, opção de filtro e indicador de conclusão", () => {
  assert.ok(ORDER_STATUS.includes("retirado"));
  assert.equal(formatOrderStatus("retirado"), "Retirado pelo distribuidor");
  assert.equal(orderStatusTone("retirado"), "retirado");
  const summary = summarizeOrders([{ status: "retirado" }, { status: "enviado" }, { status: "entregue" }]);
  assert.equal(summary.concluidos, 2);
  assert.equal(summary.emAndamento, 0);
  assert.equal(summary.aguardandoRecebimento, 1);
  const html = renderToStaticMarkup(createElement(OrderProgress, { status: "retirado" }));
  assert.match(html, /Retirado pelo distribuidor/);
  assert.doesNotMatch(html, /Enviado|Faturado|Entregue/);
});

test("ações de saída ficam disponíveis apenas ao Admin antes do encerramento", () => {
  const props = { onMarkShipped() {}, onMarkCollected() {} };
  for (const isAdmin of [false, true]) {
    const detail = { status: "separado", itens: [item] };
    const html = renderToStaticMarkup(createElement(OrderDetailModal, { detail, form: buildOrderOperationsForm(detail), isAdmin, ...props }));
    assert.equal(html.includes("Marcar como enviado"), isAdmin);
    assert.equal(html.includes("Retirado pelo distribuidor"), isAdmin);
  }
  for (const status of ["retirado", "entregue", "cancelado"]) {
    const detail = { status, itens: [item], retiradoEm: "2026-10-05T17:30:00Z" };
    const html = renderToStaticMarkup(createElement(OrderDetailModal, { detail, form: buildOrderOperationsForm(detail), isAdmin: true, ...props }));
    assert.doesNotMatch(html, /Marcar como enviado|onSubmit|Excluir<|Editar pedido/);
    if (status === "retirado") assert.match(html, /05\/10\/2026 às 14:30/);
  }
});

test("barra de ações administrativa ocupa a área rolável e não disputa largura com o título", () => {
  const detail = { status: "separado", numeroPedido: "AP-05102026-000123", itens: [item] };
  const html = renderToStaticMarkup(createElement(OrderDetailModal, {
    detail, form: buildOrderOperationsForm(detail), isAdmin: true,
    onMarkShipped() {}, onMarkCollected() {},
  }));
  const header = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)?.[1];
  assert.ok(header);
  assert.match(header, /AP-05102026-000123/);
  assert.match(header, /Fechar detalhes do pedido/);
  assert.equal((header.match(/<button\b/g) || []).length, 1);
  for (const action of ["Marcar como enviado", "Retirado pelo distribuidor", "Editar pedido", "PDF comercial", "PDF de separação", "Relatório operacional", "Excluir"]) {
    assert.equal(header.includes(action), false, action);
    assert.ok(html.slice(html.indexOf("</header>")).includes(action), action);
  }
  assert.match(html, /modalContent[^>]*>\s*<div class="[^"]*modalHeaderActions/);
});

test("faturar pedido legado não reenvia quantidades de uma separação já encerrada", () => {
  const detail = { status: "separado", itens: [item], __v: 3 };
  const form = buildOrderOperationsForm(detail);
  form.status = "faturado";
  form.numeroNotaFiscal = "NF-1234";
  form.dataFaturamento = "2026-10-05";
  const payload = buildOrderOperationsPayload(detail, form);
  assert.equal(payload.separacaoItens, undefined);
  assert.equal(payload.numeroNotaFiscal, "NF-1234");
  assert.equal(payload.dataFaturamento, "2026-10-05");
  assert.equal(payload.status, "faturado");
  assert.equal(payload.versaoPedido, 3);
});

test("Logística não recebe preços no detalhe em nenhuma etapa do pedido", () => {
  for (const status of ["aprovado", "separando", "separado", "faturado", "enviado", "entregue", "cancelado"]) {
    const detail = { status, itens: [item], valorTotal: 37.02 };
    const html = renderToStaticMarkup(createElement(OrderDetailModal, {
      detail, form: buildOrderOperationsForm(detail),
    }));
    assert.equal(html.includes("R$"), false, status);
    assert.equal(html.includes("Shampoo"), true);
  }
});

test("Admin mantém os preços no detalhe compartilhado", () => {
  const detail = { status: "separando", itens: [item], valorTotal: 37.02 };
  const html = renderToStaticMarkup(createElement(OrderDetailModal, {
    detail, form: buildOrderOperationsForm(detail), isAdmin: true,
  }));
  assert.ok(html.includes("12,34"));
  assert.ok(html.includes("37,02"));
});

test("Comercial mantém os preços quando autorizado pela tela de gestão", () => {
  const detail = { status: "aprovado", itens: [item], valorTotal: 37.02 };
  const html = renderToStaticMarkup(createElement(OrderDetailModal, {
    detail, form: buildOrderOperationsForm(detail), canOperate: false, showPrices: true,
  }));
  assert.ok(html.includes("12,34"));
  assert.ok(html.includes("37,02"));
});

test("faltante zero é explícito na leitura e durante a edição", () => {
  assert.equal(shortage(renderItems([item])), "0");
  assert.equal(shortage(renderItems([item], { editable: true })), "0");
  for (const value of [3, "3"]) {
    assert.equal(shortage(renderItems([item], { editable: true, separation: { "produto-a": value } })), "0");
  }
  assert.equal(shortage(renderItems([{ ...item, quantidade: 0, quantidadeSeparada: undefined }])), "0");
});

test("item adicionado calcula faltante mesmo antes de preencher a separação", () => {
  for (const quantidadeSeparada of [undefined, null, "", 0, "0"]) {
    const added = { ...item, quantidadeSeparada };
    const detail = { status: "separando", itens: [added] };
    assert.equal(shortage(renderItems(detail.itens, {
      editable: true, separation: buildOrderOperationsForm(detail).separacao,
    })), "3", String(quantidadeSeparada));
  }
});

test("faltante acompanha imediatamente as quantidades atuais sem usar valor derivado antigo", () => {
  const stale = { ...item, quantidadeFaltante: 99, quantidadeFaltanteSeparacao: 99 };
  for (const [quantidade, separado, expected] of [[3, "1", "2"], [3, "3", "0"], [5, "3", "2"], [5, "5", "0"], [5, "0", "5"]]) {
    assert.equal(shortage(renderItems([{ ...stale, quantidade }], {
      editable: true, separation: { "produto-a": separado },
    })), expected);
  }
});

test("conferência recalcula faltante pelas quantidades atuais inclusive quando é zero", () => {
  for (const [quantidade, expected] of [[3, "0"], [5, "2"]]) {
    const html = renderToStaticMarkup(createElement(ConferenceItems, {
      items: [{ ...item, quantidade, quantidadeSolicitada: 99, quantidadeFaltanteSeparacao: 99 }],
    }));
    assert.equal(shortage(html), expected);
  }
});

test("novo item inicia com separado 0 e faltante 10, sem registrar indisponibilidade ao salvar outro item", () => {
  const added = { ...item, produtoId: "produto-b", quantidade: 10, quantidadeSeparada: 0,
    situacaoSeparacao: "pendente", quantidadeFaltante: 0, quantidadeFaltanteSeparacao: 0 };
  const detail = { status: "separando", itens: [item, added] };
  let form = buildOrderOperationsForm(detail);
  assert.equal(form.separacao["produto-b"], 0);
  assert.deepEqual(buildOrderOperationsPayload(detail, form).separacaoItens, [{
    produtoId: item.produtoId, quantidadeSeparada: 3,
  }]);
  const html = renderItems([added], { editable: true, separation: form.separacao, editedSeparation: form.separacaoEditada });
  assert.equal(shortage(html), "10");
  assert.match(html, /Aguardando separação/);
  for (const [separado, faltante] of [["0", "10"], ["3", "7"], ["10", "0"]]) {
    form = updateOrderSeparationForm(form, "produto-b", separado);
    assert.equal(shortage(renderItems([added], {
      editable: true, separation: form.separacao, editedSeparation: form.separacaoEditada,
    })), faltante);
    const payload = buildOrderOperationsPayload(detail, form);
    assert.equal(payload.separacaoItens.find((entry) => entry.produtoId === "produto-b").quantidadeSeparada, Number(separado));
  }
});
