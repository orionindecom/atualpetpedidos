// Regressão visual local com Playwright/Edge e API simulada. Sem dados externos.
// Execute após o build; QA_REPRO_ONLY=1 executa somente a reprodução mínima.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { preview } from "vite";
import { enrichInternalOrderDetail, sanitizeClientOrder, transicoesPermitidasParaPedido } from "../../backend/src/utils/pedidoLogistica.js";
import { validateLogisticsOrderPayload } from "../../backend/src/utils/pedidoLogistica.js";
import { applyLogisticsOrderUpdate } from "../../backend/src/controllers/logisticaController.js";
import { testEditMobile } from "./verificarEdicaoPedidoMobileUI.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const output = process.env.QA_OUTPUT_DIR;
if (output) await mkdir(output, { recursive: true });
const server = await preview({ root: fileURLToPath(new URL("..", import.meta.url)), preview: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
const baseURL = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ channel: process.env.QA_BROWSER || "msedge", headless: true });
const id = (n) => n.toString(16).padStart(24, "0");
const results = [];

const makeOrder = (status) => ({
  _id: id(200), __v: 0, numeroPedido: "AP-05102026-000123", status, versaoOperacional: 1,
  clienteId: id(4), nomeFantasiaCliente: "Distribuidor de produtos profissionais AtualPet", tabelaPrecoId: id(50), valorTotal: 240,
  dia: 5, mes: 10, ano: 2026, createdAt: "2026-10-05T12:00:00Z",
  itens: Array.from({ length: 12 }, (_, i) => ({ produtoId: id(100 + i), nomeProduto: `Produto profissional QA ${i + 1}`, quantidade: 5,
    quantidadeSeparada: ["separando", "aprovado", "aguardando_aprovacao"].includes(status) ? 0 : 5, valorUnitario: 4, subtotal: 20 })),
  historicoStatus: [], historicoPedido: [],
  ...(status === "retirado" ? { retiradoEm: "2026-10-05T17:30:00Z", retiradoPor: { usuarioId: id(1), usuarioNome: "Admin QA", usuarioTipo: "admin" } } : {}),
});

async function session(role, status, viewport, extraOrder = {}, catalog, contextOptions = {}) {
  const context = await browser.newContext({ viewport, ...contextOptions });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  const requests = [];
  let deleted = false;
  page.on("pageerror", (error) => errors.push(error.message));
  const pedido = { ...makeOrder(status), ...extraOrder };
  const user = { _id: id(1), tipo: role, nomeResponsavel: `QA ${role}` };
  const token = `qa.${Buffer.from(JSON.stringify({ tipo: role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.qa`;
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem("token", token); localStorage.setItem("usuario", JSON.stringify(user));
    window.open = () => null; // PDFs passam pelo download, também no desktop.
  }, { token, user });
  const view = () => enrichInternalOrderDetail(pedido);
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return url.origin === baseURL || url.protocol === "blob:" ? route.continue() : route.abort();
    requests.push({ path: url.pathname, method: request.method(), body: request.postDataJSON() });
    const send = (json) => route.fulfill({ json, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
    if (request.method() === "OPTIONS") return send({});
    if (url.pathname === "/api/auth/me") return send({ usuario: user });
    if (/\/(?:pdf|pdf-separacao|relatorio)$/.test(url.pathname)) return route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4\n%%EOF" });
    if (url.pathname === "/api/pedidos") return send(deleted ? [] : [view()]);
    if (url.pathname === "/api/produtos") return send(catalog || pedido.itens.map((item) => ({ _id: item.produtoId, nome: item.nomeProduto })));
    if (url.pathname === "/api/pedidos/meus") return send([sanitizeClientOrder(pedido)]);
    if (url.pathname === `/api/pedidos/${pedido._id}/aprovacao`) return send(view());
    if (url.pathname === `/api/pedidos/${pedido._id}` && request.method() === "DELETE") { deleted = true; return send({ message: "Pedido excluído" }); }
    if (url.pathname === `/api/pedidos/${pedido._id}` && request.method() === "PUT") {
      pedido.itens = request.postDataJSON().itens.map((item) => ({ ...item, nomeProduto: catalog?.find((produto) => produto._id === item.produtoId)?.nome || "Produto QA", quantidadeSeparada: 0, valorUnitario: 4, subtotal: item.quantidade * 4 }));
      pedido.__v += 1;
      return send({ pedido: view() });
    }
    if (url.pathname.endsWith("/aprovar") && request.method() === "PATCH") pedido.status = "aprovado";
    if (url.pathname.endsWith("/marcar-enviado") && request.method() === "PATCH") pedido.status = "enviado";
    if (url.pathname.endsWith("/retirar") && request.method() === "PATCH") {
      pedido.status = "retirado"; pedido.retiradoEm = new Date().toISOString(); pedido.retiradoPor = { usuarioId: user._id, usuarioNome: user.nomeResponsavel, usuarioTipo: role };
    }
    if (url.pathname.endsWith("/confirmar-recebimento")) { pedido.status = "entregue"; pedido.dataEntrega = new Date().toISOString(); return send({ pedido: sanitizeClientOrder(pedido) }); }
    if (url.pathname === `/api/logistica/pedidos/${pedido._id}` && request.method() === "PATCH") {
      const parsed = validateLogisticsOrderPayload(request.postDataJSON());
      assert.equal(parsed.valid, true, JSON.stringify(parsed.errors));
      const result = applyLogisticsOrderUpdate({ pedido, ...parsed, usuario: user });
      assert.equal(result.valid, true, result.message);
      pedido.__v += 1;
    }
    if (url.pathname.includes(`/pedidos/${pedido._id}`) && request.method() === "PATCH") return send({ pedido: view(), transicoesPermitidas: transicoesPermitidasParaPedido(pedido, { admin: role === "admin" }), message: "Pedido atualizado no teste" });
    if (url.pathname === `/api/logistica/pedidos/${pedido._id}`) return send({ pedido: view(), transicoesPermitidas: transicoesPermitidasParaPedido(pedido, { admin: role === "admin" }) });
    return send({});
  });
  const open = async () => {
    await page.getByRole("button", { name: "Visualizar pedido", exact: true }).click();
    await page.getByRole("dialog", { name: pedido.numeroPedido }).waitFor();
  };
  await page.goto(`${baseURL}/${role === "cliente" ? "meus-pedidos" : "pedidos"}`);
  if (role !== "cliente") await open();
  return { context, page, pedido, errors, requests, open };
}

