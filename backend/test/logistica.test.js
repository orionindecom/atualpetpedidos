import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Pedido from "../src/models/Pedido.js";
import Usuario from "../src/models/Usuario.js";
import { proteger } from "../src/middlewares/authMiddleware.js";
import {
  somenteAdmin,
  somenteGestorConteudo,
  somenteOperacaoLogistica,
} from "../src/middlewares/adminMiddleware.js";
import logisticaRouter from "../src/routes/logisticaRoutes.js";
import pedidoRouter from "../src/routes/pedidoRoutes.js";
import {
  atualizarStatusPedido,
  confirmarRecebimento,
} from "../src/controllers/pedidoController.js";
import {
  applyLogisticsOrderUpdate,
  buildLogisticsOrderFilter,
  parseLogisticsOrderQuery,
} from "../src/controllers/logisticaController.js";
import {
  buildClientReceiptConfirmationUpdate,
  sanitizeClientOrder,
  transicaoLogisticaPermitida,
  validateLogisticsOrderPayload,
} from "../src/utils/pedidoLogistica.js";
import { buildSeparationPdfData } from "../src/services/pdfSeparacaoService.js";
import { cadastroClienteBloqueiaAcesso } from "../src/utils/userAccess.js";
import { pedidoLimiter } from "../src/middlewares/rateLimitMiddleware.js";

const objectId = "507f1f77bcf86cd799439011";
const secret = "segredo-logistica-com-mais-de-trinta-e-dois-caracteres";

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const runProtected = async (user) => {
  const originalFindById = Usuario.findById;
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  Usuario.findById = () => ({ select: async () => user });
  const token = jwt.sign(
    { id: objectId, tipo: user.tipo, tokenVersion: 0 },
    secret,
    { algorithm: "HS256", expiresIn: "5m" }
  );
  const response = createResponse();
  let nextCalled = false;
  try {
    await proteger(
      { headers: { authorization: `Bearer ${token}` } },
      response,
      () => { nextCalled = true; }
    );
  } finally {
    Usuario.findById = originalFindById;
    process.env.JWT_SECRET = originalSecret;
  }
  return { response, nextCalled };
};

test("schema aceita logistica e Pedido preserva status antigos", () => {
  assert.deepEqual(Usuario.schema.path("tipo").enumValues, [
    "admin",
    "marketing",
    "logistica",
    "cliente",
  ]);
  assert.ok(Pedido.schema.path("status").enumValues.includes("separado"));
  assert.ok(Pedido.schema.path("status").enumValues.includes("em_analise"));
  assert.ok(Pedido.schema.path("status").enumValues.includes("cancelado"));
});

test("pedido antigo sem campos logisticos continua valido", async () => {
  const pedido = new Pedido({
    numeroPedido: "PED-LEGADO-1",
    clienteId: new mongoose.Types.ObjectId(),
    tabelaPrecoId: new mongoose.Types.ObjectId(),
    dia: 7,
    mes: 8,
    ano: 2026,
    itens: [{
      produtoId: new mongoose.Types.ObjectId(),
      nomeProduto: "Produto legado",
      quantidade: 1,
      valorUnitario: 10,
      subtotal: 10,
    }],
    valorTotal: 10,
    status: "novo",
  });
  await assert.doesNotReject(() => pedido.validate());
  assert.equal(pedido.historicoStatus, undefined);
});

test("somente cliente depende de aprovacao de cadastro", () => {
  assert.equal(cadastroClienteBloqueiaAcesso({ tipo: "cliente", statusCadastro: "pendente" }), true);
  assert.equal(cadastroClienteBloqueiaAcesso({ tipo: "cliente", statusCadastro: "aprovado" }), false);
  assert.equal(cadastroClienteBloqueiaAcesso({ tipo: "admin", statusCadastro: "pendente" }), false);
  assert.equal(cadastroClienteBloqueiaAcesso({ tipo: "marketing", statusCadastro: "pendente" }), false);
  assert.equal(cadastroClienteBloqueiaAcesso({ tipo: "logistica", statusCadastro: "pendente" }), false);
});

