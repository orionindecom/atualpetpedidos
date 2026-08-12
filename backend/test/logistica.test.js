import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { PassThrough } from "node:stream";
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
  aprovarPedidoAdmin,
  atualizarStatusPedido,
  confirmarRecebimento,
} from "../src/controllers/pedidoController.js";
import {
  applyLogisticsOrderUpdate,
  buildLogisticsOrderFilter,
  parseLogisticsOrderQuery,
} from "../src/controllers/logisticaController.js";
import {
  enrichOrderSeparation,
  enrichInternalOrderDetail,
  buildClientReceiptConfirmationUpdate,
  sanitizeClientOrder,
  transicaoLogisticaPermitida,
  transicoesPermitidasParaPedido,
  validateLogisticsOrderPayload,
} from "../src/utils/pedidoLogistica.js";
import { buildSeparationPdfData } from "../src/services/pdfSeparacaoService.js";
import { buildOrderAuditTimeline } from "../src/utils/pedidoAuditoria.js";
import {
  buildOrderAuditPdfData,
  gerarPdfRelatorioPedido,
} from "../src/services/pdfAuditoriaPedidoService.js";
import { cadastroClienteBloqueiaAcesso } from "../src/utils/userAccess.js";
import { pedidoLimiter } from "../src/middlewares/rateLimitMiddleware.js";

const objectId = "507f1f77bcf86cd799439011";
const secret = "segredo-logistica-com-mais-de-trinta-e-dois-caracteres";

const conferenciaUsuario = () => ({
  _id: new mongoose.Types.ObjectId(),
  tipo: "logistica",
  nomeResponsavel: "Marcos Conferente",
});

const criarPedidoParaConferencia = ({
  status = "separado",
  conferencia = { status: "pendente" },
} = {}) => {
  const primeiroId = new mongoose.Types.ObjectId();
  const segundoId = new mongoose.Types.ObjectId();
  return {
    status,
    conferenciaObrigatoria: true,
    conferencia,
    itens: [
      {
        produtoId: primeiroId,
        nomeProduto: "Produto X",
        quantidade: 12,
        quantidadeSeparada: 12,
        situacaoSeparacao: "completo",
      },
      {
        produtoId: segundoId,
        nomeProduto: "Produto Y",
        quantidade: 10,
        quantidadeSeparada: 8,
        situacaoSeparacao: "parcial",
      },
    ],
  };
};

const iniciarConferencia = (pedido, usuario = conferenciaUsuario(), now = new Date()) => (
  applyLogisticsOrderUpdate({
    pedido,
    data: {},
    conferencia: { acao: "iniciar" },
    usuario,
    now,
  })
);

const concluirConferencia = ({
  pedido,
  usuario = conferenciaUsuario(),
  quantidades,
  observacao = "",
  now = new Date(),
}) => applyLogisticsOrderUpdate({
  pedido,
  data: {},
  conferencia: {
    acao: "concluir",
    itens: pedido.itens.map((item, index) => ({
      produtoId: String(item.produtoId),
      quantidadeConferida: quantidades?.[index] ?? item.quantidadeSeparada,
    })),
    observacao,
  },
  usuario,
  now,
});

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
  assert.ok(Pedido.schema.path("status").enumValues.includes("aguardando_aprovacao"));
  assert.ok(Pedido.schema.path("status").enumValues.includes("aprovado"));
  assert.equal(Pedido.schema.path("status").defaultValue, "aguardando_aprovacao");
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

  const approvalRoute = pedidoRouter.stack.find((layer) => (
    layer.route?.path === "/:id/aprovar" && layer.route.methods.patch
  ));
  assert.ok(approvalRoute);
  assert.deepEqual(approvalRoute.route.stack.slice(0, 2).map((layer) => layer.name), [
    "proteger",
    "somenteAdmin",
  ]);
});

test("transicoes logisticas seguem fluxo linear e aceitam legado", () => {
  assert.equal(transicaoLogisticaPermitida("aguardando_aprovacao", "separando"), false);
  assert.equal(transicaoLogisticaPermitida("aprovado", "separando"), true);
  assert.equal(transicaoLogisticaPermitida("novo", "separando"), true);
  assert.equal(transicaoLogisticaPermitida("em_analise", "separando"), true);
  assert.equal(transicaoLogisticaPermitida("separando", "separado"), true);
  assert.equal(transicaoLogisticaPermitida("separado", "faturado"), true);
  assert.equal(transicaoLogisticaPermitida("faturado", "enviado"), true);
  assert.equal(transicaoLogisticaPermitida("enviado", "entregue"), false);
  assert.equal(transicaoLogisticaPermitida("entregue", "separando"), false);
  assert.equal(transicaoLogisticaPermitida("novo", "cancelado"), false);
});

test("pedido pendente nao aceita alteracao operacional nem pela superficie compartilhada", () => {
  const pedido = {
    status: "aguardando_aprovacao",
    itens: [{
      produtoId: new mongoose.Types.ObjectId(),
      nomeProduto: "Produto",
      quantidade: 2,
    }],
  };
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "separando" },
    usuario: { _id: objectId, tipo: "admin", nomeResponsavel: "Admin" },
  });
  assert.equal(result.valid, false);
  assert.equal(pedido.status, "aguardando_aprovacao");
  assert.equal(pedido.itens[0].quantidadeSeparada, undefined);
});