async function checkLayout(qa, label) {
  const { page, pedido } = qa;
  const dialog = page.getByRole("dialog", { name: pedido.numeroPedido });
  await dialog.locator('[class*="modalContent"]').evaluate((element) => { element.scrollTop = 0; });
  const metrics = await dialog.evaluate((element) => {
    const title = element.querySelector('[class*="modalTitle"]');
    const heading = title.querySelector("h2");
    const header = element.querySelector("header");
    const content = element.querySelector('[class*="modalContent"]');
    const actions = element.querySelector('[class*="modalHeaderActions"]');
    const rect = element.getBoundingClientRect();
    return { titleWidth: title.clientWidth, titleHeight: heading.clientHeight, lineHeight: parseFloat(getComputedStyle(heading).lineHeight),
      headerHeight: header.clientHeight, contentHeight: content.clientHeight, contentScrollHeight: content.scrollHeight,
      actionsWidth: actions.clientWidth, modalHeight: rect.height, modalWidth: rect.width,
      left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight,
      horizontalOverflow: element.scrollWidth - element.clientWidth };
  });
  results.push({ label, ...metrics });
  console.log(`${label}: ${JSON.stringify(metrics)}`);
  if (output) await page.screenshot({ path: resolve(output, `${label}.png`) });
  assert.ok(metrics.titleWidth >= Math.min(260, metrics.modalWidth * 0.55), `Informações comprimidas: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.titleHeight < 80, "Número do pedido quebrado verticalmente");
  assert.ok(metrics.contentHeight >= Math.min(220, metrics.viewportHeight * 0.4), `Conteúdo sem área útil de rolagem: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.left >= -1 && metrics.right <= metrics.viewportWidth + 1 && metrics.top >= -1 && metrics.bottom <= metrics.viewportHeight + 1, "Modal fora da viewport");
  assert.ok(metrics.horizontalOverflow <= 1, "Overflow horizontal no modal");
  assert.ok(await dialog.locator("header").getByRole("button").count() === 1, "Ações administrativas não devem disputar espaço no cabeçalho");
  assert.ok(await dialog.locator('[class*="modalContent"] [class*="modalHeaderActions"]').count() === 1, "Ações devem acompanhar a área rolável");
  for (const button of await dialog.locator('[class*="modalHeaderActions"] button').all()) {
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    assert.ok(box.width >= 60 && box.x >= metrics.left && box.x + box.width <= metrics.right + 1, "Botão espremido ou fora do modal");
  }
  const content = dialog.locator('[class*="modalContent"]');
  await content.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  assert.ok(await content.evaluate((element) => element.scrollTop > 0), "Scroll vertical não funciona");
  await dialog.getByRole("heading", { name: "Histórico do pedido", exact: true }).scrollIntoViewIfNeeded();
  assert.deepEqual(qa.errors, []);
}

