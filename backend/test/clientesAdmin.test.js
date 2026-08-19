import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import mongoose from "mongoose";
import Usuario from "../src/models/Usuario.js";
import TabelaPreco from "../src/models/TabelaPreco.js";
import {
  aprovarCliente,
  atualizarClienteAdmin,
  criarPipelineClientes,
  inativarCliente,
  obterClienteAdmin,
  reativarCliente,
  rejeitarCliente,
  validateAdminClientUpdate,
} from "../src/controllers/clienteController.js";
import { somenteAdmin } from "../src/middlewares/adminMiddleware.js";
import clienteRouter from "../src/routes/clienteRoutes.js";

const clientId = new mongoose.Types.ObjectId();
const tableId = new mongoose.Types.ObjectId();

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const createClientDocument = (overrides = {}) => {
  const document = {
    _id: clientId,
    tipo: "cliente",
    nomeResponsavel: "Ana Lima",
    email: "ana@example.com",
    cnpj: "12345678000199",
    tabelaPrecoId: tableId,
    statusCadastro: "aprovado",
    ativo: true,
    tokenVersion: 2,
    saveCalls: 0,
    async save() { this.saveCalls += 1; },
    async populate() {
      if (this.tabelaPrecoId) {
        this.tabelaPrecoId = {
          _id: this.tabelaPrecoId._id || this.tabelaPrecoId,
          nome: "Distribuidor A",
          tipo: "distribuidor",
          ativa: true,
        };
      }
    },
    toObject() {
      const result = { ...this };
      delete result.save;
      delete result.populate;
      delete result.toObject;
      return result;
    },
    ...overrides,
  };
  return document;
};

test("schema preserva aprovação, acesso e data de aprovação como conceitos separados", () => {
  assert.deepEqual(
    Usuario.schema.path("statusCadastro").enumValues,
    ["pendente", "aprovado", "reprovado", "inativo"]
  );
  assert.equal(Usuario.schema.path("ativo").defaultValue, true);
  assert.ok(Usuario.schema.path("aprovadoEm") instanceof mongoose.SchemaType);
});

