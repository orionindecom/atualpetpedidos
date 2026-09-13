// QA local: intercepta todas as APIs e usa pedidos em memória, sem banco ou rede externa.
// Execute após o build. PLAYWRIGHT_MODULE aceita o index.mjs de uma instalação existente.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { preview } from "vite";
import { applyAdminOrderEdit } from "../../backend/src/utils/pedidoEdicaoAdmin.js";
import { enrichInternalOrderDetail, transicoesPermitidasParaPedido } from "../../backend/src/utils/pedidoLogistica.js";
import { sanitizeLogisticsOrder } from "../../backend/src/utils/pedidoLogisticaView.js";
import { applyLogisticsOrderUpdate } from "../../backend/src/controllers/logisticaController.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const server = await preview({
  root: fileURLToPath(new URL("..", import.meta.url)),
  preview: { host: "127.0.0.1", port: 0 }, logLevel: "silent",
});
const baseURL = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ channel: process.env.QA_BROWSER || "msedge", headless: true });
const output = process.env.QA_OUTPUT_DIR;
if (output) await mkdir(output, { recursive: true });
const id = (n) => n.toString(16).padStart(24, "0");
const products = [
  { _id: id(100), nome: "Shampoo QA", valor: 12.34 },
  { _id: id(101), nome: "Condicionador QA", valor: 10 },
];
const operator = { _id: id(300), nome: "Operador QA" };