test("logistica ativa acessa com token mesmo sem aprovacao de cliente", async () => {
  const { response, nextCalled } = await runProtected({
    _id: objectId,
    tipo: "logistica",
    ativo: true,
    statusCadastro: "pendente",
    tokenVersion: 0,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(nextCalled, true);
});

test("logistica inativa permanece bloqueada", async () => {
  const { response, nextCalled } = await runProtected({
    _id: objectId,
    tipo: "logistica",
    ativo: false,
    statusCadastro: "aprovado",
    tokenVersion: 0,
  });
  assert.equal(response.statusCode, 403);
  assert.equal(nextCalled, false);
});

test("middleware permite apenas admin e logistica na operacao", () => {
  for (const tipo of ["admin", "logistica"]) {
    const response = createResponse();
    let allowed = false;
    somenteOperacaoLogistica({ usuario: { tipo } }, response, () => { allowed = true; });
    assert.equal(allowed, true);
  }
  for (const tipo of ["cliente", "marketing"]) {
    const response = createResponse();
    somenteOperacaoLogistica(
      { usuario: { tipo } },
      response,
      () => assert.fail(`${tipo} nao pode acessar logistica`)
    );
    assert.equal(response.statusCode, 403);
  }
});

test("logistica nao ganha acesso a Admin nem Marketing", () => {
  const adminResponse = createResponse();
  somenteAdmin(
    { usuario: { tipo: "logistica" } },
    adminResponse,
    () => assert.fail("logistica nao pode acessar Admin")
  );
  assert.equal(adminResponse.statusCode, 403);

  const marketingResponse = createResponse();
  somenteGestorConteudo(
    { usuario: { tipo: "logistica" } },
    marketingResponse,
    () => assert.fail("logistica nao pode acessar Marketing")
  );
  assert.equal(marketingResponse.statusCode, 403);
});

test("rotas logisticas e criacao de pedido aplicam middlewares corretos", () => {
  assert.deepEqual(
    logisticaRouter.stack.slice(0, 2).map((layer) => layer.name),
    ["proteger", "somenteOperacaoLogistica"]
  );
  const createRoute = pedidoRouter.stack.find((layer) => (
    layer.route?.path === "/" && layer.route.methods.post
  ));
  assert.deepEqual(createRoute.route.stack.slice(0, 2).map((layer) => layer.name), [
    "proteger",
    "somenteCliente",
  ]);
  const receiptRoute = pedidoRouter.stack.find((layer) => (
    layer.route?.path === "/:id/confirmar-recebimento" && layer.route.methods.patch
  ));
  assert.deepEqual(receiptRoute.route.stack.slice(0, 2).map((layer) => layer.name), [
    "proteger",
    "somenteCliente",
  ]);
  assert.equal(receiptRoute.route.stack[2].handle, pedidoLimiter);
});

test("transicoes logisticas seguem fluxo linear e aceitam legado", () => {
  assert.equal(transicaoLogisticaPermitida("novo", "separando"), true);
  assert.equal(transicaoLogisticaPermitida("em_analise", "separando"), true);
  assert.equal(transicaoLogisticaPermitida("separando", "separado"), true);
  assert.equal(transicaoLogisticaPermitida("separado", "faturado"), true);
  assert.equal(transicaoLogisticaPermitida("faturado", "enviado"), true);
  assert.equal(transicaoLogisticaPermitida("enviado", "entregue"), false);
  assert.equal(transicaoLogisticaPermitida("entregue", "separando"), false);
  assert.equal(transicaoLogisticaPermitida("novo", "cancelado"), false);
});

test("atualizacao valida registra historico imutavel e autoria", () => {
  const pedido = { status: "novo" };
  const usuario = {
    _id: new mongoose.Types.ObjectId(),
    tipo: "logistica",
    nomeResponsavel: "Maria Logistica",
  };
  const now = new Date("2026-08-07T17:30:00.000Z");
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "separando", transportadora: "Transportes Atual" },
    observacaoHistorico: "Separacao iniciada",
    usuario,
    now,
  });
  assert.equal(result.valid, true);
  assert.equal(pedido.status, "separando");
  assert.equal(pedido.transportadora, "Transportes Atual");
  assert.equal(pedido.historicoStatus.length, 1);
  assert.deepEqual(pedido.historicoStatus[0], {
    statusAnterior: "novo",
    novoStatus: "separando",
    alteradoEm: now,
    usuarioId: usuario._id,
    usuarioNome: "Maria Logistica",
    usuarioTipo: "logistica",
    observacao: "Separacao iniciada",
  });
});