test("aprovacao atomica registra admin e rejeita a segunda requisicao", async () => {
  const originalFindOneAndUpdate = Pedido.findOneAndUpdate;
  const originalFindById = Pedido.findById;
  let statusAtual = "aguardando_aprovacao";
  let capturedFilter;
  let capturedUpdate;
  Pedido.findOneAndUpdate = (filter, update) => ({
    select: async () => {
      capturedFilter = filter;
      capturedUpdate = update;
      if (statusAtual !== "aguardando_aprovacao") return null;
      statusAtual = "aprovado";
      return {
        _id: objectId,
        status: "aprovado",
        itens: [],
        aprovacao: update.$set.aprovacao,
        historicoStatus: [update.$push.historicoStatus],
        toObject() { return { ...this }; },
      };
    },
  });
  Pedido.findById = () => ({
    select() { return this; },
    async lean() { return { _id: objectId, status: statusAtual }; },
  });
  const usuario = {
    _id: new mongoose.Types.ObjectId(),
    tipo: "admin",
    nomeResponsavel: "Ana Admin",
  };
  const first = createResponse();
  const second = createResponse();

  try {
    await Promise.all([
      aprovarPedidoAdmin({ params: { id: objectId }, usuario }, first),
      aprovarPedidoAdmin({ params: { id: objectId }, usuario }, second),
    ]);
  } finally {
    Pedido.findOneAndUpdate = originalFindOneAndUpdate;
    Pedido.findById = originalFindById;
  }

  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409]);
  assert.deepEqual(capturedFilter, { _id: objectId, status: "aguardando_aprovacao" });
  assert.equal(capturedUpdate.$set.status, "aprovado");
  assert.equal(capturedUpdate.$set.aprovacao.usuarioNome, "Ana Admin");
  assert.equal(capturedUpdate.$push.historicoStatus.usuarioTipo, "admin");
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

test("admin nao pode regredir pedido entregue pela superficie logistica", () => {
  const pedido = { status: "entregue" };
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "novo" },
    observacaoHistorico: "Correcao operacional",
    usuario: { _id: objectId, tipo: "admin", nomeResponsavel: "Admin" },
  });
  assert.equal(result.valid, false);
  assert.equal(pedido.status, "entregue");
  assert.equal(pedido.historicoStatus, undefined);
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

test("separacao valida falta parcial, total e calcula situacao por produto", () => {
  const parcialId = new mongoose.Types.ObjectId();
  const totalId = new mongoose.Types.ObjectId();
  const pedido = {
    status: "aprovado",
    itens: [
      { produtoId: parcialId, nomeProduto: "Produto parcial", quantidade: 12 },
      { produtoId: totalId, nomeProduto: "Produto indisponível", quantidade: 5 },
    ],
  };
  const usuario = {
    _id: new mongoose.Types.ObjectId(),
    tipo: "logistica",
    nomeResponsavel: "Operador",
  };
  const parsed = validateLogisticsOrderPayload({
    status: "separando",
    separacaoItens: [
      { produtoId: parcialId.toString(), quantidadeSeparada: 8 },
      { produtoId: totalId.toString(), quantidadeSeparada: 0 },
    ],
  });
  assert.equal(parsed.valid, true);
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: parsed.data,
    separacaoItens: parsed.separacaoItens,
    usuario,
  });
  assert.equal(result.valid, true);
  assert.equal(pedido.itens[0].situacaoSeparacao, "parcial");
  assert.equal(pedido.itens[1].situacaoSeparacao, "indisponivel");
  assert.equal(pedido.ocorrencias.length, 2);
  assert.ok(pedido.ocorrencias.every((entry) => entry.visibilidade === "interna"));

  const serialized = enrichOrderSeparation(pedido);
  assert.equal(serialized.itens[0].quantidadeFaltante, 4);
  assert.equal(serialized.itens[1].quantidadeFaltante, 5);
  assert.equal(serialized.temDivergencia, true);
});

test("separacao rejeita quantidade negativa, acima da solicitada e conclusao pendente", () => {
  const produtoId = new mongoose.Types.ObjectId();
  const negative = validateLogisticsOrderPayload({
    separacaoItens: [{ produtoId: produtoId.toString(), quantidadeSeparada: -1 }],
  });
  assert.equal(negative.valid, false);

  const pedido = {
    status: "separando",
    itens: [{ produtoId, nomeProduto: "Produto", quantidade: 5 }],
  };
  const usuario = { _id: objectId, tipo: "logistica", nomeResponsavel: "Operador" };
  const excessive = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "separando" },
    separacaoItens: [{ produtoId: produtoId.toString(), quantidadeSeparada: 6 }],
    usuario,
  });
  assert.equal(excessive.valid, false);
  assert.equal(pedido.itens[0].quantidadeSeparada, undefined);

  const pending = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "separado" },
    usuario,
  });
  assert.equal(pending.valid, false);
  assert.equal(pedido.status, "separando");
});

test("1. pedido nao pode iniciar conferencia antes da separacao terminar", () => {
  const pedido = criarPedidoParaConferencia({ status: "separando" });
  delete pedido.conferencia;
  const result = iniciarConferencia(pedido);
  assert.equal(result.valid, false);
  assert.match(result.message, /depois.*separa/);
  assert.equal(pedido.conferencia, undefined);
});

