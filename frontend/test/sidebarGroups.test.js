import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildSections,
  EXACT_ROUTES,
  findActiveGroup,
  readStoredGroups,
  resolveOpenGroups,
  sectionId,
  sidebarStorageKey,
  toggleStoredGroup,
  writeStoredGroups,
} from "../src/utils/sidebarGroups.js";
import { canOpenRoute } from "../src/utils/permissions.js";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const navbar = readSource("../src/components/Navbar/Navbar.jsx");
const sectionsSource = readSource("../src/components/Navbar/NavSections.jsx");
const css = readSource("../src/components/Navbar/Navbar.module.css");

// Mesmos itens do menu do Admin, já na ordem final da Navbar.
const adminLinks = [
  { to: "/admin", label: "Dashboard", group: "Visão geral" },
  { to: "/produtos", label: "Produtos", group: "Catálogo" },
  { to: "/tabelas", label: "Tabelas", group: "Comercial" },
  { to: "/precos", label: "Preços", group: "Comercial" },
  { to: "/clientes", label: "Clientes", group: "Relacionamento" },
  { to: "/usuarios", label: "Usuários e permissões", group: "Relacionamento" },
  { to: "/pedidos", label: "Pedidos", group: "Operação" },
  { to: "/necessidade-producao", label: "Necessidade de Produção", group: "Operação" },
  { to: "/admin/metricas-operacionais", label: "Métricas Operacionais", group: "Operação" },
  { to: "/admin/operadores-logistica", label: "Operadores da Logística", group: "Operação" },
  { to: "/admin/materiais-marketing", label: "Materiais de Marketing", group: "Conteúdo" },
  { to: "/admin/banners", label: "Banners", group: "Conteúdo" },
  { to: "/admin/treinamentos", label: "Treinamentos", group: "Conteúdo" },
];
const sections = buildSections(adminLinks);

// Simula a interação: estado salvo + clique no título, como a Navbar faz.
const click = (stored, group, pathname = "/admin") => {
  const activeGroup = findActiveGroup(sections, pathname);
  const open = resolveOpenGroups({ sections, stored, activeGroup });
  return toggleStoredGroup(stored, group, open[group]);
};
const openAt = (stored, pathname = "/admin") => resolveOpenGroups({
  sections, stored, activeGroup: findActiveGroup(sections, pathname),
});

test("grupos reais da Central; Visão geral fica fixa e os demais recolhem", () => {
  assert.deepEqual(sections.map((section) => [section.group, section.collapsible, section.links.length]), [
    ["Visão geral", false, 1],
    ["Catálogo", true, 1],
    ["Comercial", true, 2],
    ["Relacionamento", true, 2],
    ["Operação", true, 4],
    ["Conteúdo", true, 3],
  ]);
  assert.equal(sectionId("Operação"), "sidebar-grupo-operacao");
});

for (const group of ["Catálogo", "Comercial", "Relacionamento", "Operação"]) {
  test(`${group} abre e fecha`, () => {
    const opened = click({}, group);
    assert.equal(openAt(opened)[group], true);
    const closed = click(opened, group);
    assert.equal(openAt(closed)[group], false);
  });
}

test("mais de um grupo permanece aberto; abrir um não fecha outro", () => {
  let stored = click({}, "Catálogo");
  stored = click(stored, "Comercial");
  stored = click(stored, "Relacionamento");
  const open = openAt(stored);
  assert.equal(open["Catálogo"], true);
  assert.equal(open.Comercial, true);
  assert.equal(open.Relacionamento, true);
  assert.equal(open["Operação"], false);
});

test("grupo da rota atual abre automaticamente, inclusive por acesso direto", () => {
  assert.equal(findActiveGroup(sections, "/precos"), "Comercial");
  assert.equal(openAt({}, "/precos").Comercial, true);
  assert.equal(findActiveGroup(sections, "/necessidade-producao"), "Operação");
  assert.equal(openAt({}, "/necessidade-producao")["Operação"], true);
  // Subpáginas do painel não são confundidas com o Dashboard.
  assert.equal(findActiveGroup(sections, "/admin/treinamentos"), "Conteúdo");
  assert.equal(findActiveGroup(sections, "/admin"), "Visão geral");
});

test("rota atual tem prioridade sobre a preferência salva", () => {
  const stored = { Comercial: false, "Operação": false };
  assert.equal(openAt(stored, "/precos").Comercial, true);
  assert.equal(openAt(stored, "/precos")["Operação"], false);
  // O título do grupo ativo não fecha a seção da página atual.
  assert.match(sectionsSource, /onClick=\{\(\) => \{ if \(!isActiveGroup\) onToggle\(section\.group\); \}\}/);
  assert.match(sectionsSource, /aria-disabled=\{isActiveGroup \|\| undefined\}/);
});

