import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readSource = (relativePath) => (
  readFileSync(new URL(relativePath, import.meta.url), "utf8")
);

const modalCssFiles = [
  "../src/components/ClientDetails/ClientDetailModal.module.css",
  "../src/components/OrderDetails/OrderDetails.module.css",
  "../src/components/OperatorIdentification/OperatorIdentificationModal.module.css",
  "../src/pages/AdminPedidos/AdminPedidos.module.css",
  "../src/pages/AdminBanners/AdminBanners.module.css",
  "../src/pages/AdminMateriaisMarketing/AdminMateriaisMarketing.module.css",
  "../src/pages/AdminTreinamentos/AdminTreinamentos.module.css",
];

test("modais respeitam a viewport dinâmica e mantêm margem segura no mobile", () => {
  for (const file of modalCssFiles) {
    const css = readSource(file);
    assert.match(css, /100dvh/, file);
    assert.match(css, /max-height:/, file);
    assert.match(css, /overflow:\s*hidden/, file);
    assert.match(css, /padding:\s*8px/, file);
  }
});

test("modais extensos rolam internamente sem depender do scroll do overlay", () => {
  for (const file of [
    "../src/components/ClientDetails/ClientDetailModal.module.css",
    "../src/components/OrderDetails/OrderDetails.module.css",
    "../src/pages/AdminBanners/AdminBanners.module.css",
    "../src/pages/AdminMateriaisMarketing/AdminMateriaisMarketing.module.css",
    "../src/pages/AdminTreinamentos/AdminTreinamentos.module.css",
  ]) {
    const css = readSource(file);
    assert.match(css, /min-height:\s*0/, file);
    assert.match(css, /overflow-y:\s*auto/, file);
    assert.match(css, /overscroll-behavior:\s*contain/, file);
  }
});

test("ações dos formulários longos ficam alcançáveis e respeitam safe area", () => {
  for (const file of [
    "../src/components/ClientDetails/ClientDetailModal.module.css",
    "../src/components/OrderDetails/OrderDetails.module.css",
    "../src/pages/AdminBanners/AdminBanners.module.css",
    "../src/pages/AdminMateriaisMarketing/AdminMateriaisMarketing.module.css",
  ]) {
    const css = readSource(file);
    assert.match(css, /position:\s*sticky/, file);
    assert.match(css, /env\(safe-area-inset-bottom\)/, file);
  }
});

test("interação compartilhada restaura foco, fecha por ESC e limita Tab ao diálogo superior", () => {
  const hook = readSource("../src/hooks/useModalDialog.js");
  assert.match(hook, /previouslyFocused/);
  assert.match(hook, /event\.key === "Escape"/);
  assert.match(hook, /event\.key !== "Tab"/);
  assert.match(hook, /isTopmostDialog\(dialog\)/);
  assert.match(hook, /document\.body\.style\.overflow = "hidden"/);
  assert.match(hook, /focus\(\{ preventScroll: true \}\)/);
});