test("2. pedido separado corretamente entra em conferencia pendente", () => {
  const produtoId = new mongoose.Types.ObjectId();
  const pedido = {
    status: "separando",
    conferenciaObrigatoria: true,
    itens: [{ produtoId, nomeProduto: "Produto", quantidade: 4 }],
  };
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "separado" },
    separacaoItens: [{ produtoId: String(produtoId), quantidadeSeparada: 4 }],
    usuario: conferenciaUsuario(),
  });
  assert.equal(result.valid, true);
  assert.equal(pedido.status, "separado");
  assert.equal(pedido.conferencia.status, "pendente");
  assert.ok(pedido.ocorrencias.some((entry) => /aguardando confer.ncia/.test(entry.conteudo)));

  const tentativaAlteracao = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "separado" },
    separacaoItens: [{ produtoId: String(produtoId), quantidadeSeparada: 3 }],
    usuario: conferenciaUsuario(),
  });
  assert.equal(tentativaAlteracao.valid, false);
  assert.equal(pedido.itens[0].quantidadeSeparada, 4);
});

test("3. conferencia correta exige todos os itens e pode ser concluida", () => {
  const pedido = criarPedidoParaConferencia();
  assert.equal(iniciarConferencia(pedido).valid, true);

  const incompleta = validateLogisticsOrderPayload({
    conferencia: { acao: "concluir", itens: [], observacao: "" },
  });
  const negativa = validateLogisticsOrderPayload({
    conferencia: {
      acao: "concluir",
      itens: [{
        produtoId: String(pedido.itens[0].produtoId),
        quantidadeConferida: -1,
      }],
    },
  });
  assert.equal(incompleta.valid, false);
  assert.equal(negativa.valid, false);

  const result = concluirConferencia({ pedido });
  assert.equal(result.valid, true);
  assert.equal(pedido.conferencia.status, "concluida");
  assert.equal(pedido.conferencia.totalItens, 2);
  assert.equal(pedido.conferencia.totalDivergencias, 0);
});

test("4. conferencia divergente registra diferenca negativa por item", () => {
  const pedido = criarPedidoParaConferencia();
  iniciarConferencia(pedido);
  const result = concluirConferencia({
    pedido,
    quantidades: [11, 8],
    observacao: "Uma unidade nÃ£o estava no volume.",
  });
  assert.equal(result.valid, true);
  assert.equal(pedido.conferencia.status, "concluida_com_divergencia");
  assert.equal(pedido.conferencia.itens[0].diferenca, -1);
  assert.equal(pedido.conferencia.totalDivergencias, 1);
  assert.match(pedido.ocorrencias.at(-1).conteudo, /diferen.a -1/);
});

test("5. quantidade original da separacao permanece preservada", () => {
  const pedido = criarPedidoParaConferencia();
  iniciarConferencia(pedido);
  concluirConferencia({ pedido, quantidades: [11, 7] });
  assert.equal(pedido.itens[0].quantidadeSeparada, 12);
  assert.equal(pedido.itens[1].quantidadeSeparada, 8);
  assert.equal(pedido.conferencia.itens[0].quantidadeSeparada, 12);
  assert.equal(pedido.conferencia.itens[1].quantidadeSeparada, 8);
});

test("6. quantidade final e faltante ficam consistentes apos divergencia", () => {
  const pedido = criarPedidoParaConferencia();
  iniciarConferencia(pedido);
  concluirConferencia({ pedido, quantidades: [11, 7] });
  const serialized = enrichOrderSeparation(pedido);
  assert.equal(serialized.itens[0].quantidadeFinal, 11);
  assert.equal(serialized.itens[0].quantidadeAtendida, 11);
  assert.equal(serialized.itens[0].quantidadeFaltante, 1);
  assert.equal(serialized.itens[1].quantidadeFinal, 7);
  assert.equal(serialized.itens[1].quantidadeFaltante, 3);
});

test("7. faturamento nao e oferecido enquanto a conferencia esta pendente", () => {
  const pedido = criarPedidoParaConferencia();
  assert.deepEqual(transicoesPermitidasParaPedido(pedido), []);
  const adminTransitions = transicoesPermitidasParaPedido(pedido, { admin: true });
  assert.equal(adminTransitions.includes("faturado"), false);
  assert.equal(adminTransitions.includes("enviado"), false);
  iniciarConferencia(pedido);
  assert.deepEqual(transicoesPermitidasParaPedido(pedido), []);
  concluirConferencia({ pedido });
  assert.deepEqual(transicoesPermitidasParaPedido(pedido), ["faturado"]);
});

test("8. backend administrativo rejeita tentativa de pular conferencia", async () => {
  const originalFindById = Pedido.findById;
  const pedido = {
    ...criarPedidoParaConferencia(),
    async save() { assert.fail("pedido bloqueado nÃ£o deve ser salvo"); },
  };
  Pedido.findById = () => ({ select: async () => pedido });
  const response = createResponse();
  try {
    await atualizarStatusPedido({
      params: { id: objectId },
      body: { status: "enviado" },
      usuario: { _id: objectId, tipo: "admin", nomeResponsavel: "Admin" },
    }, response);
  } finally {
    Pedido.findById = originalFindById;
  }
  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /Conclua a confer.ncia/);
  assert.equal(pedido.status, "separado");
});

