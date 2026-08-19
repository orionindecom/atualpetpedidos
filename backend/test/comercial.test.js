import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Usuario from "../src/models/Usuario.js";
import { login } from "../src/controllers/authController.js";
import { proteger } from "../src/middlewares/authMiddleware.js";
import {
  somenteAdmin,
  somenteGestorComercial,
  somenteGestorConteudo,
  somenteOperacaoLogistica,
} from "../src/middlewares/adminMiddleware.js";
import tabelaRouter from "../src/routes/tabelaPrecoRoutes.js";
import precoRouter from "../src/routes/precoProdutoRoutes.js";
import produtoRouter from "../src/routes/produtoRoutes.js";
import clienteRouter from "../src/routes/clienteRoutes.js";
import pedidoRouter from "../src/routes/pedidoRoutes.js";
import logisticaRouter from "../src/routes/logisticaRoutes.js";
import marketingRouter from "../src/routes/marketingRoutes.js";
import metricasRouter from "../src/routes/pedidoMetricasRoutes.js";
import operadoresRouter from "../src/routes/operadorLogisticaRoutes.js";

const objectId = "507f1f77bcf86cd799439011";
const secret = "segredo-comercial-com-mais-de-trinta-e-dois-caracteres";

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const findRoute = (router, path, method) => router.stack.find((layer) => (
  layer.route?.path === path && layer.route.methods[method]
));

const middlewareNames = (route) => route.route.stack.map((layer) => layer.name);

test("schema e login preservam o novo papel comercial no token e na resposta", async (t) => {
  assert.deepEqual(Usuario.schema.path("tipo").enumValues, [
    "admin",
    "comercial",
    "marketing",
    "logistica",
    "cliente",
    "groomer",
  ]);

  const originalFindOne = Usuario.findOne;
  const originalSecret = process.env.JWT_SECRET;
  const password = "senha-comercial";
  const user = {
    _id: objectId,
    nomeResponsavel: "Equipe Comercial",
    email: "comercial@example.com",
    senha: await bcrypt.hash(password, 10),
    tipo: "comercial",
    ativo: true,
    statusCadastro: "aprovado",
    tokenVersion: 0,
    save: async () => {},
  };
  Usuario.findOne = async () => user;
  process.env.JWT_SECRET = secret;
  t.after(() => {
    Usuario.findOne = originalFindOne;
    process.env.JWT_SECRET = originalSecret;
  });

  const response = createResponse();
  await login({ body: { email: user.email, senha: password } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.usuario.tipo, "comercial");
  assert.equal(jwt.verify(response.body.token, secret).tipo, "comercial");
});

test("middleware comercial permite somente Admin e Comercial", () => {
  for (const tipo of ["admin", "comercial"]) {
    const response = createResponse();
    let allowed = false;
    somenteGestorComercial({ usuario: { tipo } }, response, () => { allowed = true; });
    assert.equal(allowed, true);
  }

  for (const tipo of ["marketing", "logistica", "cliente"]) {
    const response = createResponse();
    somenteGestorComercial(
      { usuario: { tipo } },
      response,
      () => assert.fail(`${tipo} não pode gerenciar preços`)
    );
    assert.equal(response.statusCode, 403);
  }
});

test("tabelas liberam consulta, criação, edição, status e duplicação", () => {
  for (const [path, method] of [
    ["/", "get"],
    ["/", "post"],
    ["/:id", "put"],
    ["/:id/duplicar", "post"],
  ]) {
    const route = findRoute(tabelaRouter, path, method);
    assert.ok(route);
    assert.deepEqual(middlewareNames(route).slice(0, 2), [
      "proteger",
      "somenteGestorComercial",
    ]);
  }
});

test("preços liberam consulta e upsert com validação de IDs preservada", () => {
  const saveRoute = findRoute(precoRouter, "/", "post");
  const listRoute = findRoute(precoRouter, "/tabela/:tabelaPrecoId", "get");

  assert.deepEqual(middlewareNames(saveRoute).slice(0, 2), [
    "proteger",
    "somenteGestorComercial",
  ]);
  assert.deepEqual(middlewareNames(listRoute).slice(0, 2), [
    "proteger",
    "somenteGestorComercial",
  ]);
  assert.equal(listRoute.route.stack.length, 4);
});

test("produtos ficam somente leitura para Comercial e mutações continuam Admin", () => {
  const listRoute = findRoute(produtoRouter, "/", "get");
  assert.deepEqual(middlewareNames(listRoute).slice(0, 2), [
    "proteger",
    "somenteGestorComercial",
  ]);

  for (const [path, method] of [["/", "post"], ["/:id", "put"], ["/:id", "delete"]]) {
    const route = findRoute(produtoRouter, path, method);
    assert.ok(route);
    assert.deepEqual(middlewareNames(route).slice(0, 2), ["proteger", "somenteAdmin"]);
  }
});

test("Comercial continua bloqueado de Admin, Marketing e Logística", () => {
  for (const middleware of [somenteAdmin, somenteGestorConteudo, somenteOperacaoLogistica]) {
    const response = createResponse();
    middleware(
      { usuario: { tipo: "comercial" } },
      response,
      () => assert.fail("Comercial não pode atravessar esta autorização")
    );
    assert.equal(response.statusCode, 403);
  }
});

test("clientes, pedidos, métricas e operadores mantêm autorização exclusiva", () => {
  for (const router of [clienteRouter, metricasRouter, operadoresRouter]) {
    assert.deepEqual(router.stack.slice(0, 2).map((layer) => layer.name), [
      "proteger",
      "somenteAdmin",
    ]);
  }
  assert.deepEqual(logisticaRouter.stack.slice(0, 2).map((layer) => layer.name), [
    "proteger",
    "somenteOperacaoLogistica",
  ]);
  assert.deepEqual(marketingRouter.stack.slice(0, 2).map((layer) => layer.name), [
    "proteger",
    "somenteGestorConteudo",
  ]);

  for (const [path, method] of [
    ["/", "get"],
    ["/:id/aprovar", "patch"],
    ["/:id", "put"],
    ["/:id/status", "put"],
  ]) {
    const route = findRoute(pedidoRouter, path, method);
    assert.deepEqual(middlewareNames(route).slice(0, 2), ["proteger", "somenteAdmin"]);
  }
});

test("API preserva 401 sem autenticação antes de avaliar a permissão", async () => {
  const response = createResponse();
  let allowed = false;
  await proteger({ headers: {} }, response, () => { allowed = true; });
  assert.equal(response.statusCode, 401);
  assert.equal(allowed, false);
});

test("criação do usuário Comercial segue o fluxo interno protegido por confirmação", () => {
  const script = readFileSync(new URL("../src/scripts/criarComercial.js", import.meta.url), "utf8");
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  assert.match(script, /confirmationVariable: "CONFIRM_CREATE_COMERCIAL"/);
  assert.match(script, /COMERCIAL_EMAIL/);
  assert.match(script, /COMERCIAL_PASSWORD/);
  assert.match(script, /tipo: "comercial"/);
  assert.match(script, /statusCadastro: "aprovado"/);
  assert.equal(packageJson.scripts["user:create-comercial"], "node src/scripts/criarComercial.js");
});