async function session(role, { includeNewItem = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  const pedido = {
    _id: id(200), __v: 0, numeroPedido: "AP-QA-DETALHE", status: "separando", versaoOperacional: 1,
    clienteId: id(4), nomeFantasiaCliente: "Distribuidor QA", tabelaPrecoId: id(50), valorTotal: 61.70,
    dia: 13, mes: 9, ano: 2026, createdAt: new Date("2026-09-13T12:00:00Z"),
    itens: [{ produtoId: id(100), nomeProduto: "Shampoo QA", quantidade: 5, quantidadeSeparada: 3, valorUnitario: 12.34, subtotal: 61.70 }],
  };
  if (includeNewItem) {
    applyAdminOrderEdit({
      pedido,
      itensPedido: [...pedido.itens, { produtoId: id(101), nomeProduto: "Condicionador QA", quantidade: 10, valorUnitario: 10, subtotal: 100 }],
      valorTotal: 161.70,
      usuario: { _id: id(1), tipo: "admin", nomeResponsavel: "Admin QA" },
    });
  }
  const user = { _id: id(1), tipo: role, nomeResponsavel: `QA ${role}` };
  const token = `qa.${Buffer.from(JSON.stringify({ tipo: role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.qa`;
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem("token", token);
    localStorage.setItem("usuario", JSON.stringify(user));
  }, { token, user });
  const view = () => role === "logistica" ? sanitizeLogisticsOrder(pedido) : enrichInternalOrderDetail(pedido);
  const detail = () => ({ pedido: view(), transicoesPermitidas: transicoesPermitidasParaPedido(pedido, { admin: role === "admin" }) });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) {
      return url.origin === baseURL ? route.continue() : route.abort();
    }
    requests.push({ path: url.pathname, method: request.method() });
    const send = (json, status = 200) => route.fulfill({ status, json, headers: {
      "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*",
    } });
    if (request.method() === "OPTIONS") return send({});
    if (url.pathname === "/api/logistica/dashboard") return send({ metricas: {}, pedidosMaisAntigos: [] });
    if (url.pathname === "/api/produtos") return send(products);
    if (url.pathname === "/api/tabelas") return send([]);
    if (url.pathname === "/api/pedidos") return send([view()]);
    if (url.pathname === "/api/logistica/operadores") return send([operator]);
    if (url.pathname.endsWith("/identificar")) return send({ contextoOperacional: "contexto-qa-local", operador: operator });
    if (url.pathname === "/api/logistica/pedidos") return send({
      pedidos: [{ _id: pedido._id, numeroPedido: pedido.numeroPedido, nomeFantasiaCliente: pedido.nomeFantasiaCliente,
        status: pedido.status, createdAt: pedido.createdAt, quantidadeItens: pedido.itens.length }],
      paginacao: { paginaAtual: 1, totalPaginas: 1, totalItens: 1 },
    });
    if (url.pathname === `/api/pedidos/${pedido._id}` && request.method() === "PUT") {
      const body = request.postDataJSON();
      assert.equal(body.versaoPedido, pedido.__v);
      const items = body.itens.map((item) => {
        const product = products.find((product) => product._id === item.produtoId);
        return { ...item, nomeProduto: product.nome, valorUnitario: product.valor, subtotal: product.valor * item.quantidade };
      });
      applyAdminOrderEdit({ pedido, itensPedido: items, valorTotal: items.reduce((total, item) => total + item.subtotal, 0), usuario: user });
      pedido.__v += 1;
      return send({ pedido: view() });
    }
    if (url.pathname.endsWith("/aprovacao")) return send(view());
    if (url.pathname === `/api/logistica/pedidos/${pedido._id}`) {
      if (request.method() === "PATCH") {
        const body = request.postDataJSON();
        assert.equal(body.versaoPedido, pedido.__v);
        const result = applyLogisticsOrderUpdate({ pedido, data: { status: body.status },
          separacaoItens: body.separacaoItens, usuario: user, operador: role === "logistica" ? operator : undefined });
        assert.equal(result.valid, true, result.message);
        pedido.__v += 1;
      }
      return send(request.method() === "PATCH" ? { ...detail(), message: "Dados logísticos atualizados" } : detail());
    }
    throw new Error(`API não prevista no teste: ${request.method()} ${url.pathname}`);
  });
  const open = async () => {
    await page.getByRole("button", { name: role === "logistica" ? "Abrir pedido" : "Visualizar pedido" }).click();
    if (role === "logistica") {
      await page.getByLabel("PIN do operador").fill("1234");
      await page.getByRole("button", { name: "Continuar", exact: true }).click();
    }
    await page.getByRole("dialog", { name: pedido.numeroPedido }).waitFor();
  };
  const shortage = (name) => page.getByRole("dialog", { name: pedido.numeroPedido })
    .locator('div[class*="itemRow"]').filter({ has: page.getByText(name, { exact: true }) })
    .getByText("Faltante", { exact: true }).locator("..").locator("strong");
  const expectShortage = async (name, value) => {
    await shortage(name).getByText(String(value), { exact: true }).waitFor();
    assert.equal(await shortage(name).innerText(), String(value));
  };
  await page.goto(`${baseURL}/${role === "logistica" ? "logistica/pedidos" : "pedidos"}`);
  await open();
  return { context, page, pedido, requests, errors, open, expectShortage };
}