test("refresh e navegação mantêm o item ativo visível e com o mesmo estilo", () => {
  // A Navbar lê a preferência ao montar e combina com a rota atual a cada render.
  assert.match(navbar, /useState\(\(\) => readStoredGroups\(window\.localStorage, storageKey\)\)/);
  assert.match(navbar, /const activeGroup = findActiveGroup\(sections, pathname\);/);
  assert.match(sectionsSource, /end=\{EXACT_ROUTES\.has\(link\.to\)\}/);
  assert.match(sectionsSource, /className=\{linkClass\}/);
  assert.match(css, /\.admin \.active \{\s*border-left-color: var\(--brand-primary\);\s*background: rgba\(113, 196, 192, 0\.12\);/);
  assert.ok(EXACT_ROUTES.has("/admin"));
});

test("estado é preservado entre navegações por usuário", () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  const key = sidebarStorageKey("admin");
  writeStoredGroups(storage, key, { "Catálogo": false, Comercial: true });
  assert.deepEqual(readStoredGroups(storage, key), { "Catálogo": false, Comercial: true });
  assert.notEqual(sidebarStorageKey("comercial"), key);
  assert.deepEqual(readStoredGroups({ getItem: () => "{inválido" }, key), {});
  assert.deepEqual(readStoredGroups({ getItem: () => { throw new Error("bloqueado"); } }, key), {});
  assert.doesNotThrow(() => writeStoredGroups({ setItem: () => { throw new Error("cheio"); } }, key, {}));
});

test("grupos trabalham só sobre itens permitidos; grupo vazio não aparece", () => {
  const vendedor = { tipo: "vendedor" };
  const permitted = adminLinks.filter((link) => canOpenRoute(vendedor, link.to, []));
  const vendorSections = buildSections(permitted);
  for (const section of vendorSections) {
    assert.ok(section.links.length > 0, section.group);
    for (const link of section.links) assert.equal(canOpenRoute(vendedor, link.to, []), true, link.to);
  }
  assert.equal(vendorSections.some((section) => section.group === "Catálogo"), false, "sem itens permitidos, sem título");
  assert.deepEqual(buildSections([]), []);
  // A Navbar monta as seções a partir dos links já filtrados por permissão.
  assert.match(navbar, /\.filter\(\(link, index, all\) => all\.findIndex\(\(item\) => item\.to === link\.to\) === index && canOpenRoute\(usuario, link\.to, \[usuario\?\.tipo\]\)\)/);
  assert.match(navbar, /const sections = buildSections\(links\);/);
});

test("item sem permissão continua escondido mesmo com o grupo aberto", () => {
  const comercial = { tipo: "comercial" };
  const links = adminLinks.filter((link) => canOpenRoute(comercial, link.to, []));
  assert.equal(links.some((link) => link.to === "/admin/materiais-marketing"), false);
  const open = resolveOpenGroups({ sections: buildSections(links), stored: { "Conteúdo": true }, activeGroup: null });
  assert.equal(Object.keys(open).includes("Catálogo"), false);
});

test("aria-expanded e aria-controls apontam para a lista correspondente", () => {
  assert.match(sectionsSource, /type="button"/);
  assert.match(sectionsSource, /aria-expanded=\{open\}/);
  assert.match(sectionsSource, /aria-controls=\{contentId\}/);
  assert.match(sectionsSource, /id=\{contentId\}/);
  assert.match(sectionsSource, /const contentId = `\$\{idPrefix\}\$\{section\.id\}`;/, "IDs únicos na sidebar e no menu mobile");
  assert.match(navbar, /idPrefix="mobile-"/);
});

test("Enter e Space acionam o título por ser um button nativo, sem div clicável", () => {
  assert.doesNotMatch(sectionsSource, /<div[^>]*onClick/);
  assert.match(sectionsSource, /<button\s+type="button"/);
  // Itens de grupo fechado saem da ordem de foco.
  assert.match(sectionsSource, /inert=\{!open \|\| undefined\}/);
  assert.match(css, /\.admin \.groupToggle:focus-visible,\s*\.admin \.link:focus-visible \{\s*outline-offset: -3px;/);
});

test("mobile mantém grupos recolhíveis, área de toque e acesso a todos os itens", () => {
  assert.match(navbar, /variant="mobile"/);
  assert.match(navbar, /onNavigate=\{fecharMenu\}/, "tocar em um item continua fechando o menu");
  assert.match(css, /\.mobileGroupToggle \{[\s\S]*?min-height: 44px;/);
  assert.match(css, /\.mobileMenu \{[\s\S]*?overflow-y: auto;/);
  // Todo item visível pertence a uma seção renderizada.
  const total = sections.reduce((sum, section) => sum + section.links.length, 0);
  assert.equal(total, adminLinks.length);
});

test("animação curta respeita prefers-reduced-motion", () => {
  assert.match(css, /transition: grid-template-rows 200ms ease, opacity 160ms ease;/);
  assert.match(css, /\[aria-expanded="true"\] > \.chevron \{\s*transform: rotate\(90deg\);/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.groupItems,\s*\.chevron \{\s*transition: none;/);
});

test("scrollbar da sidebar continua rolando, fina e sem faixa clara", () => {
  assert.match(css, /\.admin \.links \{[\s\S]*?overflow-y: auto;/);
  assert.doesNotMatch(css, /\.admin \.links \{[^}]*display: none/);
  assert.doesNotMatch(css, /\.admin \.links::-webkit-scrollbar \{[^}]*display: none/);
  assert.match(css, /\.admin \.links::-webkit-scrollbar \{\s*width: 6px;/);
  assert.match(css, /\.admin \.links::-webkit-scrollbar-track \{\s*background: transparent;/);
  assert.match(css, /\.admin \.links::-webkit-scrollbar-button \{\s*display: none;/);
  assert.match(css, /@supports not selector\(::-webkit-scrollbar\) \{[\s\S]*scrollbar-width: thin;/, "Firefox");
});