test("transicao invalida nao altera o pedido", () => {
  const pedido = { status: "entregue", transportadora: "Original" };
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "separando", transportadora: "Forjada" },
    observacaoHistorico: "",
    usuario: { _id: objectId, tipo: "logistica", nomeResponsavel: "Teste" },
  });
  assert.equal(result.valid, false);
  assert.equal(pedido.status, "entregue");
  assert.equal(pedido.transportadora, "Original");
  assert.equal(pedido.historicoStatus, undefined);
});

test("admin pode corrigir status pela superficie logistica", () => {
  const pedido = { status: "entregue" };
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "novo" },
    observacaoHistorico: "Correcao operacional",
    usuario: { _id: objectId, tipo: "admin", nomeResponsavel: "Admin" },
  });
  assert.equal(result.valid, true);
  assert.equal(pedido.status, "novo");
  assert.equal(pedido.historicoStatus.length, 1);
});

test("logistica nao marca entrega nem altera data de entrega", () => {
  const pedido = { status: "enviado", dataEntrega: null };
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "entregue" },
    observacaoHistorico: "",
    usuario: { _id: objectId, tipo: "logistica", nomeResponsavel: "Teste" },
  });
  assert.equal(result.valid, false);
  assert.equal(pedido.status, "enviado");
  assert.equal(pedido.dataEntrega, null);

  const payload = validateLogisticsOrderPayload({
    dataEntrega: "2026-08-07",
  });
  assert.equal(payload.valid, false);
  assert.match(payload.errors.campos, /dataEntrega/);
});

test("confirmacao do cliente usa data do servidor e registra autoria", () => {
  const usuario = {
    _id: new mongoose.Types.ObjectId(),
    tipo: "cliente",
    nomeResponsavel: "Cliente Responsavel",
  };
  const now = new Date("2026-08-07T19:20:00.000Z");
  const update = buildClientReceiptConfirmationUpdate({ usuario, now });

  assert.deepEqual(update.$set, {
    status: "entregue",
    dataEntrega: now,
  });
  assert.deepEqual(update.$push.historicoStatus, {
    statusAnterior: "enviado",
    novoStatus: "entregue",
    alteradoEm: now,
    usuarioId: usuario._id,
    usuarioNome: "Cliente Responsavel",
    usuarioTipo: "cliente",
    observacao: "Recebimento confirmado pelo cliente",
  });
});

test("cliente dono confirma pedido enviado sem aceitar campos do body", async () => {
  const originalFindOneAndUpdate = Pedido.findOneAndUpdate;
  let capturedFilter;
  let capturedUpdate;
  const clienteId = new mongoose.Types.ObjectId();
  Pedido.findOneAndUpdate = async (filter, update) => {
    capturedFilter = filter;
    capturedUpdate = update;
    return {
      _id: objectId,
      clienteId,
      status: "entregue",
      dataEntrega: update.$set.dataEntrega,
    };
  };
  const response = createResponse();

  try {
    await confirmarRecebimento({
      params: { id: objectId },
      body: { status: "cancelado", dataEntrega: "2000-01-01" },
      usuario: {
        _id: clienteId,
        tipo: "cliente",
        nomeResponsavel: "Cliente Teste",
      },
    }, response);
  } finally {
    Pedido.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.pedido.status, "entregue");
  assert.deepEqual(capturedFilter, {
    _id: objectId,
    clienteId,
    status: "enviado",
  });
  assert.ok(capturedUpdate.$set.dataEntrega instanceof Date);
  assert.notEqual(capturedUpdate.$set.dataEntrega.toISOString(), "2000-01-01T00:00:00.000Z");
  assert.equal(capturedUpdate.$push.historicoStatus.usuarioTipo, "cliente");
});

