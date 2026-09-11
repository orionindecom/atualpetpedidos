// QA local com API simulada: não acessa banco nem cria pedidos reais.
// PLAYWRIGHT_MODULE pode apontar para o index.mjs de uma instalação existente.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { calcularNecessidadeProducao } from "../../backend/src/utils/necessidadeProducao.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:4173";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname), "A verificação deve usar um servidor local");
const output = process.env.QA_OUTPUT_DIR;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.QA_BROWSER || "msedge", headless: true });
const ids = { a: "000000000000000000000004", b: "000000000000000000000020", produto: "000000000000000000000100", tabelaA: "000000000000000000000050", tabelaB: "000000000000000000000051" };
const clientes = [
  { _id: ids.a, nomeFantasia: "Distribuidor Aurora", razaoSocial: "Aurora Distribuição", cnpj: "12.345.678/0001-90", tabelaPrecoId: { _id: ids.tabelaA, nome: "Tabela Aurora" } },
  { _id: ids.b, nomeFantasia: "Distribuidor Brisa", razaoSocial: "Brisa Distribuição", cnpj: "98.765.432/0001-10", tabelaPrecoId: { _id: ids.tabelaB, nome: "Tabela Brisa" } },
];
const pedidosNaoIniciados = [
  { _id: "p3", numeroPedido: "AP-10092026-0003", status: "aprovado", nomeFantasiaCliente: "Distribuidor aguardando separação", itens: [
    { produtoId: "a", nomeProduto: "Shampoo Neutro 5L", quantidade: 20, quantidadeSeparada: 0 },
  ] },
  { _id: "p4", numeroPedido: "AP-10092026-0004", status: "novo", nomeFantasiaCliente: "Outro distribuidor aguardando separação", itens: [
    { produtoId: "d", nomeProduto: "Produto aguardando separação", quantidade: 30 },
  ] },
];
const necessidade = calcularNecessidadeProducao([
  { _id: "p1", numeroPedido: "AP-10092026-0001", status: "separando", nomeFantasiaCliente: "Distribuidor Aurora", itens: [
    { produtoId: "a", nomeProduto: "Shampoo Neutro 5L", quantidade: 100, quantidadeSeparada: 40 },
    { produtoId: "b", nomeProduto: "Condicionador Hidratação 5L", quantidade: 90, quantidadeSeparada: 0 },
    { produtoId: "c", nomeProduto: "Produto já atendido", quantidade: 10, quantidadeSeparada: 10 },
    { produtoId: "e", nomeProduto: "Produto não processado", quantidade: 20 },
  ] },
  { _id: "p2", numeroPedido: "AP-10092026-0002", status: "separando", nomeFantasiaCliente: "Distribuidor Brisa", itens: [
    { produtoId: "a", nomeProduto: "Shampoo Neutro 5L", quantidade: 100, quantidadeSeparada: 10 },
  ] },
  ...pedidosNaoIniciados,
]);

async function session(role, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  const state = { failDemand: false, emptyDemand: false, failCreate: false, delayCatalogA: false, failList: false };
  page.on("pageerror", (error) => errors.push(error.message));
  const token = `local.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, tipo: role })).toString("base64url")}.local`;
  await context.addInitScript(({ token, role }) => {
    localStorage.setItem("token", token);
    localStorage.setItem("usuario", JSON.stringify({ tipo: role, nomeResponsavel: `QA ${role}` }));
  }, { token, role });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    requests.push({ path: url.pathname, method: request.method(), body: request.postDataJSON() });
    const send = (json, status = 200) => route.fulfill({ status, json });
    if (url.pathname === "/api/logistica/necessidade-producao") {
      if (!["admin", "logistica"].includes(role)) return send({ message: "Acesso negado" }, 403);
      if (state.failDemand) return send({ message: "Falha simulada na consulta" }, 500);
      return send(state.emptyDemand ? calcularNecessidadeProducao(pedidosNaoIniciados) : necessidade);
    }
    if (url.pathname === "/api/pedidos/comercial/distribuidores") return state.failList ? send({ message: "Falha simulada na lista" }, 500) : send(clientes);
    if ((url.pathname.endsWith("/catalogo") && url.pathname.includes("/comercial/")) || url.pathname === "/api/catalogo") {
      const brisa = url.pathname.includes(ids.b);
      if (!brisa && state.delayCatalogA) await new Promise((r) => setTimeout(r, 400));
      const second = url.searchParams.get("pagina") === "2";
      return send({
        produtos: [{ id: second ? "000000000000000000000101" : ids.produto, nome: second ? "Condicionador 5L" : "Shampoo Neutro 5L", descricao: "Linha profissional", preco: brisa ? 25 : 10, linha: "Profissional", categoria: "Higiene" }],
        paginacao: { pagina: second ? 2 : 1, limite: 12, total: 2, totalPaginas: 2, temMais: !second },
        filtros: { linhas: ["Profissional"], categorias: ["Higiene"] },
      });
    }
    if (["/api/pedidos/comercial", "/api/pedidos"].includes(url.pathname) && request.method() === "POST") {
      await new Promise((r) => setTimeout(r, 120));
      if (state.failCreate) return send({ message: "Tabela de preço indisponível" }, 400);
      return send({ pedido: { _id: "pedido-qa", numeroPedido: "AP-QA-0001", status: "aguardando_aprovacao" } }, 201);
    }
    return send(url.pathname.endsWith("/dashboard") ? { metricas: {}, pedidosMaisAntigos: [] } : []);
  });
  const screenshot = async (name) => { if (output) await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: !name.includes("revisao") }); };
  const noOverflow = async () => {
    const result = await page.evaluate(() => {
      const root = document.querySelector("main") || document.querySelector('[class*="container"]');
      return { overflow: root.scrollWidth - root.clientWidth, right: root.getBoundingClientRect().right, viewport: innerWidth };
    });
    assert.ok(result.overflow <= 1 && result.right <= result.viewport + 1, JSON.stringify(result));
  };
  return { context, page, requests, state, errors, screenshot, noOverflow };
}