async function closeAndCheck(qa, escape = false) {
  if (escape) await qa.page.keyboard.press("Escape");
  else await qa.page.getByRole("button", { name: "Fechar detalhes do pedido" }).click();
  await qa.page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await qa.page.evaluate(() => document.body.style.overflow), "", "Body permaneceu travado após fechar");
}

async function testActions(viewport) {
  const qa = await session("admin", "aguardando_aprovacao", viewport);
  const { page, pedido, requests } = qa;
  try {
    // Todas as quantidades de separação e o faturamento são preenchidos pela UI real.
    await page.getByRole("button", { name: "APROVAR PEDIDO", exact: true }).click();
    await page.getByLabel("Atualização do fluxo").selectOption("separando");
    await page.getByRole("button", { name: "Iniciar separação", exact: true }).click();
    for (const item of pedido.itens) await page.getByLabel(`Quantidade separada de ${item.nomeProduto}`, { exact: true }).fill("5");
    await page.getByLabel("Atualização do fluxo").selectOption("separado");
    await page.getByRole("button", { name: "Concluir separação", exact: true }).click();
    await page.getByLabel("Número da nota fiscal").waitFor();
    await page.getByLabel("Número da nota fiscal").fill("NF-QA-1234");
    await page.getByLabel("Data de faturamento", { exact: true }).fill("2026-10-05");
    await page.getByLabel("Atualização do fluxo").selectOption("faturado");
    if (output) await page.screenshot({ path: resolve(output, `faturamento-preenchido-${viewport.width}.png`) });
    await page.getByRole("button", { name: "Faturar pedido", exact: true }).click();
    await page.getByLabel("Transportadora").waitFor();
    assert.equal(pedido.numeroNotaFiscal, "NF-QA-1234");
    assert.ok(pedido.dataFaturamento);
    await page.getByLabel("Transportadora").fill("Transporte QA");
    await page.getByLabel("Código de rastreio").fill("RASTREIO-QA");
    await page.getByLabel("Link de rastreamento").fill("https://example.com/qa");
    await page.getByLabel("Data de envio", { exact: true }).fill("2026-10-05");

    for (const [label, endpoint] of [["PDF comercial", "/pdf"], ["PDF de separação", "/pdf-separacao"], ["Relatório operacional", "/relatorio"]]) {
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: label, exact: true }).click();
      await download;
      assert.ok(requests.some((request) => request.path.endsWith(endpoint)));
    }
    await page.getByRole("button", { name: "Retirado pelo distribuidor", exact: true }).click();
    await page.getByRole("button", { name: "Cancelar", exact: true }).last().click();
    assert.equal(pedido.status, "faturado");
    assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden", "Fechar confirmação destravou o modal ainda aberto");
    await page.getByRole("button", { name: "Retirado pelo distribuidor", exact: true }).click();
    await page.getByRole("button", { name: "Confirmar retirada", exact: true }).click();
    await page.getByText("Retirado em:", { exact: false }).waitFor();
    assert.equal(pedido.status, "retirado");
    await closeAndCheck(qa);
    await qa.open(); await closeAndCheck(qa, true);
    assert.deepEqual(qa.errors, []);
  } finally { await qa.context.close(); }

  const extra = await session("admin", "separando", viewport);
  try {
    await extra.page.getByRole("button", { name: "Editar pedido", exact: true }).click();
    await extra.page.getByRole("dialog", { name: "Editar Pedido", exact: true }).waitFor();
    await extra.page.getByLabel(`Quantidade de ${extra.pedido.itens[0].nomeProduto}`, { exact: true }).fill("5");
    await extra.page.getByRole("button", { name: "Salvar Alterações", exact: true }).click();
    await extra.page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(await extra.page.evaluate(() => document.body.style.overflow), "");
    await extra.open();
    await extra.page.getByRole("button", { name: "Marcar como enviado", exact: true }).click();
    await extra.page.getByRole("alertdialog", { name: "Marcar como enviado?", exact: true }).getByRole("button", { name: "Marcar como enviado", exact: true }).click();
    await extra.page.getByText("Pedido enviado", { exact: true }).waitFor();
    assert.equal(extra.pedido.status, "enviado");
    await extra.page.getByRole("button", { name: "Excluir", exact: true }).click();
    await extra.page.getByRole("button", { name: "Excluir pedido", exact: true }).click();
    await extra.page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(await extra.page.evaluate(() => document.body.style.overflow), "");
    assert.ok(extra.requests.some((request) => request.method === "DELETE"));
    assert.deepEqual(extra.errors, []);
  } finally { await extra.context.close(); }
  console.log(`PASS: ações, separação → faturamento preenchido, PDFs, retirada/envio, editar, excluir e locks em ${viewport.width}px`);
}