test("9. conferencia registra operador e horarios para o Admin", () => {
  const pedido = criarPedidoParaConferencia();
  const usuario = conferenciaUsuario();
  const inicio = new Date("2026-08-11T17:47:00.000Z");
  const conclusao = new Date("2026-08-11T17:53:00.000Z");
  iniciarConferencia(pedido, usuario, inicio);
  concluirConferencia({ pedido, usuario, now: conclusao });
  assert.equal(pedido.conferencia.iniciadoPor.usuarioId, usuario._id);
  assert.equal(pedido.conferencia.concluidoPor.usuarioNome, "Marcos Conferente");
  assert.equal(pedido.conferencia.iniciadaEm, inicio);
  assert.equal(pedido.conferencia.concluidaEm, conclusao);
});

test("10. Admin continua visualizando divergencias antigas", () => {
  const pedido = criarPedidoParaConferencia();
  iniciarConferencia(pedido);
  concluirConferencia({ pedido, quantidades: [10, 8] });
  pedido.status = "enviado";
  const adminView = enrichOrderSeparation(pedido);
  assert.equal(adminView.conferencia.status, "concluida_com_divergencia");
  assert.equal(adminView.conferencia.itens[0].quantidadeSeparada, 12);
  assert.equal(adminView.conferencia.itens[0].quantidadeConferida, 10);
  assert.equal(adminView.conferencia.itens[0].diferenca, -2);
});

test("11. cliente nao recebe conferencia, operador ou separacao interna", () => {
  const pedido = criarPedidoParaConferencia();
  iniciarConferencia(pedido);
  concluirConferencia({ pedido, quantidades: [11, 7] });
  const clientView = sanitizeClientOrder(pedido);
  assert.equal(Object.hasOwn(clientView, "conferencia"), false);
  assert.equal(Object.hasOwn(clientView, "conferenciaObrigatoria"), false);
  assert.equal(Object.hasOwn(clientView.itens[0], "quantidadeConferida"), false);
  assert.equal(Object.hasOwn(clientView.itens[0], "quantidadeFinal"), false);
  assert.equal(Object.hasOwn(clientView.itens[0], "quantidadeSeparada"), false);
  assert.equal(Object.hasOwn(clientView.itens[0], "quantidadeFaltante"), false);
  assert.equal(Object.hasOwn(clientView.itens[0], "situacaoSeparacao"), false);
});

test("12. pedido antigo sem conferencia continua podendo faturar", () => {
  const pedido = {
    status: "separado",
    itens: [{
      produtoId: new mongoose.Types.ObjectId(),
      nomeProduto: "Produto legado",
      quantidade: 1,
      quantidadeSeparada: 1,
    }],
  };
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "faturado" },
    usuario: conferenciaUsuario(),
  });
  assert.equal(result.valid, true);
  assert.equal(pedido.status, "faturado");
  assert.equal(pedido.conferencia, undefined);
});

test("13. recarregar durante e depois da conferencia preserva os dados", async () => {
  const pedido = new Pedido({
    numeroPedido: "PED-CONFERENCIA-PERSISTENCIA",
    clienteId: new mongoose.Types.ObjectId(),
    tabelaPrecoId: new mongoose.Types.ObjectId(),
    dia: 11,
    mes: 8,
    ano: 2026,
    itens: criarPedidoParaConferencia().itens.map((item) => ({
      ...item,
      valorUnitario: 10,
      subtotal: Number(item.quantidade) * 10,
    })),
    valorTotal: 220,
    status: "separado",
    conferenciaObrigatoria: true,
    conferencia: { status: "pendente" },
  });
  const usuario = conferenciaUsuario();
  iniciarConferencia(pedido, usuario, new Date("2026-08-11T17:47:00.000Z"));
  await pedido.validate();

  const durante = Pedido.hydrate(pedido.toObject());
  assert.equal(durante.conferencia.status, "em_andamento");
  assert.equal(durante.conferencia.iniciadoPor.usuarioNome, "Marcos Conferente");
  concluirConferencia({ pedido: durante, usuario, quantidades: [11, 8] });
  await durante.validate();

  const depois = Pedido.hydrate(durante.toObject());
  assert.equal(depois.conferencia.status, "concluida_com_divergencia");
  assert.equal(depois.conferencia.itens[0].quantidadeConferida, 11);
  assert.equal(depois.itens[0].quantidadeSeparada, 12);
});

test("14. conferencia concluida persiste apos faturamento, envio e entrega", () => {
  const pedido = criarPedidoParaConferencia();
  iniciarConferencia(pedido);
  concluirConferencia({ pedido, quantidades: [11, 8] });
  const conferenciaConcluida = pedido.conferencia;

  const faturamento = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "faturado" },
    usuario: conferenciaUsuario(),
  });
  const envio = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "enviado" },
    usuario: conferenciaUsuario(),
  });
  const receipt = buildClientReceiptConfirmationUpdate({ usuario: {
    _id: new mongoose.Types.ObjectId(),
    tipo: "cliente",
    nomeResponsavel: "Cliente",
  } });
  Object.assign(pedido, receipt.$set);

  assert.equal(faturamento.valid, true);
  assert.equal(envio.valid, true);
  assert.equal(pedido.status, "entregue");
  assert.equal(pedido.conferencia, conferenciaConcluida);
  assert.equal(pedido.conferencia.status, "concluida_com_divergencia");
});

