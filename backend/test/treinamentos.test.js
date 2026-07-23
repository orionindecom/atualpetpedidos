import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import Usuario from "../src/models/Usuario.js";
import Treinamento from "../src/models/Treinamento.js";
import ProgressoTreinamento from "../src/models/ProgressoTreinamento.js";
import adminRouter from "../src/routes/adminTreinamentoRoutes.js";
import clientRouter from "../src/routes/treinamentoRoutes.js";
import { proteger } from "../src/middlewares/authMiddleware.js";
import { somenteAdmin } from "../src/middlewares/adminMiddleware.js";
import { somenteCliente } from "../src/middlewares/clienteMiddleware.js";
import {
  alterarStatusTreinamento,
  atualizarProgresso,
  atualizarTreinamento,
  buscarTreinamentoCliente,
  buildClientTrainingPipeline,
  criarTreinamento,
} from "../src/controllers/treinamentoController.js";
import {
  buildTrainingFilter,
  extractYouTubeVideoId,
  parseTrainingQuery,
  TRAINING_COMPLETION_THRESHOLD,
  TRAINING_SORT,
  validateProgressPayload,
  validateTrainingPayload,
} from "../src/utils/trainingValidation.js";

const objectId = "507f1f77bcf86cd799439011";
const trainingId = "507f1f77bcf86cd799439012";

const validPayload = {
  titulo: "Treinamento Linha Zoom",
  descricao: "Conteúdo completo do treinamento",
  resumo: "Conheça a aplicação correta dos produtos.",
  categoria: "Aplicação de Produtos",
  marca: "AtualPet",
  linha: "Zoom",
  instrutor: "Equipe Técnica",
  duracaoSegundos: 600,
  provider: "youtube",
  videoId: "dQw4w9WgXcQ",
  thumbnailUrl: "https://images.example.com/training.jpg",
  destaque: true,
  obrigatorio: false,
  ordem: 1,
  ativo: true,
  publicadoEm: "2026-07-22T12:00:00.000Z",
};

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const leanQuery = (value) => ({
  select() { return this; },
  lean: async () => value,
});

test("rotas do cliente exigem autenticacao e perfil cliente", async () => {
  const res = createResponse();
  let nextCalled = false;
  await proteger({ headers: {} }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);

  const adminResponse = createResponse();
  somenteCliente({ usuario: { tipo: "admin" } }, adminResponse, () => {});
  assert.equal(adminResponse.statusCode, 403);
  assert.deepEqual(clientRouter.stack.slice(0, 2).map((layer) => layer.name), [
    "proteger",
    "somenteCliente",
  ]);
});