test("cliente nao confirma pedido de outro cliente", async () => {
  const originalFindOneAndUpdate = Pedido.findOneAndUpdate;
  const originalFindById = Pedido.findById;
  const donoId = new mongoose.Types.ObjectId();
  Pedido.findOneAndUpdate = async () => null;
  Pedido.findById = () => ({
    select() { return this; },
    async lean() { return { clienteId: donoId, status: "enviado" }; },
  });
  const response = createResponse();

  try {
    await confirmarRecebimento({
      params: { id: objectId },
      usuario: { _id: new mongoose.Types.ObjectId(), tipo: "cliente" },
    }, response);
  } finally {
    Pedido.findOneAndUpdate = originalFindOneAndUpdate;
    Pedido.findById = originalFindById;
  }

  assert.equal(response.statusCode, 403);
});

test("pedido nao enviado ou ja entregue nao pode ser confirmado", async () => {
  const originalFindOneAndUpdate = Pedido.findOneAndUpdate;
  const originalFindById = Pedido.findById;
  const clienteId = new mongoose.Types.ObjectId();
  Pedido.findOneAndUpdate = async () => null;
  const responseNovo = createResponse();
  const responseEntregue = createResponse();

  try {
    Pedido.findById = () => ({
      select() { return this; },
      async lean() { return { clienteId, status: "faturado" }; },
    });
    await confirmarRecebimento({
      params: { id: objectId },
      usuario: { _id: clienteId, tipo: "cliente" },
    }, responseNovo);

    Pedido.findById = () => ({
      select() { return this; },
      async lean() { return { clienteId, status: "entregue" }; },
    });
    await confirmarRecebimento({
      params: { id: objectId },
      usuario: { _id: clienteId, tipo: "cliente" },
    }, responseEntregue);
  } finally {
    Pedido.findOneAndUpdate = originalFindOneAndUpdate;
    Pedido.findById = originalFindById;
  }

  assert.equal(responseNovo.statusCode, 409);
  assert.equal(responseEntregue.statusCode, 409);
  assert.match(responseEntregue.body.message, /já confirmado/);
});

test("admin nao usa atualizacao comum para marcar entregue", async () => {
  const response = createResponse();
  await atualizarStatusPedido({ body: { status: "entregue" } }, response);
  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /confirmado pelo cliente/);
});

