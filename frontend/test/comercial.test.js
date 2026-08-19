import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readSource = (relativePath) => (
  readFileSync(new URL(relativePath, import.meta.url), "utf8")
);

test("login e guards direcionam Comercial diretamente para Preços", () => {
  const login = readSource("../src/pages/Login/Login.jsx");
  const guards = readSource("../src/components/RouteGuards/RouteGuards.jsx");

  assert.match(login, /comercial: "\/precos"/);
  assert.match(guards, /comercial: "\/precos"/);
  assert.match(guards, /comercial: "\/tabelas"/);
  assert.match(guards, /Array\.isArray\(roles\) \? roles : \[role\]/);
  assert.match(guards, /allowedRoles\.includes\(session\.usuario\.tipo\)/);
});

test("rotas de Preços e Tabelas aceitam Admin ou Comercial", () => {
  const app = readSource("../src/App.jsx");
  assert.match(
    app,
    /path="\/precos"[\s\S]*?<RoleRoute roles=\{\["admin", "comercial"\]\}>[\s\S]*?<AdminPrecos \/>/
  );
  assert.match(
    app,
    /path="\/tabelas"[\s\S]*?<RoleRoute roles=\{\["admin", "comercial"\]\}>[\s\S]*?<AdminTabelas \/>/
  );
});

test("URLs administrativas não comerciais continuam exclusivas do Admin", () => {
  const app = readSource("../src/App.jsx");
  for (const [path, component] of [
    ["/clientes", "AdminClientes"],
    ["/produtos", "AdminProdutos"],
    ["/pedidos", "AdminPedidos"],
    ["/admin/metricas-operacionais", "AdminMetricasPedidos"],
    ["/admin/operadores-logistica", "AdminOperadoresLogistica"],
    ["/admin/materiais-marketing", "AdminMateriaisMarketing"],
    ["/admin/banners", "AdminBanners"],
  ]) {
    const escapedPath = path.replaceAll("/", "\\/");
    assert.match(
      app,
      new RegExp(`path="${escapedPath}"[\\s\\S]*?<RoleRoute role="admin">[\\s\\S]*?<${component}`)
    );
  }
  assert.match(app, /path="\/marketing"[\s\S]*?<RoleRoute role="marketing">/);
  assert.match(app, /path="\/logistica"[\s\S]*?<RoleRoute role="logistica">/);
});

test("menu Comercial mostra somente Preços e Tabelas de Preços", () => {
  const navbar = readSource("../src/components/Navbar/Navbar.jsx");
  const block = navbar.match(/const comercialLinks = \[([\s\S]*?)\];/)?.[1] || "";

  assert.match(block, /to: "\/precos"/);
  assert.match(block, /to: "\/tabelas"/);
  assert.doesNotMatch(
    block,
    /\/produtos|\/clientes|\/pedidos|\/marketing|\/logistica|metricas|operadores|banners|treinamentos/i
  );
  assert.match(navbar, /const isCommercial = usuario\?\.tipo === "comercial"/);
  assert.match(navbar, /Equipe Comercial/);
  assert.match(navbar, /Painel Comercial/);
});

test("tela de Preços usa Produtos somente como consulta auxiliar", () => {
  const prices = readSource("../src/pages/AdminPrecos/AdminPrecos.jsx");

  assert.match(prices, /api\.get\("\/tabelas"\)/);
  assert.match(prices, /api\.get\("\/produtos"\)/);
  assert.match(prices, /api\.get\(`\/precos\/tabela\/\$\{tabelaId\}`\)/);
  assert.match(prices, /api\.post\("\/precos"/);
  assert.doesNotMatch(prices, /api\.(post|put|patch|delete)\(`?"?\/produtos/);
});

test("tela de Tabelas preserva criação, edição, status e duplicação", () => {
  const tables = readSource("../src/pages/AdminTabelas/AdminTabelas.jsx");

  assert.match(tables, /api\.get\("\/tabelas"\)/);
  assert.match(tables, /api\.post\("\/tabelas", form\)/);
  assert.match(tables, /api\.put\(`\/tabelas\/\$\{editando\._id\}`, form\)/);
  assert.match(tables, /ativa: !tabela\.ativa/);
  assert.match(tables, /api\.post\(`\/tabelas\/\$\{tabela\._id\}\/duplicar`/);
});

test("sessão continua validando correspondência entre role armazenada e token", () => {
  const authSession = readSource("../src/utils/authSession.js");
  assert.match(authSession, /payload\.tipo && payload\.tipo !== usuario\.tipo/);
  assert.match(authSession, /return \{[\s\S]*?token,[\s\S]*?usuario,[\s\S]*?payload/);
});