test("modal de treinamento fica ancorado e absorve conteúdo condicional no scroll interno", () => {
  const css = readSource("../src/pages/AdminTreinamentos/AdminTreinamentos.module.css");
  const modalSource = readSource("../src/pages/AdminTreinamentos/AdminTreinamentos.jsx");
  const selectorSource = readSource("../src/components/AudienceSelector/AudienceSelector.jsx");
  const selectorCss = readSource("../src/components/AudienceSelector/AudienceSelector.module.css");
  const globalCss = readSource("../src/index.css");

  assert.match(css, /\.modalOverlay\s*\{[\s\S]*?position:\s*fixed[\s\S]*?inset:\s*0[\s\S]*?display:\s*flex[\s\S]*?align-items:\s*flex-start[\s\S]*?justify-content:\s*center/);
  assert.match(css, /\.modal\s*\{[\s\S]*?height:\s*calc\(100dvh - 32px\)[\s\S]*?max-height:\s*calc\(100dvh - 32px\)[\s\S]*?display:\s*flex[\s\S]*?flex-direction:\s*column/);
  assert.match(css, /\.modalHeader\s*\{[\s\S]*?flex:\s*0 0 auto/);
  assert.match(css, /\.form\s*\{[\s\S]*?flex:\s*1 1 auto[\s\S]*?min-height:\s*0[\s\S]*?overflow:\s*hidden[\s\S]*?flex-direction:\s*column/);
  assert.match(css, /\.formBody\s*\{[\s\S]*?flex:\s*1 1 auto[\s\S]*?min-height:\s*0[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /\.formActions\s*\{[\s\S]*?flex:\s*0 0 auto/);
  assert.doesNotMatch(css, /\.formActions\s*\{[\s\S]*?(?:position:\s*sticky|bottom:\s*-|margin:[^;]*-20px)/);
  assert.doesNotMatch(css, /translate(?:Y|3d)?\s*\(/i);
  assert.match(selectorSource, /audienceType === "especificos"/);
  assert.doesNotMatch(selectorSource, /scrollIntoView|\.focus\(/);
  assert.match(selectorCss, /\.segmented label\s*\{[\s\S]*?position:\s*relative/);
  assert.match(selectorCss, /\.segmented input\s*\{[\s\S]*?width:\s*1px[\s\S]*?min-height:\s*1px[\s\S]*?clip-path:\s*inset\(50%\)/);
  assert.match(selectorCss, /\.distributorList\s*\{[\s\S]*?max-height:\s*220px[\s\S]*?overflow-y:\s*auto/);
  assert.match(modalSource, /<form className=\{styles\.form\}[\s\S]*?<div className=\{styles\.formBody\}>[\s\S]*?<footer className=\{styles\.formActions\}>/);
  assert.doesNotMatch(globalCss.match(/html,\s*\nbody,\s*\n#root\s*\{[\s\S]*?\}/)?.[0] || "", /transform|filter|perspective|contain/);
  assert.match(modalSource, /changeTrainingPublics/);
  assert.match(modalSource, /changeTrainingDistributorAudience/);
  assert.match(modalSource, /buildTrainingAudiencePayload/);
});

test("todos os fluxos modais usam semântica de diálogo e foco compartilhado", () => {
  for (const file of [
    "../src/components/ClientDetails/ClientDetailModal.jsx",
    "../src/components/OrderDetails/OrderDetailModal.jsx",
    "../src/components/OperatorIdentification/OperatorIdentificationModal.jsx",
    "../src/pages/AdminBanners/AdminBanners.jsx",
    "../src/pages/AdminMateriaisMarketing/AdminMateriaisMarketing.jsx",
    "../src/pages/AdminTreinamentos/AdminTreinamentos.jsx",
  ]) {
    const source = readSource(file);
    assert.match(source, /useModalDialog/, file);
    assert.match(source, /role="dialog"/, file);
    assert.match(source, /aria-modal="true"/, file);
    assert.match(source, /tabIndex="-1"/, file);
  }
});

test("edição administrativa de pedido preserva salvar e cancelar em modal acessível", () => {
  const source = readSource("../src/pages/AdminPedidos/AdminPedidos.jsx");
  const css = readSource("../src/pages/AdminPedidos/AdminPedidos.module.css");
  assert.match(source, /aria-labelledby="edit-order-title"/);
  assert.match(source, /Salvar Alterações/);
  assert.match(source, />\s*Cancelar\s*</);
  assert.match(css, /\.listaProdutosModal\s*\{[\s\S]*?flex:\s*1 1 auto/);
  assert.match(css, /\.modalFooter\s*\{[\s\S]*?flex:\s*0 0 auto/);
});

test("cadastros de preços, tabelas, produtos e operadores continuam formulários de página responsivos", () => {
  for (const [jsxFile, cssFile, breakpoint] of [
    ["../src/pages/AdminPrecos/AdminPrecos.jsx", "../src/pages/AdminPrecos/AdminPrecos.module.css", /max-width: 768px/],
    ["../src/pages/AdminTabelas/AdminTabelas.jsx", "../src/pages/AdminTabelas/AdminTabelas.module.css", /max-width: 900px/],
    ["../src/pages/AdminProdutos/AdminProdutos.jsx", "../src/pages/AdminProdutos/AdminProdutos.module.css", /max-width: 900px/],
    ["../src/pages/AdminOperadoresLogistica/AdminOperadoresLogistica.jsx", "../src/pages/AdminOperadoresLogistica/AdminOperadoresLogistica.module.css", /max-width: 700px/],
  ]) {
    const source = readSource(jsxFile);
    assert.match(source, /<form|<input/, jsxFile);
    assert.doesNotMatch(source, /role="dialog"/, jsxFile);
    assert.match(readSource(cssFile), breakpoint, cssFile);
  }
});