test("ocorrencias guardam autoria interna e nunca sao entregues ao cliente", () => {
  const usuario = {
    _id: new mongoose.Types.ObjectId(),
    tipo: "logistica",
    nomeResponsavel: "João Operador",
  };
  const pedido = { status: "aprovado", itens: [] };
  const internal = applyLogisticsOrderUpdate({
    pedido,
    data: {},
    novaOcorrencia: {
      conteudo: "Conferência interna",
      tipo: "observacao",
      visibilidade: "interna",
    },
    usuario,
  });
  const visible = applyLogisticsOrderUpdate({
    pedido,
    data: {},
    novaOcorrencia: {
      conteudo: "Separação atualizada",
      tipo: "informacao_operacional",
      visibilidade: "cliente",
    },
    usuario,
  });
  assert.equal(internal.valid, true);
  assert.equal(visible.valid, true);
  assert.equal(pedido.ocorrencias[0].usuarioNome, "João Operador");
  assert.equal(pedido.ocorrencias[1].visibilidade, "interna");

  const clientOrder = sanitizeClientOrder({ ...pedido, observacaoLogistica: "segredo" });
  assert.equal(Object.hasOwn(clientOrder, "ocorrencias"), false);
  assert.equal(Object.hasOwn(clientOrder, "observacaoLogistica"), false);
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
  assert.deepEqual(filter.status, {
    $nin: ["entregue", "cancelado", "aguardando_aprovacao"],
  });
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
  assert.ok(filter.status.$nin.includes("aguardando_aprovacao"));
});

