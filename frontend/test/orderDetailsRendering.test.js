import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { buildOrderOperationsForm, buildOrderOperationsPayload, updateOrderSeparationForm } from "../src/utils/orderOperations.js";

let server;
let OrderItems;
let OrderDetailModal;
let ConferenceItems;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false, watch: null },
    logLevel: "silent",
  });
  OrderItems = (await server.ssrLoadModule("/src/components/OrderDetails/OrderItems.jsx")).default;
  OrderDetailModal = (await server.ssrLoadModule("/src/components/OrderDetails/OrderDetailModal.jsx")).default;
  ConferenceItems = (await server.ssrLoadModule("/src/components/OrderDetails/ConferenceItems.jsx")).default;
});

after(async () => { await server?.close(); });

const item = {
  produtoId: "produto-a", nomeProduto: "Shampoo", quantidade: 3,
  quantidadeSeparada: 3, valorUnitario: 12.34, subtotal: 37.02,
};
const renderItems = (items, props = {}) => renderToStaticMarkup(createElement(OrderItems, { items, ...props }));
const shortage = (html) => html.match(/<span>Faltante<\/span><strong>([^<]*)<\/strong>/)?.[1];

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