try {
  for (const role of ["admin", "logistica"]) {
    const { context, page, errors, state, screenshot, noOverflow } = await session(role);
    await page.goto(`${baseURL}/necessidade-producao`);
    await page.getByRole("heading", { name: "Necessidade de Produção" }).waitFor();
    await page.getByRole("region", { name: "Necessidade consolidada por produto" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Shampoo Neutro 5L" }).count(), 1);
    assert.ok((await page.getByRole("region", { name: "Resumo da necessidade" }).innerText()).includes("240"));
    assert.equal(await page.getByText("Produto aguardando separação").count(), 0);
    assert.equal(await page.getByText("Produto não processado").count(), 0);
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 640 : width === 390 ? 844 : 900 });
      await noOverflow();
      if (role === "admin") await screenshot(`necessidade-produtos-${width}`);
      await page.getByRole("button", { name: "Por pedido", exact: true }).click();
      await noOverflow();
      assert.equal(await page.getByText("Produto já atendido").count(), 0);
      assert.equal(await page.getByText("Produto não processado").count(), 0);
      assert.equal(await page.getByText("AP-10092026-0003", { exact: true }).count(), 0);
      assert.equal(await page.getByText("AP-10092026-0004", { exact: true }).count(), 0);
      assert.equal(await page.getByText("Não registrado", { exact: true }).count(), 0);
      if (role === "admin") await screenshot(`necessidade-pedidos-${width}`);
      await page.getByRole("button", { name: "Por produto", exact: true }).click();
    }
    state.failDemand = true;
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await page.getByRole("alert").waitFor();
    state.failDemand = false; state.emptyDemand = true;
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await page.getByText("Nenhuma falta identificada nos pedidos com separação iniciada.").waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("PASS: Admin/Logística, somente faltas de itens processados com separação iniciada, responsividade 1440/1024/390/320, erro e estado vazio com pedidos não iniciados");

  for (const role of ["comercial", "cliente"]) {
    const { context, page, requests } = await session(role);
    await page.goto(`${baseURL}/necessidade-producao`);
    await page.waitForURL(`**/${role === "comercial" ? "precos" : "catalogo"}`);
    assert.equal(requests.filter((request) => request.path.includes("necessidade-producao")).length, 0);
    assert.equal(await page.getByRole("link", { name: "Necessidade de Produção", exact: true }).count(), 0);
    await context.close();
  }
  console.log("PASS: bloqueio frontend e navegação para Comercial/Cliente");

  for (const width of [1440, 1024, 390, 320]) {
    const { context, page, requests, state, errors, screenshot, noOverflow } = await session("comercial", { width, height: width === 320 ? 640 : width === 390 ? 844 : 900 });
    await page.goto(`${baseURL}/pedidos/novo`);
    await page.getByRole("button", { name: "Selecionar Distribuidor Aurora", exact: true }).waitFor();
    await noOverflow();
    await screenshot(`novo-pedido-distribuidores-${width}`);
    await page.getByRole("button", { name: "Selecionar Distribuidor Aurora", exact: true }).click();
    const quantity = page.getByRole("spinbutton", { name: "Quantidade de Shampoo Neutro 5L" });
    await quantity.fill("3");
    await noOverflow();
    await screenshot(`novo-pedido-catalogo-${width}`);
    await page.getByRole("button", { name: "Mostrar mais", exact: true }).click();
    await page.getByRole("spinbutton", { name: "Quantidade de Condicionador 5L" }).waitFor();
    assert.equal(await quantity.inputValue(), "3");
    await page.getByRole("button", { name: "Revisar pedido", exact: true }).first().click();
    const modal = page.getByRole("dialog");
    const bounds = await modal.evaluate((element) => ({ top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom, height: innerHeight }));
    assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.height, JSON.stringify(bounds));
    assert.ok((await modal.innerText()).includes("30,00"));
    state.failCreate = true;
    await modal.getByRole("button", { name: "Finalizar pedido" }).click();
    await modal.getByRole("alert").waitFor();
    const feedbackBounds = await modal.getByRole("alert").evaluate((element) => ({ top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom, height: innerHeight }));
    assert.ok(feedbackBounds.top >= 0 && feedbackBounds.bottom <= feedbackBounds.height, JSON.stringify(feedbackBounds));
    assert.equal(await quantity.inputValue(), "3");
    state.failCreate = false;
    await screenshot(`novo-pedido-revisao-${width}`);
    const before = requests.filter((request) => request.method === "POST").length;
    await modal.getByRole("button", { name: "Finalizar pedido" }).dblclick();
    await page.getByText("Pedido criado!", { exact: true }).waitFor();
    assert.equal(requests.filter((request) => request.method === "POST").length, before + 1);
    let submitted = requests.filter((request) => request.method === "POST").at(-1).body;
    assert.equal(submitted.clienteId, ids.a);
    assert.equal(submitted.tabelaPrecoId, ids.tabelaA);
    assert.equal(submitted.itens[0].quantidade, 3);
    assert.equal(submitted.origem, undefined);
    assert.equal(submitted.itens[0].valorUnitario, undefined);
    await page.getByRole("button", { name: "Trocar distribuidor", exact: true }).click();
    await page.getByRole("button", { name: "Selecionar Distribuidor Brisa", exact: true }).click();
    await quantity.waitFor();
    assert.equal(await quantity.inputValue(), "");
    await quantity.fill("2");
    await page.getByRole("button", { name: "Revisar pedido", exact: true }).first().click();
    assert.ok((await modal.innerText()).includes("50,00"));
    assert.ok((await modal.innerText()).includes("Tabela Brisa"));
    await modal.getByRole("button", { name: "Finalizar pedido" }).click();
    await page.getByText("Pedido criado!", { exact: true }).waitFor();
    submitted = requests.filter((request) => request.method === "POST").at(-1).body;
    assert.equal(submitted.clienteId, ids.b);
    assert.equal(submitted.tabelaPrecoId, ids.tabelaB);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("PASS: seleção, paginação, revisão, erro com itens preservados, submissão única e tabelas distintas nas quatro larguras");

  const { context, page, state } = await session("comercial");
  state.failList = true;
  await page.goto(`${baseURL}/pedidos/novo`);
  await page.getByRole("alert").waitFor();
  state.failList = false; state.delayCatalogA = true;
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await page.getByRole("button", { name: "Selecionar Distribuidor Aurora", exact: true }).click();
  await page.getByRole("button", { name: "Trocar distribuidor", exact: true }).click();
  await page.getByRole("button", { name: "Selecionar Distribuidor Brisa", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Quantidade de Shampoo Neutro 5L" }).fill("2");
  await page.getByRole("button", { name: "Revisar pedido", exact: true }).first().click();
  assert.ok((await page.getByRole("dialog").innerText()).includes("50,00"));
  await context.close();
  console.log("PASS: recuperação da lista e troca de distribuidor durante carregamento");

  const clientSession = await session("cliente", { width: 390, height: 844 });
  await clientSession.page.goto(`${baseURL}/catalogo`);
  await clientSession.page.getByRole("spinbutton", { name: "Quantidade de Shampoo Neutro 5L" }).fill("2");
  await clientSession.page.getByRole("button", { name: "Gerar Pedido", exact: true }).first().click();
  await clientSession.page.getByText("Pedido criado!", { exact: true }).waitFor();
  const clientRequest = clientSession.requests.find((request) => request.method === "POST");
  assert.equal(clientRequest.path, "/api/pedidos");
  assert.equal(clientRequest.body.clienteId, undefined);
  assert.deepEqual(clientSession.errors, []);
  await clientSession.context.close();
  console.log("PASS: fluxo do cliente preservado no catálogo compartilhado");
} finally {
  await browser.close();
}