test("filtro da logistica esconde pendentes e admin pode consulta-los", () => {
  const parsed = parseLogisticsOrderQuery({});
  assert.deepEqual(buildLogisticsOrderFilter(parsed.data).status, {
    $ne: "aguardando_aprovacao",
  });
  assert.equal(
    buildLogisticsOrderFilter(parsed.data, { includePendingApproval: true }).status,
    undefined
  );
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

const criarPedidoAuditoria = () => {
  const clienteId = new mongoose.Types.ObjectId();
  const usuarioId = new mongoose.Types.ObjectId();
  const produtoId = new mongoose.Types.ObjectId();
  const user = {
    usuarioId,
    usuarioNome: "Operador Auditável",
    usuarioTipo: "logistica",
  };
  return {
    _id: new mongoose.Types.ObjectId(),
    numeroPedido: "PED-AUD-1",
    clienteId,
    nomeResponsavel: "Cliente Auditável",
    nomeFantasiaCliente: "Pet Auditável",
    razaoSocialCliente: "Pet Auditável Ltda",
    cnpjCliente: "00.000.000/0001-00",
    createdAt: new Date("2026-08-01T12:00:00.000Z"),
    dataPedido: new Date("2026-08-01T12:00:00.000Z"),
    status: "entregue",
    valorTotal: 100,
    itens: [{
      produtoId,
      nomeProduto: "Shampoo Auditoria",
      quantidade: 10,
      quantidadeSeparada: 9,
      quantidadeConferida: 8,
      quantidadeFinal: 8,
      situacaoSeparacao: "parcial",
      situacaoFinal: "parcial",
      valorUnitario: 10,
      subtotal: 100,
    }],
    aprovacao: {
      aprovadoEm: new Date("2026-08-01T13:00:00.000Z"),
      ...user,
      usuarioTipo: "admin",
    },
    historicoStatus: [
      { statusAnterior: "aguardando_aprovacao", novoStatus: "aprovado", alteradoEm: new Date("2026-08-01T13:00:00.000Z"), ...user, usuarioTipo: "admin" },
      { statusAnterior: "aprovado", novoStatus: "separando", alteradoEm: new Date("2026-08-01T14:00:00.000Z"), ...user },
      { statusAnterior: "separando", novoStatus: "separado", alteradoEm: new Date("2026-08-01T15:00:00.000Z"), ...user },
      { statusAnterior: "separado", novoStatus: "faturado", alteradoEm: new Date("2026-08-01T18:00:00.000Z"), ...user },
      { statusAnterior: "faturado", novoStatus: "enviado", alteradoEm: new Date("2026-08-01T19:00:00.000Z"), ...user },
      { statusAnterior: "enviado", novoStatus: "entregue", alteradoEm: new Date("2026-08-02T12:00:00.000Z"), ...user, usuarioTipo: "cliente", usuarioNome: "Cliente Auditável" },
    ],
    conferenciaObrigatoria: true,
    conferencia: {
      status: "concluida_com_divergencia",
      iniciadaEm: new Date("2026-08-01T16:00:00.000Z"),
      iniciadoPor: user,
      concluidaEm: new Date("2026-08-01T17:00:00.000Z"),
      concluidoPor: user,
      observacao: "Uma unidade avariada.",
      totalItens: 1,
      totalDivergencias: 1,
      itens: [{
        produtoId,
        nomeProduto: "Shampoo Auditoria",
        quantidadeSolicitada: 10,
        quantidadeSeparada: 9,
        quantidadeFaltanteSeparacao: 1,
        quantidadeConferida: 8,
        diferenca: -1,
        situacaoFinal: "parcial",
      }],
    },
    ocorrencias: [
      { conteudo: "Quantidade separada ajustada.", criadaEm: new Date("2026-08-01T14:30:00.000Z"), tipo: "falta_produto", visibilidade: "interna", produtoId, nomeProduto: "Shampoo Auditoria", ...user },
      { conteudo: "Conferência dos itens iniciada.", criadaEm: new Date("2026-08-01T16:00:00.000Z"), tipo: "informacao_operacional", visibilidade: "interna", ...user },
      { conteudo: "Conferência concluída.", criadaEm: new Date("2026-08-01T17:00:00.000Z"), tipo: "informacao_operacional", visibilidade: "interna", ...user },
      { conteudo: "Shampoo: diferença -1.", criadaEm: new Date("2026-08-01T17:00:00.000Z"), tipo: "falta_produto", visibilidade: "interna", produtoId, nomeProduto: "Shampoo Auditoria", ...user },
      { conteudo: "Observação manual preservada.", criadaEm: new Date("2026-08-01T17:30:00.000Z"), tipo: "observacao", visibilidade: "cliente", ...user },
    ],
  };
};

test("auditoria registra a criacao a partir da data persistida", () => {
  const timeline = buildOrderAuditTimeline(criarPedidoAuditoria());
  assert.equal(timeline[0].tipo, "pedido_criado");
  assert.equal(timeline[0].data.toISOString(), "2026-08-01T12:00:00.000Z");
  assert.equal(timeline[0].responsavelPerfil, "cliente");
});

test("auditoria ordena todos os eventos cronologicamente", () => {
  const timeline = buildOrderAuditTimeline(criarPedidoAuditoria());
  const times = timeline.map((event) => event.data.getTime());
  assert.deepEqual(times, [...times].sort((left, right) => left - right));
});

test("auditoria nao duplica aprovacao quando ha historico de status", () => {
  const timeline = buildOrderAuditTimeline(criarPedidoAuditoria());
  assert.equal(timeline.filter((event) => event.tipo === "pedido_aprovado").length, 1);
});

test("auditoria usa aprovacao estruturada como compatibilidade", () => {
  const pedido = criarPedidoAuditoria();
  pedido.historicoStatus = [];
  const approval = buildOrderAuditTimeline(pedido).find((event) => event.tipo === "pedido_aprovado");
  assert.equal(approval.responsavelNome, "Operador Auditável");
  assert.equal(approval.statusNovo, "aprovado");
});

test("auditoria mapeia faturamento envio e entrega somente do historico", () => {
  const types = buildOrderAuditTimeline(criarPedidoAuditoria()).map((event) => event.tipo);
  assert.ok(types.includes("pedido_faturado"));
  assert.ok(types.includes("pedido_enviado"));
  assert.ok(types.includes("pedido_entregue"));
});

test("auditoria usa datas operacionais reais como fallback de pedidos antigos", () => {
  const timeline = buildOrderAuditTimeline({
    createdAt: new Date("2025-01-01T12:00:00.000Z"),
    status: "entregue",
    numeroNotaFiscal: "NF-LEG-1",
    transportadora: "Transportadora Legada",
    dataFaturamento: new Date("2025-01-02T12:00:00.000Z"),
    dataEnvio: new Date("2025-01-03T12:00:00.000Z"),
    dataEntrega: new Date("2025-01-04T12:00:00.000Z"),
  });
  assert.deepEqual(timeline.map((event) => event.tipo), [
    "pedido_criado",
    "pedido_faturado",
    "pedido_enviado",
    "pedido_entregue",
  ]);
  assert.match(timeline[1].detalhes, /NF-LEG-1/);
  assert.match(timeline[2].detalhes, /Transportadora Legada/);
});

test("auditoria nao duplica datas operacionais quando o historico existe", () => {
  const pedido = criarPedidoAuditoria();
  pedido.dataFaturamento = new Date("2026-08-01T18:00:00.000Z");
  pedido.dataEnvio = new Date("2026-08-01T19:00:00.000Z");
  pedido.dataEntrega = new Date("2026-08-02T12:00:00.000Z");
  const timeline = buildOrderAuditTimeline(pedido);
  assert.equal(timeline.filter((event) => event.tipo === "pedido_faturado").length, 1);
  assert.equal(timeline.filter((event) => event.tipo === "pedido_enviado").length, 1);
  assert.equal(timeline.filter((event) => event.tipo === "pedido_entregue").length, 1);
});

test("auditoria registra inicio e conclusao reais da separacao", () => {
  const timeline = buildOrderAuditTimeline(criarPedidoAuditoria());
  assert.equal(timeline.find((event) => event.tipo === "separacao_iniciada").responsavelNome, "Operador Auditável");
  assert.match(timeline.find((event) => event.tipo === "separacao_concluida").detalhes, /1 item/);
});

test("auditoria registra inicio e conclusao da conferencia", () => {
  const types = buildOrderAuditTimeline(criarPedidoAuditoria()).map((event) => event.tipo);
  assert.equal(types.filter((type) => type === "conferencia_iniciada").length, 1);
  assert.equal(types.filter((type) => type === "conferencia_concluida").length, 1);
});

test("auditoria detalha divergencia por produto", () => {
  const divergence = buildOrderAuditTimeline(criarPedidoAuditoria())
    .find((event) => event.tipo === "divergencia_conferencia");
  assert.equal(divergence.nomeProduto, "Shampoo Auditoria");
  assert.equal(divergence.dados.diferenca, -1);
  assert.match(divergence.detalhes, /separado 9, conferido 8/);
});

test("auditoria elimina ocorrencias automaticas duplicadas da conferencia", () => {
  const timeline = buildOrderAuditTimeline(criarPedidoAuditoria());
  assert.equal(timeline.filter((event) => event.tipo === "conferencia_iniciada").length, 1);
  assert.equal(timeline.filter((event) => event.tipo === "divergencia_conferencia").length, 1);
  assert.doesNotMatch(timeline.map((event) => event.detalhes).join(" "), /Conferência dos itens iniciada/);
});

test("auditoria elimina ocorrencia automatica duplicada da conclusao da separacao", () => {
  const date = new Date("2026-08-01T15:00:00.000Z");
  const timeline = buildOrderAuditTimeline({
    createdAt: new Date("2026-08-01T12:00:00.000Z"),
    itens: [{ quantidade: 1, quantidadeSeparada: 1 }],
    historicoStatus: [{
      statusAnterior: "separando",
      novoStatus: "separado",
      alteradoEm: date,
    }],
    ocorrencias: [{
      conteudo: "Separação concluída. Pedido aguardando conferência dos itens.",
      tipo: "informacao_operacional",
      criadaEm: date,
    }],
  });
  assert.equal(timeline.filter((event) => event.tipo === "separacao_concluida").length, 1);
  assert.equal(timeline.filter((event) => event.tipo === "ocorrencia").length, 0);
});

test("auditoria preserva ocorrencias manuais mesmo se eram marcadas ao cliente", () => {
  const event = buildOrderAuditTimeline(criarPedidoAuditoria())
    .find((entry) => entry.detalhes === "Observação manual preservada.");
  assert.equal(event.tipo, "ocorrencia");
  assert.equal(event.responsavelPerfil, "logistica");
});

test("auditoria preserva alteracoes reais de item na separacao", () => {
  const event = buildOrderAuditTimeline(criarPedidoAuditoria())
    .find((entry) => entry.detalhes === "Quantidade separada ajustada.");
  assert.equal(event.nomeProduto, "Shampoo Auditoria");
});

test("auditoria nao infere etapas apenas pelo status atual", () => {
  const timeline = buildOrderAuditTimeline({
    status: "entregue",
    createdAt: new Date("2026-08-01T12:00:00.000Z"),
    historicoStatus: [],
  });
  assert.deepEqual(timeline.map((event) => event.tipo), ["pedido_criado"]);
});

test("auditoria e compativel com pedido antigo sem conferencia", () => {
  const timeline = buildOrderAuditTimeline({
    dataPedido: new Date("2025-01-01T12:00:00.000Z"),
    status: "faturado",
    historicoStatus: [],
  });
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].tipo, "pedido_criado");
});

