import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import Usuario from "../src/models/Usuario.js";
import Treinamento from "../src/models/Treinamento.js";
import ProgressoTreinamento from "../src/models/ProgressoTreinamento.js";
import { cadastrarGroomer, login } from "../src/controllers/authController.js";
import {
  buscarTreinamentoCliente,
  atualizarProgresso,
} from "../src/controllers/treinamentoController.js";
import {
  buscarMaterialCliente,
} from "../src/controllers/materialMarketingController.js";
import MaterialMarketing from "../src/models/MaterialMarketing.js";
import {
  validateCadastroGroomerPayload,
} from "../src/utils/cadastroValidation.js";
import {
  buildContentAudienceFilter,
  validateContentAudiencePayload,
} from "../src/utils/contentAudience.js";
import { validateMaterialPayload } from "../src/utils/materialMarketingValidation.js";
import { validateTrainingPayload } from "../src/utils/trainingValidation.js";
import { validateAdminClientUpdate } from "../src/controllers/clienteController.js";
import {
  cadastroExternoBloqueiaAcesso,
} from "../src/utils/userAccess.js";
import {
  somenteCliente,
  somentePublicoConteudo,
} from "../src/middlewares/clienteMiddleware.js";
import materialRouter from "../src/routes/materialMarketingRoutes.js";
import trainingRouter from "../src/routes/treinamentoRoutes.js";

const userId = new mongoose.Types.ObjectId();
const contentId = new mongoose.Types.ObjectId();

const validGroomer = {
  nomeResponsavel: "Marina Souza",
  email: "marina@example.com",
  whatsapp: "(11) 98765-4321",
  cnpj: "529.982.247-25",
  cidade: "São Paulo",
  estado: "sp",
  nomeProfissional: "Marina Grooming",
  instagram: "@marinagrooming",
  tiktok: "@marinagrooming",
  observacaoCadastro: "Atende cães de pequeno porte.",
  senha: "senha-segura",
  confirmarSenha: "senha-segura",
};

const validTraining = {
  titulo: "Técnicas de finalização",
  resumo: "Cuidados para uma finalização segura.",
  categoria: "Técnicas de Banho e Tosa",
  provider: "youtube",
  videoId: "dQw4w9WgXcQ",
  publicadoEm: "2026-08-19T12:00:00.000Z",
};

const validMaterial = {
  titulo: "Campanha Groomer",
  categoria: "Campanhas",
  tipo: "Imagem",
  linkExterno: "https://drive.google.com/file/d/abc/view",
};

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const leanQuery = (value) => ({
  select() { return this; },
  lean: async () => value,
});

test("schema inclui Groomer sem remover papéis existentes e mantém campos profissionais", () => {
  assert.deepEqual(Usuario.schema.path("tipo").enumValues, [
    "admin", "comercial", "marketing", "logistica", "cliente", "groomer",
  ]);
  for (const field of [
    "cidade", "estado", "nomeProfissional", "instagram", "tiktok", "observacaoCadastro",
  ]) {
    assert.ok(Usuario.schema.path(field));
  }
});

test("cadastro Groomer exige contato e localização, mas mantém CPF/CNPJ opcional", () => {
  const valid = validateCadastroGroomerPayload(validGroomer);
  assert.equal(valid.valid, true);
  assert.equal(valid.data.cnpj, "52998224725");
  assert.equal(valid.data.whatsapp, "11987654321");
  assert.equal(valid.data.estado, "SP");

  const withoutDocument = validateCadastroGroomerPayload({ ...validGroomer, cnpj: "" });
  assert.equal(withoutDocument.valid, true);
  assert.equal(withoutDocument.data.cnpj, "");

  const missing = validateCadastroGroomerPayload({
    ...validGroomer,
    whatsapp: "",
    cidade: "",
    estado: "",
  });
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.whatsapp);
  assert.ok(missing.errors.cidade);
  assert.ok(missing.errors.estado);
});

test("endpoint público cria Groomer pendente, normalizado e sem tabela", async (t) => {
  const originalFind = Usuario.find;
  const originalCreate = Usuario.create;
  let created;
  Usuario.find = () => ({ select() { return this; }, lean: async () => [] });
  Usuario.create = async (payload) => {
    created = payload;
    return { _id: userId, ...payload };
  };
  t.after(() => {
    Usuario.find = originalFind;
    Usuario.create = originalCreate;
  });

  const response = createResponse();
  await cadastrarGroomer({ body: validGroomer }, response);

  assert.equal(response.statusCode, 201);
  assert.equal(created.tipo, "groomer");
  assert.equal(created.statusCadastro, "pendente");
  assert.equal(created.estado, "SP");
  assert.equal(Object.hasOwn(created, "tabelaPrecoId"), false);
  assert.notEqual(created.senha, validGroomer.senha);
});