test("validação aceita somente dados cadastrais editáveis e normaliza espaços", () => {
  const result = validateAdminClientUpdate({
    nomeResponsavel: "  Ana Lima  ",
    razaoSocial: "  Pet Comércio Ltda  ",
    nomeFantasia: "  Pet Centro  ",
    telefone: "  1133334444  ",
    whatsapp: "  11999998888  ",
    tabelaPrecoId: String(tableId),
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.data, {
    nomeResponsavel: "Ana Lima",
    razaoSocial: "Pet Comércio Ltda",
    nomeFantasia: "Pet Centro",
    telefone: "1133334444",
    whatsapp: "11999998888",
    tabelaPrecoId: String(tableId),
  });
});

test("validação bloqueia e-mail, CNPJ, senha, papel, aprovação e acesso", () => {
  const result = validateAdminClientUpdate({
    email: "forjado@example.com",
    cnpj: "00000000000000",
    senha: "segredo",
    tipo: "admin",
    statusCadastro: "aprovado",
    ativo: false,
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.campos, /email/);
  assert.match(result.errors.campos, /senha/);
  assert.match(result.errors.campos, /statusCadastro/);
});

test("validação rejeita payload vazio, responsável vazio e tabela inválida", () => {
  assert.equal(validateAdminClientUpdate({}).valid, false);
  assert.equal(validateAdminClientUpdate({ nomeResponsavel: "   " }).valid, false);
  assert.equal(validateAdminClientUpdate({ tabelaPrecoId: "tabela-invalida" }).valid, false);
});

test("rotas de clientes mantêm proteção administrativa global e expõem detalhe e PATCH", () => {
  assert.deepEqual(
    clienteRouter.stack.slice(0, 2).map((layer) => layer.name),
    ["proteger", "somenteAdmin"]
  );
  assert.equal(typeof clienteRouter.stack[2].handle, "function");
  const detail = clienteRouter.stack.find((layer) => (
    layer.route?.path === "/:id" && layer.route.methods.get
  ));
  const update = clienteRouter.stack.find((layer) => (
    layer.route?.path === "/:id" && layer.route.methods.patch
  ));
  assert.ok(detail);
  assert.ok(update);
  assert.equal(detail.route.stack.at(-1).name, "obterClienteAdmin");
  assert.equal(update.route.stack.at(-1).name, "atualizarClienteAdmin");
});

test("cliente, marketing e logística não passam pela autorização administrativa", () => {
  for (const tipo of ["cliente", "marketing", "logistica"]) {
    const response = createResponse();
    let called = false;
    somenteAdmin(
      { usuario: { tipo } },
      response,
      () => { called = true; }
    );
    assert.equal(response.statusCode, 403);
    assert.equal(called, false);
  }
});

test("detalhe devolve cliente e tabela sem senha nem versão de token", async (t) => {
  const originalFindById = Usuario.findById;
  const document = createClientDocument();
  let projection;
  Usuario.findById = () => ({
    async select(nextProjection) {
      projection = nextProjection;
      return document;
    },
  });
  t.after(() => { Usuario.findById = originalFindById; });

  const response = createResponse();
  await obterClienteAdmin({ params: { id: String(clientId) } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(projection, "-senha -tokenVersion");
  assert.equal(response.body.cliente.tabelaPrecoId.nome, "Distribuidor A");
  assert.equal(Object.hasOwn(response.body.cliente, "tokenVersion"), false);
  assert.equal(Object.hasOwn(response.body.cliente, "senha"), false);
});

test("PATCH persiste tabela ativa de distribuidor sem alterar aprovação ou acesso", async (t) => {
  const originalUserFind = Usuario.findById;
  const originalTableFind = TabelaPreco.findOne;
  const document = createClientDocument({ tabelaPrecoId: new mongoose.Types.ObjectId() });
  let tableFilter;
  Usuario.findById = async () => document;
  TabelaPreco.findOne = (filter) => {
    tableFilter = filter;
    return { select: async () => ({ _id: tableId }) };
  };
  t.after(() => {
    Usuario.findById = originalUserFind;
    TabelaPreco.findOne = originalTableFind;
  });

  const response = createResponse();
  await atualizarClienteAdmin({
    params: { id: String(clientId) },
    body: { tabelaPrecoId: String(tableId), nomeFantasia: "Nova Fantasia" },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(document.nomeFantasia, "Nova Fantasia");
  assert.equal(document.statusCadastro, "aprovado");
  assert.equal(document.ativo, true);
  assert.equal(document.saveCalls, 1);
  assert.equal(tableFilter.ativa.$ne, false);
  assert.equal(tableFilter.$or[0].tipo, "distribuidor");
});

test("PATCH não salva tabela inexistente, inativa ou destinada ao consumidor final", async (t) => {
  const originalUserFind = Usuario.findById;
  const originalTableFind = TabelaPreco.findOne;
  const document = createClientDocument();
  Usuario.findById = async () => document;
  TabelaPreco.findOne = () => ({ select: async () => null });
  t.after(() => {
    Usuario.findById = originalUserFind;
    TabelaPreco.findOne = originalTableFind;
  });

  const response = createResponse();
  await atualizarClienteAdmin({
    params: { id: String(clientId) },
    body: { tabelaPrecoId: String(new mongoose.Types.ObjectId()) },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /não existe|não está disponível/);
  assert.equal(document.saveCalls, 0);
});

test("aprovação exige tabela disponível, registra a data e mantém retorno completo", async (t) => {
  const originalExists = TabelaPreco.exists;
  const originalFindById = Usuario.findById;
  const document = createClientDocument({
    statusCadastro: "pendente",
    ativo: false,
    aprovadoEm: undefined,
  });
  let tableFilter;
  TabelaPreco.exists = async (filter) => {
    tableFilter = filter;
    return { _id: tableId };
  };
  Usuario.findById = async () => document;
  t.after(() => {
    TabelaPreco.exists = originalExists;
    Usuario.findById = originalFindById;
  });

  const response = createResponse();
  await aprovarCliente({
    params: { id: String(clientId) },
    body: { tabelaPrecoId: String(tableId) },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(tableFilter.ativa.$ne, false);
  assert.equal(document.statusCadastro, "aprovado");
  assert.equal(document.ativo, true);
  assert.ok(document.aprovadoEm instanceof Date);
  assert.equal(response.body.cliente.tabelaPrecoId.nome, "Distribuidor A");
});

test("aprovação falha sem falsa confirmação quando a tabela está indisponível", async (t) => {
  const originalExists = TabelaPreco.exists;
  const originalFindById = Usuario.findById;
  const document = createClientDocument({ statusCadastro: "pendente" });
  let userLookup = false;
  TabelaPreco.exists = async () => null;
  Usuario.findById = async () => { userLookup = true; return document; };
  t.after(() => {
    TabelaPreco.exists = originalExists;
    Usuario.findById = originalFindById;
  });

  const response = createResponse();
  await aprovarCliente({
    params: { id: String(clientId) },
    body: { tabelaPrecoId: String(tableId) },
  }, response);
  assert.equal(response.statusCode, 400);
  assert.equal(userLookup, true);
  assert.match(response.body.message, /inválida|indisponível/);
  assert.equal(document.saveCalls, 0);
});

test("desativação revoga acesso sem apagar ou rebaixar a aprovação", async (t) => {
  const originalFindById = Usuario.findById;
  const document = createClientDocument();
  Usuario.findById = async () => document;
  t.after(() => { Usuario.findById = originalFindById; });

  const response = createResponse();
  await inativarCliente({ params: { id: String(clientId) } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(document.statusCadastro, "aprovado");
  assert.equal(document.ativo, false);
  assert.equal(document.tokenVersion, 3);
  assert.equal(document.saveCalls, 1);
});

test("reativação normaliza cadastro legado inativo e preserva compatibilidade", async (t) => {
  const originalFindById = Usuario.findById;
  const document = createClientDocument({ statusCadastro: "inativo", ativo: false });
  Usuario.findById = async () => document;
  t.after(() => { Usuario.findById = originalFindById; });

  const response = createResponse();
  await reativarCliente({ params: { id: String(clientId) } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(document.statusCadastro, "aprovado");
  assert.equal(document.ativo, true);
  assert.equal(document.tokenVersion, 3);
});

test("cadastro pendente não pode ser desativado como se já estivesse aprovado", async (t) => {
  const originalFindById = Usuario.findById;
  const document = createClientDocument({ statusCadastro: "pendente" });
  Usuario.findById = async () => document;
  t.after(() => { Usuario.findById = originalFindById; });

  const response = createResponse();
  await inativarCliente({ params: { id: String(clientId) } }, response);
  assert.equal(response.statusCode, 409);
  assert.equal(document.saveCalls, 0);
});

test("listagem mantém tabela populada, aprovação, acesso e campos legados", () => {
  const pipeline = criarPipelineClientes();
  assert.deepEqual(pipeline[0], {
    $match: { tipo: { $in: ["cliente", "groomer"] } },
  });
  const setStage = pipeline.find((stage) => stage.$set).$set;
  assert.ok(setStage.tabelaPrecoId);
  assert.deepEqual(setStage.ativo, { $ifNull: ["$ativo", true] });
  assert.deepEqual(setStage.statusCadastro, { $ifNull: ["$statusCadastro", "pendente"] });
  assert.deepEqual(pipeline.at(-1).$unset, ["senha", "tokenVersion", "tabelaPrecoRelacionada"]);
});

test("Groomer é aprovado sem tabela e cadastro pendente pode ser rejeitado", async (t) => {
  const originalFindById = Usuario.findById;
  const groomer = createClientDocument({
    tipo: "groomer",
    statusCadastro: "pendente",
    ativo: false,
    tabelaPrecoId: undefined,
  });
  Usuario.findById = async () => groomer;
  t.after(() => { Usuario.findById = originalFindById; });

  const approval = createResponse();
  await aprovarCliente({ params: { id: String(clientId) }, body: {} }, approval);
  assert.equal(approval.statusCode, 200);
  assert.equal(groomer.statusCadastro, "aprovado");
  assert.equal(groomer.ativo, true);
  assert.equal(Object.hasOwn(approval.body.cliente, "tabelaPrecoId"), false);

  groomer.statusCadastro = "pendente";
  const rejection = createResponse();
  await rejeitarCliente({ params: { id: String(clientId) } }, rejection);
  assert.equal(rejection.statusCode, 200);
  assert.equal(groomer.statusCadastro, "reprovado");
  assert.equal(groomer.ativo, false);
});

test("catálogo futuro usa a tabela atual e pedido grava preços em snapshot imutável", () => {
  const catalog = readFileSync(
    new URL("../src/controllers/catalogoController.js", import.meta.url),
    "utf8"
  );
  const order = readFileSync(
    new URL("../src/controllers/pedidoController.js", import.meta.url),
    "utf8"
  );
  const model = readFileSync(new URL("../src/models/Pedido.js", import.meta.url), "utf8");
  const pdf = readFileSync(new URL("../src/services/pdfService.js", import.meta.url), "utf8");

  assert.match(catalog, /tabelaPrecoId: usuario\.tabelaPrecoId/);
  assert.match(order, /Usuario\.findById\(req\.usuario\._id\)/);
  assert.match(order, /TabelaPreco\.findById\(cliente\.tabelaPrecoId\)/);
  assert.match(order, /tabelaPrecoId: cliente\.tabelaPrecoId/);
  assert.match(order, /valorUnitario/);
  assert.match(order, /valorTotal/);
  assert.match(model, /nomeTabela/);
  assert.match(pdf, /item\.valorUnitario/);
  assert.match(pdf, /pedido\.valorTotal/);
  assert.doesNotMatch(pdf, /PrecoProduto|TabelaPreco/);
});

test("login e middleware protegido continuam recusando cliente desativado", () => {
  const login = readFileSync(
    new URL("../src/controllers/authController.js", import.meta.url),
    "utf8"
  );
  const auth = readFileSync(
    new URL("../src/middlewares/authMiddleware.js", import.meta.url),
    "utf8"
  );
  assert.match(login, /if \(!usuario\.ativo\)/);
  assert.match(auth, /if \(!req\.usuario\.ativo\)/);
  assert.match(auth, /Usuário desativado/);
});