test("detalhe interno inclui timeline e mantem dados operacionais", () => {
  const detail = enrichInternalOrderDetail(criarPedidoAuditoria());
  assert.ok(detail.historicoPedido.length > 8);
  assert.equal(detail.ocorrencias.length, 5);
  assert.equal(detail.itens[0].quantidadeFaltante, 2);
});

test("DTO do cliente usa whitelist comercial exata para cada item", () => {
  const client = sanitizeClientOrder(criarPedidoAuditoria());
  assert.deepEqual(Object.keys(client.itens[0]).sort(), [
    "nomeProduto",
    "produtoId",
    "quantidade",
    "subtotal",
    "valorUnitario",
  ]);
});

test("DTO do cliente remove todos os dados internos inclusive legado publico", () => {
  const client = sanitizeClientOrder({
    ...criarPedidoAuditoria(),
    historicoPedido: [{ titulo: "Interno" }],
    temDivergencia: true,
  });
  for (const field of [
    "historicoStatus",
    "historicoPedido",
    "aprovacao",
    "conferencia",
    "conferenciaObrigatoria",
    "ocorrencias",
    "observacaoLogistica",
    "temDivergencia",
  ]) {
    assert.equal(Object.hasOwn(client, field), false, field);
  }
});

test("DTO do cliente preserva status tracking e valores comerciais", () => {
  const pedido = criarPedidoAuditoria();
  pedido.numeroNotaFiscal = "NF-100";
  pedido.codigoRastreio = "R-100";
  const client = sanitizeClientOrder(pedido);
  assert.equal(client.status, "entregue");
  assert.equal(client.numeroNotaFiscal, "NF-100");
  assert.equal(client.codigoRastreio, "R-100");
  assert.equal(client.valorTotal, 100);
});

test("pedido entregue nao oferece transicao nem para Admin", () => {
  assert.deepEqual(transicoesPermitidasParaPedido({ status: "entregue" }), []);
  assert.deepEqual(transicoesPermitidasParaPedido({ status: "entregue" }, { admin: true }), []);
});