test("whitelist aceita somente dados logisticos e link HTTPS", () => {
  const valid = validateLogisticsOrderPayload({
    status: "faturado",
    numeroNotaFiscal: "NF-123",
    dataFaturamento: "2026-08-07",
    transportadora: "Atual Transportes",
    codigoRastreio: "BR123",
    linkRastreio: "https://transportadora.example/rastreio/BR123",
    observacaoLogistica: "Separar volumes",
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.data.numeroNotaFiscal, "NF-123");

  const unsafeUrl = validateLogisticsOrderPayload({
    linkRastreio: "javascript:alert(1)",
  });
  assert.equal(unsafeUrl.valid, false);
});

test("tentativas comerciais sao rejeitadas e nunca entram no plano", () => {
  const fields = {
    clienteId: objectId,
    cliente: objectId,
    itens: [{ produtoId: objectId, quantidade: 999 }],
    quantidade: 999,
    preco: 0.01,
    precoUnitario: 0.01,
    desconto: 100,
    valorTotal: 0.01,
    tabelaPreco: objectId,
    numeroPedido: "FORJADO",
  };
  const result = validateLogisticsOrderPayload(fields);
  assert.equal(result.valid, false);
  assert.match(result.errors.campos, /clienteId/);
  assert.deepEqual(result.data, {});
});

test("cliente recebe tracking sem historico nem observacao interna", () => {
  const response = sanitizeClientOrder({
    _id: objectId,
    status: "enviado",
    numeroNotaFiscal: "NF-1",
    transportadora: "Transportadora",
    codigoRastreio: "ABC",
    historicoStatus: [{ usuarioNome: "Interno" }],
    observacaoLogistica: "Nao mostrar",
  });
  assert.equal(response.numeroNotaFiscal, "NF-1");
  assert.equal(response.transportadora, "Transportadora");
  assert.equal(Object.hasOwn(response, "historicoStatus"), false);
  assert.equal(Object.hasOwn(response, "observacaoLogistica"), false);
});

test("filtros logisticos validam paginacao, periodo e aguardando acao", () => {
  const parsed = parseLogisticsOrderQuery({
    pagina: "2",
    limite: "20",
    busca: "PED-10",
    dataInicio: "2026-08-01",
    dataFim: "2026-08-07",
    aguardandoAcao: "true",
  });
  assert.equal(parsed.valid, true);
  const filter = buildLogisticsOrderFilter(parsed.data);
  assert.deepEqual(filter.status, { $nin: ["entregue", "cancelado"] });
  assert.ok(filter.createdAt.$gte instanceof Date);
  assert.equal(filter.$or.length, 4);

  const invalid = parseLogisticsOrderQuery({ limite: "500", status: "forjado" });
  assert.equal(invalid.valid, false);
});

test("pedido entregue deixa de atender ao filtro aguardando acao", () => {
  const parsed = parseLogisticsOrderQuery({ aguardandoAcao: "true" });
  const filter = buildLogisticsOrderFilter(parsed.data);
  assert.ok(filter.status.$nin.includes("entregue"));
  assert.ok(filter.status.$nin.includes("cancelado"));
});

test("PDF de separacao e protegido para admin e logistica", () => {
  const pdfRoute = logisticaRouter.stack.find((layer) => (
    layer.route?.path === "/pedidos/:id/pdf-separacao" && layer.route.methods.get
  ));
  assert.ok(pdfRoute);

  for (const tipo of ["admin", "logistica"]) {
    let allowed = false;
    somenteOperacaoLogistica(
      { usuario: { tipo } },
      createResponse(),
      () => { allowed = true; }
    );
    assert.equal(allowed, true);
  }

  for (const tipo of ["cliente", "marketing"]) {
    const response = createResponse();
    somenteOperacaoLogistica(
      { usuario: { tipo } },
      response,
      () => assert.fail(`${tipo} nao pode gerar PDF de separacao`)
    );
    assert.equal(response.statusCode, 403);
  }
});

test("PDF de separacao contem produtos e quantidades sem dados comerciais", () => {
  const data = buildSeparationPdfData({
    numeroPedido: "PED-100",
    nomeFantasiaCliente: "Pet Center",
    dia: 7,
    mes: 8,
    ano: 2026,
    itens: [{
      nomeProduto: "Shampoo Dream Color 5L",
      quantidade: 4,
      valorUnitario: 99.9,
      subtotal: 399.6,
      desconto: 10,
    }],
    valorTotal: 399.6,
    tabelaPrecoId: objectId,
    observacao: "Separar em duas caixas",
  });
  const serialized = JSON.stringify(data);

  assert.equal(data.itens[0].nomeProduto, "Shampoo Dream Color 5L");
  assert.equal(data.itens[0].quantidade, 4);
  assert.equal(data.observacao, "Separar em duas caixas");
  assert.doesNotMatch(serialized, /valorUnitario|subtotal|valorTotal|desconto|tabelaPreco/);
  assert.doesNotMatch(serialized, /99\.9|399\.6/);
});