test("cliente nao aprovado e interrompido pelo middleware", async (t) => {
  const originalSecret = process.env.JWT_SECRET;
  const originalFindById = Usuario.findById;
  const secret = "segredo-de-testes-com-mais-de-trinta-e-dois-caracteres";
  process.env.JWT_SECRET = secret;
  Usuario.findById = () => ({
    select: async () => ({
      _id: objectId,
      tipo: "cliente",
      ativo: true,
      statusCadastro: "pendente",
      tokenVersion: 0,
    }),
  });
  t.after(() => {
    Usuario.findById = originalFindById;
    process.env.JWT_SECRET = originalSecret;
  });

  const token = jwt.sign(
    { id: objectId, tipo: "cliente", tokenVersion: 0 },
    secret,
    { algorithm: "HS256", expiresIn: "5m" }
  );
  const res = createResponse();
  let nextCalled = false;
  await proteger(
    { headers: { authorization: `Bearer ${token}` } },
    res,
    () => { nextCalled = true; }
  );

  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test("cliente nao acessa rotas administrativas", () => {
  const res = createResponse();
  let nextCalled = false;
  somenteAdmin({ usuario: { tipo: "cliente" } }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
  assert.deepEqual(adminRouter.stack.slice(0, 2).map((layer) => layer.name), [
    "proteger",
    "somenteAdmin",
  ]);
});

test("extrai somente IDs validos dos formatos permitidos", () => {
  assert.equal(extractYouTubeVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(
    extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    "dQw4w9WgXcQ"
  );
  assert.equal(
    extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ"),
    "dQw4w9WgXcQ"
  );
  assert.equal(
    extractYouTubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ"),
    "dQw4w9WgXcQ"
  );
});

test("recusa dominio arbitrario, protocolo inseguro, HTML e ID malformado", () => {
  assert.equal(extractYouTubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(extractYouTubeVideoId("http://youtube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(extractYouTubeVideoId("javascript:alert(1)"), null);
  assert.equal(extractYouTubeVideoId("<iframe src='youtube'></iframe>"), null);
  assert.equal(extractYouTubeVideoId("id-curto"), null);
});

test("validacao normaliza videoId e ignora campos desconhecidos", () => {
  const result = validateTrainingPayload({
    ...validPayload,
    videoId: "https://youtu.be/dQw4w9WgXcQ",
    criadoPor: "forjado",
    admin: true,
    tokenVersion: 9,
  }, { nodeEnv: "production" });

  assert.equal(result.valid, true);
  assert.equal(result.data.videoId, "dQw4w9WgXcQ");
  assert.equal(Object.hasOwn(result.data, "criadoPor"), false);
  assert.equal(Object.hasOwn(result.data, "admin"), false);
  assert.equal(Object.hasOwn(result.data, "tokenVersion"), false);

  const empty = validateTrainingPayload(null, { nodeEnv: "production" });
  assert.equal(empty.valid, false);
  assert.ok(empty.errors.titulo);
  assert.ok(empty.errors.categoria);
  assert.ok(empty.errors.videoId);
});

test("busca, filtros, publicacao, limite e ordenacao sao seguros", () => {
  const now = new Date("2026-07-22T12:00:00.000Z");
  const query = parseTrainingQuery({
    busca: "Zoom (Técnico)",
    categoria: "Produtos",
    destaque: "true",
    obrigatorio: "false",
  });
  const filter = buildTrainingFilter(query, { onlyAvailable: true, now });

  assert.equal(filter.ativo, true);
  assert.deepEqual(filter.publicadoEm, { $ne: null, $lte: now });
  assert.equal(filter.$or.length, 7);
  assert.equal(filter.$or[0].titulo.test("Zoom (Técnico)"), true);
  assert.equal(parseTrainingQuery({ limite: "101" }), null);
  assert.deepEqual(TRAINING_SORT, {
    destaque: -1,
    obrigatorio: -1,
    ordem: 1,
    publicadoEm: -1,
    _id: 1,
  });
});

test("listagem do cliente nao projeta videoId", () => {
  const query = parseTrainingQuery({ pagina: "1", limite: "12" });
  const pipeline = buildClientTrainingPipeline({
    filter: { ativo: true },
    query,
    usuarioId: objectId,
  });
  const facet = pipeline.find((stage) => stage.$facet)?.$facet;
  const projection = facet.treinamentos.find((stage) => stage.$project).$project;

  assert.equal(Object.hasOwn(projection, "videoId"), false);
  assert.equal(projection.progresso, 1);
  assert.ok(pipeline.find((stage) => stage.$sort));
});

test("detalhe autorizado retorna videoId e progresso", async (t) => {
  const originalTrainingFindOne = Treinamento.findOne;
  const originalProgressFindOne = ProgressoTreinamento.findOne;
  Treinamento.findOne = () => leanQuery({
    _id: trainingId,
    titulo: "Treinamento",
    provider: "youtube",
    videoId: "dQw4w9WgXcQ",
  });
  ProgressoTreinamento.findOne = () => leanQuery(null);
  t.after(() => {
    Treinamento.findOne = originalTrainingFindOne;
    ProgressoTreinamento.findOne = originalProgressFindOne;
  });

  const res = createResponse();
  await buscarTreinamentoCliente(
    {
      params: { id: trainingId },
      usuario: {
        _id: objectId,
        nomeResponsavel: "Maria Silva",
        nomeFantasia: "Pet Center",
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.treinamento.videoId, "dQw4w9WgXcQ");
  assert.equal(res.body.treinamento.progresso.concluido, false);
  assert.deepEqual(res.body.treinamento.identificacaoAcesso, {
    nomeResponsavel: "Maria Silva",
    nomeFantasia: "Pet Center",
    id: "439011",
  });
});

test("administrador cria e edita treinamento com autoria controlada", async (t) => {
  const originalCreate = Treinamento.create;
  const originalFindById = Treinamento.findById;
  let created;
  Treinamento.create = async (payload) => {
    created = payload;
    return { _id: trainingId, ...payload };
  };
  const document = { titulo: "Antigo", save: async () => {} };
  Treinamento.findById = async () => document;
  t.after(() => {
    Treinamento.create = originalCreate;
    Treinamento.findById = originalFindById;
  });

  const createRes = createResponse();
  await criarTreinamento(
    { body: { ...validPayload, criadoPor: "forjado" }, usuario: { _id: objectId } },
    createRes
  );
  assert.equal(createRes.statusCode, 201);
  assert.equal(created.criadoPor, objectId);

  const updateRes = createResponse();
  await atualizarTreinamento(
    {
      params: { id: trainingId },
      body: { titulo: "Novo", criadoPor: "forjado", provider: "youtube" },
      usuario: { _id: objectId },
    },
    updateRes
  );
  assert.equal(updateRes.statusCode, 200);
  assert.equal(document.titulo, "Novo");
  assert.equal(document.atualizadoPor, objectId);
  assert.equal(Object.hasOwn(document, "criadoPor"), false);
});

test("administrador ativa e desativa treinamento", async (t) => {
  const originalFindById = Treinamento.findById;
  const document = { ativo: true, save: async () => {} };
  Treinamento.findById = async () => document;
  t.after(() => { Treinamento.findById = originalFindById; });

  const disableResponse = createResponse();
  await alterarStatusTreinamento(
    {
      params: { id: trainingId },
      body: { ativo: false },
      usuario: { _id: objectId },
    },
    disableResponse
  );
  assert.equal(disableResponse.statusCode, 200);
  assert.equal(document.ativo, false);
  assert.equal(document.atualizadoPor, objectId);
});

test("percentual e conclusao sao calculados no backend e limitados a 100", () => {
  const progress = validateProgressPayload({
    posicaoSegundos: 540,
    duracaoSegundos: 600,
    concluido: false,
  });
  const complete = validateProgressPayload({
    posicaoSegundos: 610,
    duracaoSegundos: 600,
  });

  assert.equal(TRAINING_COMPLETION_THRESHOLD, 90);
  assert.equal(progress.data.percentualAssistido, 90);
  assert.equal(progress.data.concluido, true);
  assert.equal(complete.data.percentualAssistido, 100);
});

test("progresso usa upsert, maximos e nao apaga conclusao em regressao", async (t) => {
  const originalTrainingFindOne = Treinamento.findOne;
  const originalFindOneAndUpdate = ProgressoTreinamento.findOneAndUpdate;
  let receivedUpdate;
  let receivedOptions;
  Treinamento.findOne = () => leanQuery({ _id: trainingId, duracaoSegundos: 600 });
  ProgressoTreinamento.findOneAndUpdate = (filter, update, options) => {
    receivedUpdate = update;
    receivedOptions = options;
    return leanQuery({
      ultimaPosicaoSegundos: update.$max.ultimaPosicaoSegundos,
      percentualAssistido: update.$max.percentualAssistido,
      concluido: true,
    });
  };
  t.after(() => {
    Treinamento.findOne = originalTrainingFindOne;
    ProgressoTreinamento.findOneAndUpdate = originalFindOneAndUpdate;
  });

  const res = createResponse();
  await atualizarProgresso(
    {
      params: { id: trainingId },
      usuario: { _id: objectId },
      body: { posicaoSegundos: 120, duracaoSegundos: 600, concluido: true },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(receivedOptions.upsert, true);
  assert.equal(receivedUpdate.$max.percentualAssistido, 20);
  assert.equal(Object.hasOwn(receivedUpdate.$set, "concluido"), false);
  assert.equal(receivedUpdate.$setOnInsert.concluido, false);
});

test("conclusao e registrada uma vez ao atingir o limite", async (t) => {
  const originalTrainingFindOne = Treinamento.findOne;
  const originalProgressFindOne = ProgressoTreinamento.findOne;
  const originalFindOneAndUpdate = ProgressoTreinamento.findOneAndUpdate;
  const concludedAt = new Date("2026-07-20T10:00:00.000Z");
  let receivedUpdate;
  Treinamento.findOne = () => leanQuery({ _id: trainingId, duracaoSegundos: 600 });
  ProgressoTreinamento.findOne = () => leanQuery({ concluido: true, concluidoEm: concludedAt });
  ProgressoTreinamento.findOneAndUpdate = (filter, update) => {
    receivedUpdate = update;
    return leanQuery({ percentualAssistido: 90, concluido: true, concluidoEm: concludedAt });
  };
  t.after(() => {
    Treinamento.findOne = originalTrainingFindOne;
    ProgressoTreinamento.findOne = originalProgressFindOne;
    ProgressoTreinamento.findOneAndUpdate = originalFindOneAndUpdate;
  });

  const res = createResponse();
  await atualizarProgresso(
    {
      params: { id: trainingId },
      usuario: { _id: objectId },
      body: { posicaoSegundos: 540, duracaoSegundos: 600 },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(receivedUpdate.$set.concluido, true);
  assert.equal(Object.hasOwn(receivedUpdate.$set, "concluidoEm"), false);
});

test("treinamento inacessivel nao permite atualizar progresso", async (t) => {
  const originalFindOne = Treinamento.findOne;
  const originalUpdate = ProgressoTreinamento.findOneAndUpdate;
  let updateCalled = false;
  Treinamento.findOne = () => leanQuery(null);
  ProgressoTreinamento.findOneAndUpdate = () => {
    updateCalled = true;
  };
  t.after(() => {
    Treinamento.findOne = originalFindOne;
    ProgressoTreinamento.findOneAndUpdate = originalUpdate;
  });

  const res = createResponse();
  await atualizarProgresso(
    {
      params: { id: trainingId },
      usuario: { _id: objectId },
      body: { posicaoSegundos: 20, duracaoSegundos: 100 },
    },
    res
  );
  assert.equal(res.statusCode, 404);
  assert.equal(updateCalled, false);
});

test("indice unico impede progresso duplicado por treinamento e usuario", () => {
  const uniqueIndex = ProgressoTreinamento.schema.indexes().find(
    ([fields, options]) =>
      fields.treinamentoId === 1 && fields.usuarioId === 1 && options.unique === true
  );
  assert.ok(uniqueIndex);
});