try {
  for (const role of ["admin", "comercial"]) {
    const qa = await session(role);
    const { page, requests, expectShortage } = qa;
    await expectShortage("Shampoo QA", 2);
    assert.ok((await page.getByRole("dialog").innerText()).includes("R$"));
    if (role === "admin") {
      for (const [value, missing] of [["5", 0], ["0", 5], ["3", 2]]) {
        await page.getByLabel("Quantidade separada de Shampoo QA").fill(value);
        await expectShortage("Shampoo QA", missing);
      }
      assert.equal(requests.filter((request) => request.method === "PATCH").length, 0);
    }
    const listReads = requests.filter((request) => request.path === "/api/pedidos").length;
    await page.getByRole("button", { name: "Editar pedido", exact: true }).click();
    await page.getByLabel("Quantidade de Shampoo QA").fill("3");
    await page.getByLabel("Quantidade de Condicionador QA").fill("10");
    await page.getByRole("button", { name: "Salvar Alterações" }).click();
    await page.getByRole("dialog", { name: "Editar Pedido", exact: true }).waitFor({ state: "hidden" });
    assert.equal(requests.filter((request) => request.path === "/api/pedidos").length, listReads);
    assert.ok((await page.locator("main, #root").last().innerText()).includes("137,02"));
    await qa.open();
    await expectShortage("Shampoo QA", 0);
    await expectShortage("Condicionador QA", 10);
    if (role === "admin") {
      assert.equal(await page.getByLabel("Quantidade separada de Condicionador QA").inputValue(), "0");
      await page.getByLabel("Atualização do fluxo").selectOption("separado");
      await page.getByLabel("Atualização do fluxo").selectOption("separando");
      await expectShortage("Condicionador QA", 10);
      assert.equal(await page.getByLabel("Quantidade separada de Condicionador QA").inputValue(), "0");
      await page.getByLabel("Quantidade separada de Condicionador QA").fill("");
      await page.getByLabel("Atualização do fluxo").selectOption("separado");
      await page.getByLabel("Atualização do fluxo").selectOption("separando");
      await expectShortage("Condicionador QA", 10);
      assert.equal(await page.getByLabel("Quantidade separada de Condicionador QA").inputValue(), "");
      await page.getByLabel("Quantidade separada de Condicionador QA").fill("3");
      await expectShortage("Condicionador QA", 7);
      await page.getByLabel("Quantidade separada de Condicionador QA").fill("10");
      await expectShortage("Condicionador QA", 0);
      await page.getByRole("button", { name: "Salvar atualização", exact: true }).click();
      await page.getByText("Dados logísticos atualizados", { exact: true }).waitFor();
      await expectShortage("Condicionador QA", 0);
    }
    assert.deepEqual(qa.errors, []);
    await qa.context.close();
    console.log(`PASS: ${role}, inclusão de 10 unidades começa com faltante 10 e atualiza sem recarregar a página`);
  }

  const qa = await session("logistica", { includeNewItem: true });
  await qa.expectShortage("Condicionador QA", 10);
  assert.equal(await qa.page.getByLabel("Quantidade separada de Condicionador QA").inputValue(), "0");
  await qa.page.getByLabel("Quantidade separada de Condicionador QA").fill("");
  await qa.page.getByLabel("Atualização do fluxo").selectOption("separado");
  await qa.page.getByLabel("Atualização do fluxo").selectOption("separando");
  await qa.expectShortage("Condicionador QA", 10);
  assert.equal(await qa.page.getByLabel("Quantidade separada de Condicionador QA").inputValue(), "");
  for (const [value, missing] of [["0", 10], ["3", 7], ["10", 0]]) {
    await qa.page.getByLabel("Quantidade separada de Condicionador QA").fill(value);
    await qa.expectShortage("Condicionador QA", missing);
  }
  for (const [value, missing] of [["5", 0], ["0", 5], ["3", 2]]) {
    await qa.page.getByLabel("Quantidade separada de Shampoo QA").fill(value);
    await qa.expectShortage("Shampoo QA", missing);
  }
  for (const width of [1440, 390, 320]) {
    await qa.page.setViewportSize({ width, height: 950 });
    const dialog = qa.page.getByRole("dialog", { name: qa.pedido.numeroPedido });
    await qa.page.getByLabel("Quantidade separada de Shampoo QA").scrollIntoViewIfNeeded();
    assert.doesNotMatch(await dialog.innerText(), /R\$|12,34|61,70|PDF comercial|Relatório operacional/);
    assert.ok(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1));
    if (output) await qa.page.screenshot({ path: resolve(output, `logistica-detalhe-${width}.png`) });
  }
  await qa.page.getByLabel("Quantidade separada de Shampoo QA").fill("5");
  await qa.page.getByRole("button", { name: "Salvar atualização", exact: true }).click();
  await qa.page.getByText("Dados logísticos atualizados", { exact: true }).waitFor();
  await qa.expectShortage("Shampoo QA", 0);
  assert.deepEqual(qa.errors, []);
  await qa.context.close();
  console.log("PASS: Logística sem valores; novo item 10/0/10, 10/3/7, 10/10/0; status não preenche separação; layout em 1440/390/320px");
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