test("duplicidade de e-mail é aplicada também ao cadastro Groomer", async (t) => {
  const originalFind = Usuario.find;
  const originalCreate = Usuario.create;
  let createCalled = false;
  Usuario.find = () => ({
    select() { return this; },
    lean: async () => [{ email: validGroomer.email, cnpj: "" }],
  });
  Usuario.create = async () => { createCalled = true; };
  t.after(() => {
    Usuario.find = originalFind;
    Usuario.create = originalCreate;
  });

  const response = createResponse();
  await cadastrarGroomer({ body: { ...validGroomer, cnpj: "" } }, response);
  assert.equal(response.statusCode, 409);
  assert.match(response.body.errors.email, /já está cadastrado/);
  assert.equal(createCalled, false);
});

test("Groomer pendente ou rejeitado não autentica; aprovado e ativo autentica", async (t) => {
  assert.equal(cadastroExternoBloqueiaAcesso({ tipo: "groomer", statusCadastro: "pendente" }), true);
  assert.equal(cadastroExternoBloqueiaAcesso({ tipo: "groomer", statusCadastro: "reprovado" }), true);
  assert.equal(cadastroExternoBloqueiaAcesso({ tipo: "groomer", statusCadastro: "aprovado" }), false);

  const originalFindOne = Usuario.findOne;
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "segredo-groomer-com-mais-de-trinta-e-dois-caracteres";
  const user = {
    _id: userId,
    nomeResponsavel: "Marina Souza",
    email: validGroomer.email,
    senha: await bcrypt.hash(validGroomer.senha, 10),
    tipo: "groomer",
    statusCadastro: "aprovado",
    ativo: true,
    tokenVersion: 0,
    async save() {},
  };
  Usuario.findOne = async () => user;
  t.after(() => {
    Usuario.findOne = originalFindOne;
    process.env.JWT_SECRET = originalSecret;
  });

  for (const statusCadastro of ["pendente", "reprovado"]) {
    user.statusCadastro = statusCadastro;
    const blocked = createResponse();
    await login({ body: { email: user.email, senha: validGroomer.senha } }, blocked);
    assert.equal(blocked.statusCode, 403);
    assert.match(blocked.body.message, /não aprovado/);
  }

  user.statusCadastro = "aprovado";
  user.ativo = false;
  const inactive = createResponse();
  await login({ body: { email: user.email, senha: validGroomer.senha } }, inactive);
  assert.equal(inactive.statusCode, 403);

  user.ativo = true;
  const approved = createResponse();
  await login({ body: { email: user.email, senha: validGroomer.senha } }, approved);
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.body.usuario.tipo, "groomer");
  assert.ok(approved.body.token);
});

test("Groomer acessa conteúdo, mas continua bloqueado das rotas exclusivas de cliente", () => {
  const allowed = createResponse();
  let contentCalled = false;
  somentePublicoConteudo({ usuario: { tipo: "groomer" } }, allowed, () => {
    contentCalled = true;
  });
  assert.equal(contentCalled, true);

  const denied = createResponse();
  let clientCalled = false;
  somenteCliente({ usuario: { tipo: "groomer" } }, denied, () => { clientCalled = true; });
  assert.equal(denied.statusCode, 403);
  assert.equal(clientCalled, false);

  assert.deepEqual(materialRouter.stack.slice(0, 2).map((layer) => layer.name), [
    "proteger", "somentePublicoConteudo",
  ]);
  assert.deepEqual(trainingRouter.stack.slice(0, 2).map((layer) => layer.name), [
    "proteger", "somentePublicoConteudo",
  ]);
});

test("Groomer não aceita tabela nem campos comerciais na edição administrativa", () => {
  const invalid = validateAdminClientUpdate({
    tabelaPrecoId: String(new mongoose.Types.ObjectId()),
    razaoSocial: "Campo indevido",
  }, "groomer");
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.campos, /tabelaPrecoId/);

  const valid = validateAdminClientUpdate({
    cidade: " Campinas ",
    estado: "sp",
    nomeProfissional: " Studio Pet ",
  }, "groomer");
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.data, {
    cidade: "Campinas",
    estado: "SP",
    nomeProfissional: "Studio Pet",
  });
});

