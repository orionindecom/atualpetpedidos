import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import OperadorLogistica from "../src/models/OperadorLogistica.js";
import Pedido from "../src/models/Pedido.js";
import {
  atualizarOperador,
  cadastrarOperador,
  identificarOperadorPedido,
  listarOperadoresAtivos,
  redefinirPinOperador,
} from "../src/controllers/operadorLogisticaController.js";
import { applyLogisticsOrderUpdate } from "../src/controllers/logisticaController.js";
import { exigirContextoOperador } from "../src/middlewares/operadorLogisticaMiddleware.js";
import { somenteLogistica } from "../src/middlewares/adminMiddleware.js";
import {
  OPERADOR_CONTEXT_PURPOSE,
  signOperatorContext,
} from "../src/utils/operadorLogistica.js";
import { buildOrderAuditTimeline } from "../src/utils/pedidoAuditoria.js";
import { sanitizeClientOrder } from "../src/utils/pedidoLogistica.js";
import { buildOrderAuditPdfData } from "../src/services/pdfAuditoriaPedidoService.js";
import logisticaRouter from "../src/routes/logisticaRoutes.js";
import operadorLogisticaRouter from "../src/routes/operadorLogisticaRoutes.js";

const secret = "segredo-operador-logistica-com-mais-de-trinta-e-dois-caracteres";
const adminId = new mongoose.Types.ObjectId();
const logisticsUserId = new mongoose.Types.ObjectId();
const orderId = new mongoose.Types.ObjectId();

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const queryResult = (result) => ({
  select() { return this; },
  lean() { return this; },
  sort() { return this; },
  maxTimeMS() { return Promise.resolve(result); },
});

const withSecret = async (callback) => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  try {
    return await callback();
  } finally {
    process.env.JWT_SECRET = previousSecret;
  }
};

test("model de operador oculta pinHash e preserva auditoria administrativa", () => {
  assert.equal(OperadorLogistica.schema.path("pinHash").options.select, false);
  assert.equal(OperadorLogistica.schema.path("ativo").defaultValue, true);
  assert.equal(OperadorLogistica.schema.path("createdBy").options.ref, "Usuario");

  const operator = new OperadorLogistica({
    nome: "Pedro",
    pinHash: "hash-protegido",
    createdBy: adminId,
    updatedBy: adminId,
  });
  const serialized = operator.toJSON();
  assert.equal(Object.hasOwn(serialized, "pinHash"), false);
});

