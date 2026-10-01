import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("rotas frontend separam marketing, admin e cliente", () => {
  const app = readSource("../src/App.jsx");
  assert.match(app, /path="\/marketing"[\s\S]*?<RoleRoute role="marketing">/);
  assert.match(app, /path="\/marketing\/conteudos"[\s\S]*?<RoleRoute role="marketing">/);
  assert.match(app, /path="\/marketing\/banners"[\s\S]*?<RoleRoute role="marketing">/);
  assert.match(app, /path="\/admin\/banners"[\s\S]*?<RoleRoute role="admin">/);
  assert.match(app, /path="\/catalogo"[\s\S]*?<RoleRoute role="cliente">/);
});

test("guard e login direcionam marketing para seu painel", () => {
  const guards = readSource("../src/components/RouteGuards/RouteGuards.jsx");
  const login = readSource("../src/pages/Login/Login.jsx");
  assert.match(guards, /marketing: "\/marketing"/);
  assert.match(guards, /api\.get\("\/auth\/me"\)/);
  assert.match(login, /marketing: "\/marketing"/);
});

test("menu de marketing nao contem links administrativos", () => {
  const navbar = readSource("../src/components/Navbar/Navbar.jsx");
  const marketingBlock = navbar.match(/const marketingLinks = \[([\s\S]*?)\];/)?.[1] || "";
  assert.match(marketingBlock, /\/marketing\/conteudos/);
  assert.match(marketingBlock, /\/marketing\/banners/);
  assert.doesNotMatch(marketingBlock, /\/clientes|\/produtos|\/pedidos|\/precos|\/tabelas/);
});

test("conteudos permanecem limitados a link do Google Drive", () => {
  const form = readSource("../src/pages/AdminMateriaisMarketing/AdminMateriaisMarketing.jsx");
  assert.match(form, /placeholder="https:\/\/drive\.google\.com\/\.\.\."/);
  assert.match(form, /Use somente um link do Google Drive/);
  assert.doesNotMatch(form, /fileField: "arquivo"|name="arquivo"/);
});

test("catalogo carrega banners destinados ao distribuidor", () => {
  const catalog = readSource("../src/pages/Catalogo/Catalogo.jsx");
  const banners = readSource("../src/components/DistributorBanners/DistributorBanners.jsx");
  assert.match(catalog, /<DistributorBanners \/>/);
  assert.match(banners, /api\.get\("\/banners"/);
});