test("historico de entrega tambem encerra pedido que ja foi regredido no legado", () => {
  const pedido = {
    status: "novo",
    historicoStatus: [{ novoStatus: "entregue" }],
    itens: [],
  };
  assert.deepEqual(transicoesPermitidasParaPedido(pedido, { admin: true }), []);
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "separando" },
    usuario: conferenciaUsuario(),
  });
  assert.equal(result.valid, false);
  assert.equal(pedido.status, "novo");
});

test("pedido entregue rejeita tambem mutacao sem regressao", () => {
  const pedido = { status: "entregue", numeroNotaFiscal: "NF-antiga" };
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: { numeroNotaFiscal: "NF-nova" },
    usuario: conferenciaUsuario(),
  });
  assert.equal(result.valid, false);
  assert.equal(pedido.numeroNotaFiscal, "NF-antiga");
});

test("atualizador generico rejeita regressao de pedido entregue", async () => {
  const originalFindById = Pedido.findById;
  const pedido = {
    status: "entregue",
    async save() { assert.fail("pedido entregue não deve ser salvo"); },
  };
  Pedido.findById = () => ({ select: async () => pedido });
  const response = createResponse();
  try {
    await atualizarStatusPedido({
      params: { id: objectId },
      body: { status: "enviado" },
      usuario: { _id: objectId, tipo: "admin", nomeResponsavel: "Admin" },
    }, response);
  } finally {
    Pedido.findById = originalFindById;
  }
  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /terminal|regredir/);
  assert.equal(pedido.status, "entregue");
});

test("ocorrencia pedida como cliente e normalizada para interna", () => {
  const parsed = validateLogisticsOrderPayload({
    novaOcorrencia: {
      conteudo: "Nunca publicar",
      tipo: "observacao",
      visibilidade: "cliente",
    },
  });
  assert.equal(parsed.valid, true);
  assert.equal(parsed.novaOcorrencia.visibilidade, "interna");
});

test("relatorio operacional possui rota exclusiva de Admin", () => {
  const route = pedidoRouter.stack.find((layer) => (
    layer.route?.path === "/:id/relatorio" && layer.route.methods.get
  ));
  assert.ok(route);
  assert.ok(route.route.stack.some((layer) => layer.handle === somenteAdmin));
});

test("dados do relatorio identificam aprovacao separacao conferencia e final", () => {
  const data = buildOrderAuditPdfData(criarPedidoAuditoria());
  assert.equal(data.numeroPedido, "PED-AUD-1");
  assert.equal(data.statusLabel, "Entregue");
  assert.equal(data.aprovacao.responsavel, "Operador Auditável");
  assert.equal(data.separacao.iniciadaPor, "Operador Auditável");
  assert.equal(data.conferencia.totalDivergencias, 1);
});

test("dados do relatorio incluem quantidades solicitada separada conferida final e faltante", () => {
  const item = buildOrderAuditPdfData(criarPedidoAuditoria()).items[0];
  assert.deepEqual(item, {
    nomeProduto: "Shampoo Auditoria",
    quantidadeSolicitada: 10,
    quantidadeSeparada: 9,
    quantidadeConferida: 8,
    quantidadeFinal: 8,
    quantidadeFaltante: 2,
    situacaoSeparacao: "parcial",
    situacaoFinal: "parcial",
  });
});

test("dados do relatorio legado sinalizam ausencias sem inventar conferencia", () => {
  const data = buildOrderAuditPdfData({
    numeroPedido: "LEG-1",
    status: "faturado",
    dataPedido: new Date("2025-01-01T12:00:00.000Z"),
    itens: [],
  });
  assert.equal(data.possuiDadosOperacionaisLegados, true);
  assert.equal(data.conferencia, null);
  assert.equal(data.separacao.iniciadaEm, "-");
});

test("relatorio reconhece entrega persistida mesmo com status legado regredido", () => {
  const data = buildOrderAuditPdfData({
    numeroPedido: "LEG-ENTREGA",
    status: "novo",
    dataPedido: new Date("2025-01-01T12:00:00.000Z"),
    dataEntrega: new Date("2025-01-02T12:00:00.000Z"),
    itens: [],
  });
  assert.equal(data.status, "entregue");
  assert.equal(data.statusLabel, "Entregue");
  assert.ok(data.timeline.some((event) => event.tipo === "pedido_entregue"));
});

test("dados do relatorio nao carregam precos comerciais nos itens", () => {
  const serialized = JSON.stringify(buildOrderAuditPdfData(criarPedidoAuditoria()).items);
  assert.doesNotMatch(serialized, /valorUnitario|subtotal|valorTotal/);
});

test("servico gera arquivo PDF e headers de download", async () => {
  const response = new PassThrough();
  const headers = {};
  const chunks = [];
  response.setHeader = (name, value) => { headers[name] = value; };
  response.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    response.on("finish", resolve);
    response.on("error", reject);
  });

  gerarPdfRelatorioPedido(criarPedidoAuditoria(), response);
  await finished;

  const output = Buffer.concat(chunks);
  assert.equal(output.subarray(0, 5).toString(), "%PDF-");
  assert.equal(headers["Content-Type"], "application/pdf");
  assert.match(headers["Content-Disposition"], /relatorio-PED-AUD-1\.pdf/);
});