try {
  if (process.env.QA_EDIT_ONLY === "1") {
    await testEditMobile({ session, output, results });
  } else {
  const qa = await session("admin", "separando", { width: 1024, height: 768 });
  try { await checkLayout(qa, "admin-separando-1024"); } finally { await qa.context.close(); }
  if (process.env.QA_REPRO_ONLY !== "1") {
    const viewports = [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 640 }];
    for (const role of ["admin", "vendedor", "comercial"]) {
      for (const status of (role === "admin" ? ["novo", "em_analise", "aguardando_aprovacao", "aprovado", "separando", "separado", "faturado", "enviado", "entregue", "retirado", "cancelado"] : ["aguardando_aprovacao", "separando", "faturado"])) {
        const matrix = await session(role, status, viewports[0]);
        try {
          for (const viewport of viewports) {
            await matrix.page.setViewportSize(viewport);
            await checkLayout(matrix, `${role}-${status}-${viewport.width}`);
            if (role !== "admin") {
              assert.equal(await matrix.page.getByRole("button", { name: "Marcar como enviado", exact: true }).count(), 0);
              assert.equal(await matrix.page.getByRole("button", { name: "Retirado pelo distribuidor", exact: true }).count(), 0);
            }
          }
          await closeAndCheck(matrix); await matrix.open(); await closeAndCheck(matrix, true);
        } finally { await matrix.context.close(); }
      }
    }
    // O faturamento também precisa ficar acessível nos pedidos do fluxo atual,
    // com os resumos adicionais de conferência e fechamento logístico.
    for (const viewport of viewports) {
      const modern = await session("admin", "separado", viewport, {
        conferenciaObrigatoria: true, fechamentoLogisticoObrigatorio: true,
        conferencia: { status: "concluida", versaoOperacional: 1, concluidaEm: "2026-10-05T14:00:00Z", concluidoPor: { usuarioId: id(1), usuarioNome: "Admin QA" } },
        fechamentoLogistico: { quantidadeVolumes: 3, pesoTotalKg: 12.5, observacaoVolumes: "Três caixas com os produtos conferidos", preenchidoEm: "2026-10-05T15:00:00Z", preenchidoPor: { usuarioId: id(1), usuarioNome: "Admin QA", operadorId: id(2), operadorNome: "Operador QA" } },
      });
      try {
        await checkLayout(modern, `admin-faturamento-atual-${viewport.width}`);
        await modern.page.getByLabel("Número da nota fiscal").fill("NF-ATUAL-1234");
        await modern.page.getByLabel("Data de faturamento", { exact: true }).fill("2026-10-05");
        await modern.page.getByLabel("Atualização do fluxo").selectOption("faturado");
        await modern.page.getByRole("button", { name: "Faturar pedido", exact: true }).click();
        await modern.page.getByLabel("Transportadora").waitFor();
        assert.equal(modern.pedido.numeroNotaFiscal, "NF-ATUAL-1234");
        assert.equal(modern.pedido.status, "faturado");
        await closeAndCheck(modern);
      } finally { await modern.context.close(); }
    }
    for (const viewport of viewports) await testActions(viewport);
    for (const viewport of viewports) {
      const client = await session("cliente", "enviado", viewport);
      try {
        await client.page.getByRole("button", { name: "Confirmar recebimento", exact: true }).click();
        const dialog = client.page.getByRole("alertdialog");
        await dialog.waitFor();
        const box = await dialog.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1 && box.y >= 0 && box.y + box.height <= viewport.height + 1);
        if (output) await client.page.screenshot({ path: resolve(output, `distribuidor-confirmacao-${viewport.width}.png`) });
        await client.page.getByRole("button", { name: "Cancelar", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
        assert.equal(await client.page.evaluate(() => document.body.style.overflow), "");
        await client.page.getByRole("button", { name: "Confirmar recebimento", exact: true }).click();
        await client.page.getByRole("alertdialog").getByRole("button", { name: "Confirmar recebimento", exact: true }).click();
        await client.page.getByRole("button", { name: "Concluir", exact: true }).click();
        await client.page.getByRole("dialog").waitFor({ state: "hidden" });
        assert.equal(client.pedido.status, "entregue");
        assert.equal(await client.page.evaluate(() => document.body.style.overflow), "");
        assert.deepEqual(client.errors, []);
      } finally { await client.context.close(); }
    }
    console.log("PASS: estados e perfis, desktop/notebook/tablet/mobile, scroll, ações e restauração do body");
  }
  }
} finally {
  if (output) await writeFile(resolve(output, "metrics.json"), JSON.stringify(results, null, 2));
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}