test("Admin cadastra operador com bcrypt e API nunca devolve o hash", async () => {
  const originalCreate = OperadorLogistica.create;
  let persisted;
  OperadorLogistica.create = async (data) => {
    persisted = data;
    return {
      _id: new mongoose.Types.ObjectId(),
      nome: data.nome,
      ativo: data.ativo,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  };
  const response = createResponse();
  try {
    await cadastrarOperador({
      body: { nome: "  Pedro   Henrique ", pin: "1234" },
      usuario: { _id: adminId },
    }, response);
  } finally {
    OperadorLogistica.create = originalCreate;
  }

  assert.equal(response.statusCode, 201);
  assert.equal(persisted.nome, "Pedro Henrique");
  assert.notEqual(persisted.pinHash, "1234");
  assert.equal(await bcrypt.compare("1234", persisted.pinHash), true);
  assert.equal(JSON.stringify(response.body).includes("pinHash"), false);
  assert.equal(JSON.stringify(response.body).includes("1234"), false);
});

test("Admin altera nome, desativa e redefine PIN sem expor o hash", async () => {
  const originalUpdate = OperadorLogistica.findByIdAndUpdate;
  const captured = [];
  OperadorLogistica.findByIdAndUpdate = (_id, update) => {
    captured.push(update.$set);
    return {
      select: async () => ({
        _id: orderId,
        nome: update.$set.nome || "Pedro",
        ativo: update.$set.ativo ?? true,
      }),
    };
  };
  const nameResponse = createResponse();
  const statusResponse = createResponse();
  const pinResponse = createResponse();
  try {
    await atualizarOperador({
      params: { id: String(orderId) },
      body: { nome: "Pedro Souza" },
      usuario: { _id: adminId },
    }, nameResponse);
    await atualizarOperador({
      params: { id: String(orderId) },
      body: { ativo: false },
      usuario: { _id: adminId },
    }, statusResponse);
    await redefinirPinOperador({
      params: { id: String(orderId) },
      body: { pin: "654321" },
      usuario: { _id: adminId },
    }, pinResponse);
  } finally {
    OperadorLogistica.findByIdAndUpdate = originalUpdate;
  }

  assert.equal(nameResponse.body.operador.nome, "Pedro Souza");
  assert.equal(statusResponse.body.operador.ativo, false);
  assert.equal(await bcrypt.compare("654321", captured[2].pinHash), true);
  assert.equal(JSON.stringify(pinResponse.body).includes("pinHash"), false);
  assert.equal(JSON.stringify(pinResponse.body).includes("654321"), false);
});

test("Logística lista somente id e nome de operadores ativos", async () => {
  const originalFind = OperadorLogistica.find;
  let filter;
  let projection;
  OperadorLogistica.find = (nextFilter) => {
    filter = nextFilter;
    const query = queryResult([{ _id: orderId, nome: "Pedro" }]);
    query.select = (nextProjection) => { projection = nextProjection; return query; };
    return query;
  };
  const response = createResponse();
  try {
    await listarOperadoresAtivos({}, response);
  } finally {
    OperadorLogistica.find = originalFind;
  }

  assert.deepEqual(filter, { ativo: true });
  assert.equal(projection, "_id nome");
  assert.deepEqual(response.body, [{ _id: orderId, nome: "Pedro" }]);
  assert.equal(JSON.stringify(response.body).includes("pin"), false);
});

test("somente a conta Logística consulta e valida operadores", () => {
  for (const tipo of ["cliente", "admin", "marketing"]) {
    const response = createResponse();
    somenteLogistica(
      { usuario: { tipo } },
      response,
      () => assert.fail(`${tipo} não deve acessar identidades operacionais`)
    );
    assert.equal(response.statusCode, 403);
  }
  let allowed = false;
  somenteLogistica(
    { usuario: { tipo: "logistica" } },
    createResponse(),
    () => { allowed = true; }
  );
  assert.equal(allowed, true);
});

test("rotas aplicam autorização, limitação de PIN e contexto por pedido", () => {
  assert.deepEqual(
    operadorLogisticaRouter.stack.slice(0, 2).map((layer) => layer.name),
    ["proteger", "somenteAdmin"]
  );
  const identifyRoute = logisticaRouter.stack.find((layer) => (
    layer.route?.path === "/pedidos/:id/identificar"
  ));
  assert.ok(identifyRoute);
  assert.deepEqual(
    identifyRoute.route.stack.slice(0, 3).map((layer) => layer.name),
    ["somenteLogistica", "<anonymous>", "<anonymous>"]
  );

  for (const path of [
    "/pedidos/:id",
    "/pedidos/:id/pdf-separacao",
  ]) {
    const route = logisticaRouter.stack.find((layer) => layer.route?.path === path);
    assert.ok(route.route.stack.some((layer) => layer.name === "exigirContextoOperador"));
  }
  const patchRoute = logisticaRouter.stack.find((layer) => (
    layer.route?.path === "/pedidos/:id" && layer.route.methods.patch
  ));
  assert.ok(patchRoute.route.stack.some((layer) => layer.name === "exigirContextoOperador"));
});

test("PIN incorreto e operador inativo não liberam o pedido", async () => {
  const originalOrderFind = Pedido.findById;
  const originalOperatorFind = OperadorLogistica.findOne;
  const validHash = await bcrypt.hash("1234", 4);
  Pedido.findById = () => queryResult({ _id: orderId, status: "aprovado" });
  OperadorLogistica.findOne = () => queryResult({
    _id: new mongoose.Types.ObjectId(),
    nome: "Pedro",
    ativo: true,
    pinHash: validHash,
  });
  const wrongPinResponse = createResponse();
  const inactiveResponse = createResponse();
  try {
    await identificarOperadorPedido({
      params: { id: String(orderId) },
      body: { operadorId: String(new mongoose.Types.ObjectId()), pin: "9999" },
      usuario: { _id: logisticsUserId },
    }, wrongPinResponse);
    OperadorLogistica.findOne = () => queryResult(null);
    await identificarOperadorPedido({
      params: { id: String(orderId) },
      body: { operadorId: String(new mongoose.Types.ObjectId()), pin: "1234" },
      usuario: { _id: logisticsUserId },
    }, inactiveResponse);
  } finally {
    Pedido.findById = originalOrderFind;
    OperadorLogistica.findOne = originalOperatorFind;
  }

  assert.equal(wrongPinResponse.statusCode, 422);
  assert.equal(inactiveResponse.statusCode, 422);
  assert.equal(wrongPinResponse.body.message, "PIN inválido.");
});

test("PIN correto emite contexto curto vinculado a usuário, operador e pedido", async () => {
  await withSecret(async () => {
    const originalOrderFind = Pedido.findById;
    const originalOperatorFind = OperadorLogistica.findOne;
    const operatorId = new mongoose.Types.ObjectId();
    const validHash = await bcrypt.hash("1234", 4);
    Pedido.findById = () => queryResult({ _id: orderId, status: "aprovado" });
    OperadorLogistica.findOne = () => queryResult({
      _id: operatorId,
      nome: "Pedro",
      ativo: true,
      pinHash: validHash,
    });
    const response = createResponse();
    try {
      await identificarOperadorPedido({
        params: { id: String(orderId) },
        body: { operadorId: String(operatorId), pin: "1234" },
        usuario: { _id: logisticsUserId },
      }, response);
    } finally {
      Pedido.findById = originalOrderFind;
      OperadorLogistica.findOne = originalOperatorFind;
    }

    const payload = jwt.verify(response.body.contextoOperacional, secret);
    assert.equal(payload.purpose, OPERADOR_CONTEXT_PURPOSE);
    assert.equal(payload.operadorId, String(operatorId));
    assert.equal(payload.pedidoId, String(orderId));
    assert.equal(payload.usuarioId, String(logisticsUserId));
    assert.equal(response.body.expiraEmSegundos, 900);
    assert.deepEqual(response.body.operador, { _id: operatorId, nome: "Pedro" });
  });
});

test("middleware rejeita ausência, adulteração, outro pedido e operador inativo", async () => {
  await withSecret(async () => {
    const operatorId = new mongoose.Types.ObjectId();
    const context = signOperatorContext({
      operadorId: operatorId,
      pedidoId: orderId,
      usuarioId: logisticsUserId,
    });

    const missing = createResponse();
    await exigirContextoOperador({
      headers: {},
      params: { id: String(orderId) },
      usuario: { _id: logisticsUserId, tipo: "logistica" },
    }, missing, () => assert.fail("contexto ausente não pode avançar"));
    assert.equal(missing.statusCode, 428);

    const anotherOrder = createResponse();
    await exigirContextoOperador({
      headers: { "x-operador-contexto": context },
      params: { id: String(new mongoose.Types.ObjectId()) },
      usuario: { _id: logisticsUserId, tipo: "logistica" },
    }, anotherOrder, () => assert.fail("contexto do pedido A não vale no B"));
    assert.equal(anotherOrder.statusCode, 428);

    const tampered = createResponse();
    await exigirContextoOperador({
      headers: { "x-operador-contexto": `${context}adulterado` },
      params: { id: String(orderId) },
      usuario: { _id: logisticsUserId, tipo: "logistica" },
    }, tampered, () => assert.fail("token adulterado não pode avançar"));
    assert.equal(tampered.statusCode, 428);

    const originalFind = OperadorLogistica.findById;
    OperadorLogistica.findById = () => queryResult({
      _id: operatorId,
      nome: "Pedro",
      ativo: false,
    });
    const inactive = createResponse();
    try {
      await exigirContextoOperador({
        headers: { "x-operador-contexto": context },
        params: { id: String(orderId) },
        usuario: { _id: logisticsUserId, tipo: "logistica" },
      }, inactive, () => assert.fail("operador inativo não pode avançar"));
    } finally {
      OperadorLogistica.findById = originalFind;
    }
    assert.equal(inactive.statusCode, 428);
  });
});

test("contexto expirado ou emitido para outra conta é rejeitado", async () => {
  await withSecret(async () => {
    const operatorId = new mongoose.Types.ObjectId();
    const basePayload = {
      purpose: OPERADOR_CONTEXT_PURPOSE,
      operadorId: String(operatorId),
      pedidoId: String(orderId),
      usuarioId: String(logisticsUserId),
    };
    const expiredToken = jwt.sign(basePayload, secret, {
      algorithm: "HS256",
      expiresIn: -1,
    });
    const expired = createResponse();
    await exigirContextoOperador({
      headers: { "x-operador-contexto": expiredToken },
      params: { id: String(orderId) },
      usuario: { _id: logisticsUserId, tipo: "logistica" },
    }, expired, () => assert.fail("contexto expirado não pode avançar"));
    assert.equal(expired.statusCode, 428);
    assert.equal(expired.body.code, "OPERADOR_CONTEXT_EXPIRADO");

    const otherAccount = createResponse();
    const validToken = jwt.sign(basePayload, secret, {
      algorithm: "HS256",
      expiresIn: "5m",
    });
    await exigirContextoOperador({
      headers: { "x-operador-contexto": validToken },
      params: { id: String(orderId) },
      usuario: { _id: new mongoose.Types.ObjectId(), tipo: "logistica" },
    }, otherAccount, () => assert.fail("outra conta não pode usar o contexto"));
    assert.equal(otherAccount.statusCode, 428);
  });
});

test("contexto válido define autoria no backend e Admin não precisa de PIN", async () => {
  await withSecret(async () => {
    const operatorId = new mongoose.Types.ObjectId();
    const context = signOperatorContext({
      operadorId: operatorId,
      pedidoId: orderId,
      usuarioId: logisticsUserId,
    });
    const originalFind = OperadorLogistica.findById;
    OperadorLogistica.findById = () => queryResult({
      _id: operatorId,
      nome: "Pedro",
      ativo: true,
    });
    const request = {
      headers: { "x-operador-contexto": context },
      params: { id: String(orderId) },
      usuario: { _id: logisticsUserId, tipo: "logistica" },
    };
    let nextCalled = false;
    try {
      await exigirContextoOperador(request, createResponse(), () => { nextCalled = true; });
    } finally {
      OperadorLogistica.findById = originalFind;
    }
    assert.equal(nextCalled, true);
    assert.equal(request.operadorLogistica.nome, "Pedro");

    let adminAllowed = false;
    await exigirContextoOperador(
      { headers: {}, params: { id: String(orderId) }, usuario: { tipo: "admin" } },
      createResponse(),
      () => { adminAllowed = true; }
    );
    assert.equal(adminAllowed, true);
  });
});

test("Pedro separa e Wesley confere com snapshots independentes", () => {
  const productId = new mongoose.Types.ObjectId();
  const sharedUser = {
    _id: logisticsUserId,
    tipo: "logistica",
    nomeResponsavel: "Conta Logística",
  };
  const pedro = { _id: new mongoose.Types.ObjectId(), nome: "Pedro" };
  const wesley = { _id: new mongoose.Types.ObjectId(), nome: "Wesley" };
  const order = {
    _id: orderId,
    numeroPedido: "PED-OPERADORES-1",
    clienteId: new mongoose.Types.ObjectId(),
    nomeResponsavel: "Cliente",
    createdAt: new Date("2026-08-12T10:00:00.000Z"),
    status: "aprovado",
    conferenciaObrigatoria: true,
    itens: [{
      produtoId: productId,
      nomeProduto: "Produto",
      quantidade: 3,
    }],
  };

  assert.equal(applyLogisticsOrderUpdate({
    pedido: order,
    data: { status: "separando" },
    usuario: sharedUser,
    operador: pedro,
    now: new Date("2026-08-12T10:05:00.000Z"),
  }).valid, true);
  assert.equal(applyLogisticsOrderUpdate({
    pedido: order,
    data: { status: "separado" },
    separacaoItens: [{ produtoId: String(productId), quantidadeSeparada: 3 }],
    usuario: sharedUser,
    operador: pedro,
    now: new Date("2026-08-12T10:12:00.000Z"),
  }).valid, true);
  assert.equal(applyLogisticsOrderUpdate({
    pedido: order,
    data: {},
    conferencia: { acao: "iniciar" },
    usuario: sharedUser,
    operador: wesley,
    now: new Date("2026-08-12T10:20:00.000Z"),
  }).valid, true);
  assert.equal(applyLogisticsOrderUpdate({
    pedido: order,
    data: {},
    conferencia: {
      acao: "concluir",
      itens: [{ produtoId: String(productId), quantidadeConferida: 3 }],
      observacao: "",
    },
    usuario: sharedUser,
    operador: wesley,
    now: new Date("2026-08-12T10:25:00.000Z"),
  }).valid, true);

  assert.equal(order.historicoStatus[0].operadorNome, "Pedro");
  assert.equal(order.historicoStatus[1].operadorNome, "Pedro");
  assert.equal(order.conferencia.iniciadoPor.operadorNome, "Wesley");
  assert.equal(order.conferencia.concluidoPor.operadorNome, "Wesley");
  assert.ok(order.ocorrencias.every((entry) => entry.operadorNome === "Pedro" || entry.operadorNome === "Wesley"));

  const timeline = buildOrderAuditTimeline(order);
  assert.equal(timeline.find((event) => event.tipo === "separacao_iniciada").responsavelNome, "Pedro");
  assert.equal(timeline.find((event) => event.tipo === "separacao_concluida").responsavelNome, "Pedro");
  assert.equal(timeline.find((event) => event.tipo === "conferencia_iniciada").responsavelNome, "Wesley");
  assert.equal(timeline.find((event) => event.tipo === "conferencia_concluida").responsavelNome, "Wesley");

  const pdfData = buildOrderAuditPdfData(order);
  assert.equal(pdfData.separacao.iniciadaPor, "Pedro");
  assert.equal(pdfData.separacao.concluidaPor, "Pedro");
  assert.equal(pdfData.conferencia.iniciadaPor, "Wesley");
  assert.equal(pdfData.conferencia.concluidaPor, "Wesley");
  assert.equal(JSON.stringify(pdfData).toLowerCase().includes("pin"), false);
});

test("troca de operador na mesma separação preserva todos os eventos", () => {
  const productId = new mongoose.Types.ObjectId();
  const sharedUser = { _id: logisticsUserId, tipo: "logistica", nomeResponsavel: "Logística" };
  const pedro = { _id: new mongoose.Types.ObjectId(), nome: "Pedro" };
  const wesley = { _id: new mongoose.Types.ObjectId(), nome: "Wesley" };
  const order = {
    status: "aprovado",
    conferenciaObrigatoria: true,
    itens: [{ produtoId: productId, nomeProduto: "Produto", quantidade: 5 }],
  };

  applyLogisticsOrderUpdate({ pedido: order, data: { status: "separando" }, usuario: sharedUser, operador: pedro });
  applyLogisticsOrderUpdate({
    pedido: order,
    data: {},
    separacaoItens: [{ produtoId: String(productId), quantidadeSeparada: 4 }],
    usuario: sharedUser,
    operador: pedro,
  });
  applyLogisticsOrderUpdate({
    pedido: order,
    data: { status: "separado" },
    separacaoItens: [{ produtoId: String(productId), quantidadeSeparada: 5 }],
    usuario: sharedUser,
    operador: wesley,
  });

  assert.equal(order.historicoStatus[0].operadorNome, "Pedro");
  assert.equal(order.ocorrencias.some((entry) => entry.operadorNome === "Pedro"), true);
  assert.equal(order.ocorrencias.some((entry) => entry.operadorNome === "Wesley"), true);
  assert.equal(order.historicoStatus[1].operadorNome, "Wesley");

  pedro.nome = "Pedro H. Souza";
  assert.equal(order.historicoStatus[0].operadorNome, "Pedro");
  assert.equal(order.ocorrencias.some((entry) => entry.operadorNome === "Pedro"), true);
});

test("Wesley separa, Pedro confere divergência e registra ocorrência", () => {
  const productId = new mongoose.Types.ObjectId();
  const sharedUser = { _id: logisticsUserId, tipo: "logistica", nomeResponsavel: "Logística" };
  const pedro = { _id: new mongoose.Types.ObjectId(), nome: "Pedro" };
  const wesley = { _id: new mongoose.Types.ObjectId(), nome: "Wesley" };
  const order = {
    status: "aprovado",
    conferenciaObrigatoria: true,
    itens: [{ produtoId: productId, nomeProduto: "Produto", quantidade: 5 }],
  };

  applyLogisticsOrderUpdate({ pedido: order, data: { status: "separando" }, usuario: sharedUser, operador: wesley });
  applyLogisticsOrderUpdate({
    pedido: order,
    data: { status: "separado" },
    separacaoItens: [{ produtoId: String(productId), quantidadeSeparada: 5 }],
    usuario: sharedUser,
    operador: wesley,
  });
  applyLogisticsOrderUpdate({
    pedido: order,
    data: {},
    conferencia: { acao: "iniciar" },
    usuario: sharedUser,
    operador: pedro,
  });
  applyLogisticsOrderUpdate({
    pedido: order,
    data: {},
    conferencia: {
      acao: "concluir",
      itens: [{ produtoId: String(productId), quantidadeConferida: 4 }],
      observacao: "Uma unidade divergente",
    },
    usuario: sharedUser,
    operador: pedro,
  });
  applyLogisticsOrderUpdate({
    pedido: order,
    data: {},
    novaOcorrencia: {
      conteudo: "Divergência revisada fisicamente.",
      tipo: "observacao",
      visibilidade: "interna",
    },
    usuario: sharedUser,
    operador: pedro,
  });

  assert.equal(order.historicoStatus[0].operadorNome, "Wesley");
  assert.equal(order.historicoStatus[1].operadorNome, "Wesley");
  assert.equal(order.conferencia.iniciadoPor.operadorNome, "Pedro");
  assert.equal(order.conferencia.concluidoPor.operadorNome, "Pedro");
  assert.equal(order.conferencia.totalDivergencias, 1);
  assert.equal(order.ocorrencias.at(-1).operadorNome, "Pedro");
});

test("histórico legado e DTO do cliente continuam sem dados de operador", () => {
  const legacy = buildOrderAuditTimeline({
    createdAt: new Date("2026-01-01T10:00:00.000Z"),
    clienteId: new mongoose.Types.ObjectId(),
    nomeResponsavel: "Cliente",
    historicoStatus: [{
      statusAnterior: "novo",
      novoStatus: "separando",
      alteradoEm: new Date("2026-01-01T11:00:00.000Z"),
      usuarioId: logisticsUserId,
      usuarioNome: "Conta Logística",
      usuarioTipo: "logistica",
    }],
  });
  assert.equal(legacy[1].responsavelNome, "Conta Logística");

  const clientOrder = sanitizeClientOrder({
    _id: orderId,
    status: "separado",
    valorTotal: 10,
    historicoStatus: [{ operadorId: orderId, operadorNome: "Pedro" }],
    ocorrencias: [{ operadorId: orderId, operadorNome: "Pedro" }],
    conferencia: {
      iniciadoPor: { operadorId: orderId, operadorNome: "Pedro" },
    },
    itens: [],
  });
  const serialized = JSON.stringify(clientOrder);
  assert.equal(serialized.includes("operador"), false);
  assert.equal(serialized.includes("Pedro"), false);
});
