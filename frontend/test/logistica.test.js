import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatOrderStatus,
  getOrderProgress,
  ORDER_PROGRESS_STEPS,
} from "../src/utils/orderLogistics.js";

const readSource = (relativePath) => (
  readFileSync(new URL(relativePath, import.meta.url), "utf8")
);

test("rotas, guard e login direcionam logistica ao painel proprio", () => {
  const app = readSource("../src/App.jsx");
  const guards = readSource("../src/components/RouteGuards/RouteGuards.jsx");
  const login = readSource("../src/pages/Login/Login.jsx");
  assert.match(app, /path="\/logistica"[\s\S]*?<RoleRoute role="logistica">/);
  assert.match(app, /path="\/logistica\/pedidos"[\s\S]*?<RoleRoute role="logistica">/);
  assert.match(guards, /logistica: "\/logistica"/);
  assert.match(guards, /logistica: "\/logistica\/dashboard"/);
  assert.match(login, /logistica: "\/logistica"/);
});

test("menu de logistica contem apenas Dashboard e Pedidos", () => {
  const navbar = readSource("../src/components/Navbar/Navbar.jsx");
  const block = navbar.match(/const logisticaLinks = \[([\s\S]*?)\];/)?.[1] || "";
  assert.match(block, /\/logistica/);
  assert.match(block, /\/logistica\/pedidos/);
  assert.doesNotMatch(block, /\/clientes|\/produtos|\/precos|\/tabelas|\/marketing/);
});

test("pagina de logistica usa endpoints dedicados e paginacao", () => {
  const page = readSource("../src/pages/LogisticaPedidos/LogisticaPedidos.jsx");
  assert.match(page, /api\.get\("\/logistica\/pedidos"/);
  assert.match(page, /api\.patch\(`\/logistica\/pedidos\/\$\{detail\._id\}`/);
  assert.match(page, /<PaginationControls/);
  assert.match(page, /aguardandoAcao/);
});

test("tela logistica mantem itens e valores somente leitura", () => {
  const page = readSource("../src/pages/LogisticaPedidos/LogisticaPedidos.jsx");
  assert.match(page, /detail\.itens\.map/);
  assert.match(page, /formatCurrency\(item\.valorUnitario\)/);
  assert.doesNotMatch(page, /updateField\("itens"/);
  assert.doesNotMatch(page, /updateField\("valorTotal"/);
  assert.doesNotMatch(page, /updateField\("cliente/);
});

test("distribuidor visualiza tracking sem campos internos", () => {
  const page = readSource("../src/pages/MeusPedidos/MeusPedidos.jsx");
  assert.match(page, /<OrderProgress status=\{pedido\.status\}/);
  assert.match(page, /pedido\.numeroNotaFiscal/);
  assert.match(page, /pedido\.transportadora/);
  assert.match(page, /pedido\.codigoRastreio/);
  assert.match(page, /pedido\.dataEnvio/);
  assert.match(page, /pedido\.dataEntrega/);
  assert.doesNotMatch(page, /observacaoLogistica|historicoStatus|usuarioNome|usuarioTipo/);
});

test("cliente confirma recebimento somente quando o pedido esta enviado", () => {
  const page = readSource("../src/pages/MeusPedidos/MeusPedidos.jsx");
  assert.match(page, /pedido\.status === "enviado"/);
  assert.match(page, /Confirma que este pedido foi recebido\?/);
  assert.match(page, /api\.patch\(`\/pedidos\/\$\{pedido\._id\}\/confirmar-recebimento`\)/);
  assert.match(page, /Confirmar recebimento/);
  assert.match(page, /setPedidos/);
  assert.match(page, /formatOrderDateTime\(pedido\.dataEntrega/);
});

test("logistica consulta entrega sem conseguir edita-la", () => {
  const page = readSource("../src/pages/LogisticaPedidos/LogisticaPedidos.jsx");
  assert.match(page, /formatOrderDateTime\(detail\.dataEntrega, "Ainda não confirmada"\)/);
  assert.doesNotMatch(page, /updateField\("dataEntrega"/);
  assert.doesNotMatch(page, /dataEntrega: toDateInput/);
});

test("logistica baixa PDF operacional pelo endpoint dedicado", () => {
  const page = readSource("../src/pages/LogisticaPedidos/LogisticaPedidos.jsx");
  const pdfUtils = readSource("../src/utils/pdfPedido.js");
  assert.match(page, /Baixar PDF de separação/);
  assert.match(page, /abrirOuBaixarPdfSeparacao/);
  assert.match(pdfUtils, /\/logistica\/pedidos\/\$\{pedidoId\}\/pdf-separacao/);
  assert.match(pdfUtils, /responseType: "blob"/);
});

test("timeline representa fluxo e cancelamento", () => {
  assert.deepEqual(ORDER_PROGRESS_STEPS, [
    "novo",
    "separando",
    "separado",
    "faturado",
    "enviado",
    "entregue",
  ]);
  assert.equal(formatOrderStatus("novo"), "Pedido recebido");
  assert.deepEqual(getOrderProgress("em_analise"), {
    canceled: false,
    currentIndex: 0,
  });
  assert.deepEqual(getOrderProgress("cancelado"), {
    canceled: true,
    currentIndex: -1,
  });
});