test("audiência nova é explícita e documentos antigos permanecem exclusivos de distribuidores", () => {
  const groomerFilter = buildContentAudienceFilter({ tipo: "groomer", _id: userId });
  assert.deepEqual(groomerFilter, { publicos: "groomer" });

  const clientFilter = buildContentAudienceFilter({ tipo: "cliente", _id: userId });
  const profileFallback = clientFilter.$and[0].$or;
  assert.ok(profileFallback.some((condition) => condition.publicos?.$exists === false));
  assert.ok(profileFallback.some((condition) => condition.publicos === "cliente"));

  const legacyCreate = validateContentAudiencePayload({});
  assert.deepEqual(legacyCreate.data.publicos, ["cliente"]);
  const both = validateContentAudiencePayload({
    publicos: ["cliente", "groomer"],
    audienciaTipo: "todos",
  });
  assert.deepEqual(both.data.publicos, ["cliente", "groomer"]);
});

test("materiais e treinamentos persistem público e validam distribuidor específico", () => {
  const material = validateMaterialPayload({
    ...validMaterial,
    publicos: JSON.stringify(["groomer"]),
    audienciaTipo: "especificos",
  });
  assert.equal(material.valid, true);
  assert.deepEqual(material.data.publicos, ["groomer"]);
  assert.equal(material.data.audienciaTipo, "todos");

  const training = validateTrainingPayload({
    ...validTraining,
    publicos: ["cliente", "groomer"],
    audienciaTipo: "especificos",
    distribuidoresIds: [String(userId)],
  });
  assert.equal(training.valid, true);
  assert.deepEqual(training.data.publicos, ["cliente", "groomer"]);
  assert.deepEqual(training.data.distribuidoresIds, [String(userId)]);
});

test("consulta individual de material aplica a audiência Groomer no banco", async (t) => {
  const originalFindOne = MaterialMarketing.findOne;
  let receivedFilter;
  MaterialMarketing.findOne = (filter) => {
    receivedFilter = filter;
    return leanQuery({ _id: contentId, titulo: "Material" });
  };
  t.after(() => { MaterialMarketing.findOne = originalFindOne; });

  const response = createResponse();
  await buscarMaterialCliente({
    params: { id: String(contentId) },
    usuario: { _id: userId, tipo: "groomer" },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.ok(receivedFilter.$and.some((condition) => condition.publicos === "groomer"));
});

test("detalhe e progresso de treinamento repetem a autorização por audiência", async (t) => {
  const originalTrainingFindOne = Treinamento.findOne;
  const originalProgressFindOne = ProgressoTreinamento.findOne;
  const originalUpdate = ProgressoTreinamento.findOneAndUpdate;
  const filters = [];
  Treinamento.findOne = (filter) => {
    filters.push(filter);
    return leanQuery({
      _id: contentId,
      titulo: "Treinamento",
      provider: "youtube",
      videoId: "dQw4w9WgXcQ",
      duracaoSegundos: 100,
    });
  };
  ProgressoTreinamento.findOne = () => leanQuery(null);
  ProgressoTreinamento.findOneAndUpdate = () => leanQuery({
    percentualAssistido: 20,
    concluido: false,
  });
  t.after(() => {
    Treinamento.findOne = originalTrainingFindOne;
    ProgressoTreinamento.findOne = originalProgressFindOne;
    ProgressoTreinamento.findOneAndUpdate = originalUpdate;
  });

  const usuario = { _id: userId, tipo: "groomer", nomeResponsavel: "Marina" };
  const detailResponse = createResponse();
  await buscarTreinamentoCliente({ params: { id: String(contentId) }, usuario }, detailResponse);
  assert.equal(detailResponse.statusCode, 200);

  const progressResponse = createResponse();
  await atualizarProgresso({
    params: { id: String(contentId) },
    usuario,
    body: { posicaoSegundos: 20, duracaoSegundos: 100 },
  }, progressResponse);
  assert.equal(progressResponse.statusCode, 200);
  assert.equal(filters.length, 2);
  for (const filter of filters) {
    assert.ok(filter.$and.some((condition) => condition.publicos === "groomer"));
  }
});

test("catálogo, pedidos e preços bloqueiam Groomer explicitamente no backend", () => {
  const catalog = readFileSync(new URL("../src/routes/catalogoRoutes.js", import.meta.url), "utf8");
  const orders = readFileSync(new URL("../src/routes/pedidoRoutes.js", import.meta.url), "utf8");
  assert.match(catalog, /proteger, somenteCliente, listarCatalogoCliente/);
  assert.match(catalog, /proteger, somenteCliente, listarPrecosClienteFinal/);
  assert.match(orders, /somenteClienteOuAdmin/);

  for (const relativePath of [
    "../src/routes/precoProdutoRoutes.js",
    "../src/routes/tabelaPrecoRoutes.js",
    "../src/routes/produtoRoutes.js",
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, /somenteGestorComercial|somenteAdmin/);
    assert.doesNotMatch(source, /somentePublicoConteudo/);
  }
});
