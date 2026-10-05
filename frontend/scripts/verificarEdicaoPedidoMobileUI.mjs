import assert from "node:assert/strict";
import { resolve } from "node:path";

// Executado pelo harness de pedidos com QA_EDIT_ONLY=1, após o build.
export async function testEditMobile({ session, output, results }) {
  const catalog = Array.from({ length: 60 }, (_, i) => ({
    _id: (100 + i).toString(16).padStart(24, "0"),
    nome: i % 3 === 0 ? `Shampoo QA ${i + 1} profissional para cães e gatos com pelagem sensível, hidratação profunda e fragrância suave — embalagem econômica de cinco litros` : `Shampoo QA ${i + 1}`,
    linha: "Linha profissional", categoria: "Higiene e cuidado",
  }));
  for (const role of (process.env.QA_EDIT_DESKTOP_ONLY === "1" ? [] : ["admin", "vendedor", "comercial"])) {
  for (const width of [320, 375, 430]) {
    const prefix = role === "admin" ? "" : `${role}-`;
    const qa = await session(role, role === "admin" ? "separando" : "aguardando_aprovacao", { width, height: 740 }, {}, catalog, { isMobile: true, hasTouch: true });
    try {
      const { page } = qa;
      await page.getByRole("button", { name: "Editar pedido", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Editar Pedido", exact: true });
      const search = dialog.getByRole("searchbox", { name: "Buscar produtos do pedido", exact: true });
      await search.fill("Shampoo QA");
      for (const height of [740, 380]) {
        await page.setViewportSize({ width, height });
        await search.focus();
        await page.waitForFunction(() => {
          const overlay = document.querySelector('[aria-labelledby="edit-order-title"]').parentElement;
          return Math.abs(overlay.getBoundingClientRect().height - window.visualViewport.height) < 1;
        });
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const metrics = await dialog.evaluate((element) => {
          const list = element.querySelector('[class*="listaProdutosModal"]');
          const body = element.querySelector('[class*="modalBody"]') || list;
          const search = element.querySelector('[type="search"]').getBoundingClientRect();
          const footer = element.querySelector('[class*="modalFooter"]').getBoundingClientRect();
          const bodyRect = body.getBoundingClientRect();
          return { listHeight: list.clientHeight, bodyHeight: body.clientHeight, resultArea: bodyRect.bottom - Math.max(bodyRect.top, search.bottom), searchHeight: search.height,
            searchTop: search.top, searchBottom: search.bottom, footerBottom: footer.bottom, horizontalOverflow: element.scrollWidth - element.clientWidth, viewportHeight: innerHeight };
        });
        results.push({ label: `edicao-${prefix}${width}-${height}`, ...metrics });
        console.log(`edicao-${prefix}${width}-${height}: ${JSON.stringify(metrics)}`);
        if (output) await page.screenshot({ path: resolve(output, `edicao-${prefix}${width}-${height}.png`) });
      }
      const keyboard = results.at(-1);
      assert.ok(keyboard.resultArea >= 140, `Área de resultados insuficiente com teclado: ${JSON.stringify(keyboard)}`);
      assert.ok(keyboard.bodyHeight >= 180, "Conteúdo central comprimido");
      assert.ok(keyboard.searchTop >= 0 && keyboard.searchBottom < keyboard.viewportHeight, "Busca inacessível");
      assert.ok(keyboard.footerBottom <= keyboard.viewportHeight, "Salvar/cancelar inacessíveis");
      assert.ok(keyboard.horizontalOverflow <= 1, "Overflow horizontal");
      assert.ok(keyboard.searchHeight >= 44, "Campo pequeno para toque");
      assert.equal(await dialog.getByRole("spinbutton").count(), 60);
      const body = dialog.locator('[class*="modalBody"]');
      const list = dialog.locator('[class*="listaProdutosModal"]');
      assert.equal(await list.evaluate((element) => getComputedStyle(element).overflowY), "visible", "Lista criou um segundo scroll concorrente");
      assert.equal(await body.evaluate((element) => getComputedStyle(element).overflowY), "auto");

      await search.fill(catalog[0].nome);
      assert.equal(await dialog.getByRole("spinbutton").count(), 1);
      const nameMetrics = await dialog.locator('[class*="productName"] strong').evaluate((element) => ({
        text: element.textContent, whiteSpace: getComputedStyle(element).whiteSpace, lineClamp: getComputedStyle(element).webkitLineClamp,
      }));
      assert.equal(nameMetrics.text, catalog[0].nome);
      assert.equal(nameMetrics.whiteSpace, "normal");
      assert.ok(["none", ""].includes(nameMetrics.lineClamp));
      await dialog.getByRole("button", { name: "Buscar", exact: true }).tap();
      await dialog.getByRole("button", { name: "Limpar", exact: true }).tap();
      assert.equal(await search.inputValue(), "");
      assert.equal(await dialog.getByRole("spinbutton").count(), 60);
      await search.fill("produto inexistente");
      await dialog.getByText("0 produtos encontrados.", { exact: false }).waitFor();
      await search.fill("Shampoo QA");

      // Tocar no nome completo foca a quantidade; 0 remove, >0 inclui o item.
      for (const [index, quantity] of [[0, "8"], [1, "0"], [12, "3"], [59, "4"]]) {
        const input = dialog.getByRole("spinbutton", { name: `Quantidade de ${catalog[index].nome}`, exact: true });
        await dialog.locator(`label[for="edit-order-product-${catalog[index]._id}"]`).tap();
        await input.fill(quantity);
        await input.evaluate((element) => element.scrollIntoView({ block: "center" }));
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const field = await input.boundingBox();
        const footer = await dialog.locator('[class*="modalFooter"]').boundingBox();
        assert.ok(field.height >= 44 && field.y >= 0 && field.y + field.height <= footer.y + 1, "Quantidade inacessível com teclado");
        assert.equal(await input.inputValue(), quantity);
        if (index === 59 && output) await page.screenshot({ path: resolve(output, `ultimo-resultado-${prefix}${width}.png`) });
      }
      assert.ok(await body.evaluate((element) => element.scrollTop > 5000), "Último resultado não foi alcançado");
      assert.equal(await list.evaluate((element) => element.scrollTop), 0);
      await dialog.getByRole("button", { name: "Salvar Alterações", exact: true }).tap();
      await dialog.waitFor({ state: "hidden" });
      const saved = qa.requests.filter((request) => request.method === "PUT");
      assert.equal(saved.length, 1);
      const items = saved[0].body.itens;
      assert.equal(items.find((item) => item.produtoId === catalog[0]._id).quantidade, 8);
      assert.equal(items.some((item) => item.produtoId === catalog[1]._id), false);
      assert.equal(items.find((item) => item.produtoId === catalog[12]._id).quantidade, 3);
      assert.equal(items.find((item) => item.produtoId === catalog[59]._id).quantidade, 4);
      assert.equal(await page.evaluate(() => document.body.style.overflow), "");

      await qa.open();
      await page.getByRole("button", { name: "Editar pedido", exact: true }).tap();
      const restored = dialog.getByRole("spinbutton", { name: `Quantidade de ${catalog[0].nome}`, exact: true });
      assert.equal(await restored.inputValue(), "8");
      await restored.fill("999");

      // iOS pode manter a layout viewport enquanto só a visualViewport encolhe.
      await page.setViewportSize({ width, height: 740 });
      await page.evaluate(() => {
        const viewport = window.visualViewport;
        Object.defineProperty(viewport, "height", { configurable: true, get: () => 380 });
        Object.defineProperty(viewport, "offsetTop", { configurable: true, get: () => 24 });
        viewport.dispatchEvent(new Event("resize"));
        viewport.dispatchEvent(new Event("scroll"));
        window.qaEditOverlay = document.querySelector('[aria-labelledby="edit-order-title"]').parentElement;
      });
      await search.fill("Shampoo QA");
      await page.waitForFunction(() => {
        const rect = window.qaEditOverlay.getBoundingClientRect();
        return rect.height === 380 && rect.top === 24;
      });
      const virtualMetrics = await dialog.evaluate((element) => ({
        search: element.querySelector('[type="search"]').getBoundingClientRect().toJSON(),
        footer: element.querySelector('[class*="modalFooter"]').getBoundingClientRect().toJSON(),
      }));
      assert.ok(virtualMetrics.search.top >= 24 && virtualMetrics.search.bottom <= 404);
      assert.ok(virtualMetrics.footer.bottom <= 404);
      if (output) await page.screenshot({ path: resolve(output, `visual-viewport-${prefix}${width}.png`), clip: { x: 0, y: 24, width, height: 380 } });
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).tap();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(qa.requests.filter((request) => request.method === "PUT").length, 1, "Cancelar enviou alterações");
      assert.equal(await page.evaluate(() => document.body.style.overflow), "");
      assert.equal(await page.evaluate(() => window.qaEditOverlay.style.getPropertyValue("--edit-viewport-height")), "", "Variável da viewport não foi limpa");
      await page.evaluate(() => {
        delete window.visualViewport.height;
        delete window.visualViewport.offsetTop;
        window.visualViewport.dispatchEvent(new Event("resize"));
      });
      await qa.open();
      await page.getByRole("button", { name: "Editar pedido", exact: true }).tap();
      assert.equal(await restored.inputValue(), "8", "Cancelar não descartou a quantidade alterada");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => document.body.style.overflow), "");
      assert.deepEqual(qa.errors, []);
      console.log(`PASS: edição mobile ${role} ${width}px, nomes completos, 60 resultados, último item, inclusão/remoção, quantidades, salvar/cancelar e visualViewport`);
    } finally { await qa.context.close(); }
    if (process.env.QA_EDIT_REPRO === "1") break;
  }
  if (process.env.QA_EDIT_REPRO === "1") break;
  }
  if (process.env.QA_EDIT_REPRO !== "1") {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
      const qa = await session("admin", "separando", viewport, {}, catalog);
      try {
        await qa.page.getByRole("button", { name: "Editar pedido", exact: true }).click();
        const dialog = qa.page.getByRole("dialog", { name: "Editar Pedido", exact: true });
        const list = dialog.locator('[class*="listaProdutosModal"]');
        const listHeight = await list.evaluate((element) => element.clientHeight);
        console.log(`edicao-desktop-${viewport.width}: lista com ${listHeight}px de altura`);
        assert.ok(listHeight >= 220, `Lista desktop comprimida: ${listHeight}px`);
        assert.equal(await list.evaluate((element) => getComputedStyle(element).overflowY), "auto");
        const box = await dialog.boundingBox();
        assert.ok(box.width < viewport.width && box.y >= 0 && box.y + box.height <= viewport.height);
        if (output) await qa.page.screenshot({ path: resolve(output, `edicao-desktop-${viewport.width}.png`) });
        await dialog.getByRole("spinbutton", { name: `Quantidade de ${catalog[59].nome}`, exact: true }).fill("2");
        assert.ok(await list.evaluate((element) => element.scrollTop > 0));
        await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
        assert.equal(qa.requests.some((request) => request.method === "PUT"), false);
        assert.equal(await qa.page.evaluate(() => document.body.style.overflow), "");
        console.log(`PASS: edição desktop ${viewport.width}px preserva lista, scroll e ações`);
      } finally { await qa.context.close(); }
    }
  }
}
