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
  atualizarPedidoAdmin,
  atualizarStatusPedido,
  confirmarRecebimento,
} from "../src/controllers/pedidoController.js";
import {
  applyLogisticsOrderUpdate,
  atualizarPedidoLogistica,
  buildLogisticsOrderFilter,
  parseLogisticsOrderQuery,
} from "../src/controllers/logisticaController.js";
import {
  enrichOrderSeparation,
  enrichInternalOrderDetail,
  buildClientReceiptConfirmationUpdate,
  getItemSeparation,
  sanitizeClientOrder,
  transicaoLogisticaPermitida,
  transicoesPermitidasParaPedido,
  validateLogisticsClosing,
  validateLogisticsOrderPayload,
} from "../src/utils/pedidoLogistica.js";
import {
  applyAdminOrderEdit,
  pedidoPodeSerEditadoPeloAdmin,
} from "../src/utils/pedidoEdicaoAdmin.js";
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
  segundaQuantidadeSeparada = 10,
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
        quantidadeSeparada: segundaQuantidadeSeparada,
        situacaoSeparacao: segundaQuantidadeSeparada === 10 ? "completo" : "parcial",
      },
    ],
  };
};

const operadorLogistica = () => ({
  _id: new mongoose.Types.ObjectId(),
  nome: "Pedro Operador",
});

const criarPedidoParaFechamento = (overrides = {}) => ({
  ...criarPedidoParaConferencia({ conferencia: { status: "concluida" } }),
  fechamentoLogisticoObrigatorio: true,
  ocorrencias: [],
  ...overrides,
});

const registrarFechamento = ({
  pedido = criarPedidoParaFechamento(),
  usuario = conferenciaUsuario(),
  operador = operadorLogistica(),
  now = new Date("2026-08-12T15:00:00.000Z"),
  fechamentoLogistico = {
    quantidadeVolumes: 3,
    pesoTotalKg: 38.5,
    observacaoVolumes: "Duas caixas grandes e uma caixa pequena lacrada.",
  },
} = {}) => ({
  pedido,
  usuario,
  operador,
  result: applyLogisticsOrderUpdate({
    pedido,
    data: {},
    fechamentoLogistico,
    usuario,
    operador,
    now,
  }),
});

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
    "comercial",
    "vendedor",
    "marketing",
    "logistica",
    "cliente",
    "groomer",
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
  assert.equal(cadastroClienteBloqueiaAcesso({ tipo: "comercial", statusCadastro: "pendente" }), false);
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
  for (const tipo of ["cliente", "comercial", "marketing"]) {
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
    "verificarPermissao",
  ]);
});

test("transicoes logisticas seguem fluxo linear e aceitam legado", () => {
  assert.equal(transicaoLogisticaPermitida("aguardando_aprovacao", "separando"), false);
  assert.equal(transicaoLogisticaPermitida("aprovado", "separando"), true);
  assert.equal(transicaoLogisticaPermitida("novo", "separando"), true);
  assert.equal(transicaoLogisticaPermitida("em_analise", "separando"), true);
  assert.equal(transicaoLogisticaPermitida("separando", "separado"), true);
  assert.equal(transicaoLogisticaPermitida("separado", "faturado"), false);
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

for (const tipo of ["admin", "comercial"]) {
test(`aprovacao atomica registra ${tipo} e rejeita a segunda requisicao`, async () => {
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
    tipo,
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
  assert.equal(capturedUpdate.$set.aprovacao.usuarioTipo, tipo);
  const document = new Pedido({ aprovacao: capturedUpdate.$set.aprovacao, historicoStatus: [capturedUpdate.$push.historicoStatus] });
  await document.aprovacao.validate();
  await document.historicoStatus[0].validate();
  assert.equal(capturedUpdate.$set.aprovacao.usuarioNome, "Ana Admin");
  assert.equal(capturedUpdate.$push.historicoStatus.usuarioTipo, tipo);
});
}

test("inicio da separacao registra historico imutavel e autoria sem aceitar expedicao antecipada", () => {
  const pedido = { status: "novo" };
  const usuario = {
    _id: new mongoose.Types.ObjectId(),
    tipo: "logistica",
    nomeResponsavel: "Maria Logistica",
  };
  const now = new Date("2026-08-07T17:30:00.000Z");
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "separando" },
    observacaoHistorico: "Separacao iniciada",
    usuario,
    now,
  });
  assert.equal(result.valid, true);
  assert.equal(pedido.status, "separando");
  assert.equal(pedido.transportadora, undefined);
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

test("dados de faturamento e envio sao rejeitados antes do status faturado", () => {
  const pedido = { status: "aprovado", itens: [] };
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: {
      status: "separando",
      numeroNotaFiscal: "NF-antecipada",
      dataEnvio: new Date("2026-08-07T00:00:00.000Z"),
    },
    usuario: { _id: objectId, tipo: "logistica", nomeResponsavel: "Teste" },
  });
  assert.equal(result.valid, false);
  assert.match(result.message, /Nota Fiscal.*Admin.*faturar/);
  assert.equal(pedido.status, "aprovado");
  assert.equal(pedido.numeroNotaFiscal, undefined);
  assert.equal(pedido.dataEnvio, undefined);
});

test("pedido aprovado inicia separacao sem registrar quantidades antecipadamente", () => {
  const produtoId = new mongoose.Types.ObjectId();
  const pedido = {
    status: "aprovado",
    itens: [{ produtoId, nomeProduto: "Produto", quantidade: 3 }],
  };
  const usuario = { _id: objectId, tipo: "logistica", nomeResponsavel: "Teste" };
  const antecipada = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "separando" },
    separacaoItens: [{ produtoId: String(produtoId), quantidadeSeparada: 3 }],
    usuario,
  });
  assert.equal(antecipada.valid, false);
  assert.match(antecipada.message, /durante a separação/);
  assert.equal(pedido.status, "aprovado");

  const inicio = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "separando" },
    usuario,
  });
  assert.equal(inicio.valid, true);
  assert.equal(pedido.status, "separando");
  assert.equal(pedido.itens[0].quantidadeSeparada, undefined);
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

test("pedido faturado exige NF e datas antes de ser marcado como enviado", () => {
  const pedido = { status: "faturado", itens: [] };
  const usuario = { _id: objectId, tipo: "logistica", nomeResponsavel: "Teste" };
  const incompleto = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "enviado", transportadora: "Transportes Atual" },
    usuario,
  });
  assert.equal(incompleto.valid, false);
  assert.match(incompleto.message, /número da Nota Fiscal/);
  assert.match(incompleto.message, /data de faturamento/);
  assert.match(incompleto.message, /data de envio/);
  assert.equal(pedido.status, "faturado");

  pedido.numeroNotaFiscal = "NF-123";
  pedido.dataFaturamento = new Date("2026-08-07T12:00:00.000Z");
  const completo = applyLogisticsOrderUpdate({
    pedido,
    data: {
      status: "enviado",
      dataEnvio: new Date("2026-08-08T12:00:00.000Z"),
    },
    usuario,
  });
  assert.equal(completo.valid, true);
  assert.equal(pedido.status, "enviado");
  assert.equal(pedido.transportadora, undefined);
});

test("pedido enviado bloqueia edicao posterior dos dados de expedicao", () => {
  const pedido = {
    status: "enviado",
    numeroNotaFiscal: "NF-original",
    transportadora: "Original",
  };
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: { transportadora: "Alterada" },
    usuario: { _id: objectId, tipo: "admin", nomeResponsavel: "Admin" },
  });
  assert.equal(result.valid, false);
  assert.match(result.message, /só podem ser informados.*faturado/);
  assert.equal(pedido.transportadora, "Original");
});

test("separacao valida falta parcial, total e calcula situacao por produto", () => {
  const parcialId = new mongoose.Types.ObjectId();
  const totalId = new mongoose.Types.ObjectId();
  const pedido = {
    status: "separando",
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

test("conclusão da separação exige igualdade atual em todos os itens", () => {
  const produtoId = new mongoose.Types.ObjectId();
  const usuario = conferenciaUsuario();
  const pedido = {
    status: "separando",
    conferenciaObrigatoria: true,
    itens: [{
      produtoId,
      nomeProduto: "Shampoo",
      quantidade: 10,
      quantidadeSeparada: 8,
    }],
  };

  const parcial = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "separado" },
    usuario,
  });
  assert.equal(parcial.valid, false);
  assert.match(parcial.message, /Não é possível concluir a separação/);
  assert.match(parcial.message, /Shampoo: pedido atual 10, separado 8/);
  assert.equal(parcial.blockers[0].tipo, "quantidade_pendente");
  assert.equal(pedido.status, "separando");

  const completo = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "separado" },
    separacaoItens: [{ produtoId: String(produtoId), quantidadeSeparada: 10 }],
    usuario,
  });
  assert.equal(completo.valid, true);
  assert.equal(pedido.status, "separado");
  assert.equal(pedido.conferencia.status, "pendente");

  const pedidoComVariosItens = {
    status: "separando",
    itens: [
      {
        produtoId: new mongoose.Types.ObjectId(),
        nomeProduto: "Item completo",
        quantidade: 4,
        quantidadeSeparada: 4,
      },
      {
        produtoId: new mongoose.Types.ObjectId(),
        nomeProduto: "Item parcial",
        quantidade: 5,
        quantidadeSeparada: 3,
      },
    ],
  };
  const varios = applyLogisticsOrderUpdate({
    pedido: pedidoComVariosItens,
    data: { status: "separado" },
    usuario,
  });
  assert.equal(varios.valid, false);
  assert.equal(varios.blockers.length, 1);
  assert.equal(varios.blockers[0].nomeProduto, "Item parcial");
  assert.equal(pedidoComVariosItens.status, "separando");
});

test("1. pedido nao pode iniciar conferencia antes da separacao terminar", () => {
  const pedido = criarPedidoParaConferencia({ status: "separando" });
  delete pedido.conferencia;
  const result = iniciarConferencia(pedido);
  assert.equal(result.valid, false);
  assert.match(result.message, /depois.*separa/);
  assert.equal(pedido.conferencia, undefined);
});

test("2. pedido separado corretamente entra em conferencia pendente e aceita correção antes da conclusão", () => {
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
  assert.equal(tentativaAlteracao.valid, true);
  assert.equal(pedido.itens[0].quantidadeSeparada, 3);
  assert.equal(pedido.conferencia.status, "pendente");
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

test("4. conferencia divergente é bloqueada sem gravar uma conclusão inválida", () => {
  const pedido = criarPedidoParaConferencia();
  iniciarConferencia(pedido);
  const result = concluirConferencia({
    pedido,
    quantidades: [11, 10],
    observacao: "Uma unidade nÃ£o estava no volume.",
  });
  assert.equal(result.valid, false);
  assert.match(result.message, /Não é possível concluir a conferência/);
  assert.match(result.message, /Produto X/);
  assert.equal(pedido.conferencia.status, "em_andamento");
  assert.equal(pedido.conferencia.itens, undefined);
});

test("5. separação parcial bloqueia a conferência e permanece preservada", () => {
  const pedido = criarPedidoParaConferencia({ segundaQuantidadeSeparada: 8 });
  iniciarConferencia(pedido);
  const result = concluirConferencia({ pedido, quantidades: [12, 8] });
  assert.equal(result.valid, false);
  assert.equal(pedido.itens[0].quantidadeSeparada, 12);
  assert.equal(pedido.itens[1].quantidadeSeparada, 8);
  assert.equal(pedido.itens[0].quantidadeConferida, undefined);
  assert.equal(pedido.conferencia.status, "em_andamento");
});

test("6. conclusão correta grava quantidades finais consistentes", () => {
  const pedido = criarPedidoParaConferencia();
  iniciarConferencia(pedido);
  const result = concluirConferencia({ pedido, quantidades: [12, 10] });
  assert.equal(result.valid, true);
  const serialized = enrichOrderSeparation(pedido);
  assert.equal(serialized.itens[0].quantidadeFinal, 12);
  assert.equal(serialized.itens[0].quantidadeAtendida, 12);
  assert.equal(serialized.itens[0].quantidadeFaltante, 0);
  assert.equal(serialized.itens[1].quantidadeFinal, 10);
  assert.equal(serialized.itens[1].quantidadeFaltante, 0);
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
  assert.deepEqual(transicoesPermitidasParaPedido(pedido), []);
  assert.equal(
    transicoesPermitidasParaPedido(pedido, { admin: true }).includes("faturado"),
    true
  );
});

test("barreira Conferência para Faturamento rejeita conferência de versão antiga", () => {
  const pedido = criarPedidoParaConferencia();
  iniciarConferencia(pedido);
  assert.equal(concluirConferencia({ pedido }).valid, true);
  assert.equal(
    transicoesPermitidasParaPedido(pedido, { admin: true }).includes("faturado"),
    true
  );

  pedido.versaoOperacional = Number(pedido.versaoOperacional || 1) + 1;
  assert.equal(
    transicoesPermitidasParaPedido(pedido, { admin: true }).includes("faturado"),
    false
  );
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: {
      status: "faturado",
      numeroNotaFiscal: "NF-VERSAO-ANTIGA",
      dataFaturamento: new Date("2026-08-13T18:00:00.000Z"),
    },
    usuario: { _id: objectId, tipo: "admin", nomeResponsavel: "Admin" },
  });
  assert.equal(result.valid, false);
  assert.match(result.message, /Conclua a conferência de todos os itens/);
  assert.equal(pedido.status, "separado");
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

test("rota administrativa de status tambem exige dados antes do envio", async () => {
  const originalFindById = Pedido.findById;
  const pedido = {
    status: "faturado",
    async save() { assert.fail("pedido incompleto não deve ser salvo"); },
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
  assert.match(response.body.message, /número da Nota Fiscal/);
  assert.equal(pedido.status, "faturado");
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
  pedido.conferencia = {
    status: "concluida_com_divergencia",
    itens: [{
      produtoId: pedido.itens[0].produtoId,
      nomeProduto: pedido.itens[0].nomeProduto,
      quantidadeSolicitada: 12,
      quantidadeSeparada: 12,
      quantidadeFaltanteSeparacao: 0,
      quantidadeConferida: 10,
      diferenca: -2,
      situacaoFinal: "parcial",
    }],
    totalItens: 1,
    totalDivergencias: 1,
  };
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

test("12. pedido antigo sem conferencia continua podendo faturar pelo Admin", () => {
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
    data: {
      status: "faturado",
      numeroNotaFiscal: "NF-LEGADA",
      dataFaturamento: new Date("2026-08-11T18:00:00.000Z"),
    },
    usuario: { _id: objectId, tipo: "admin", nomeResponsavel: "Admin" },
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
  concluirConferencia({ pedido: durante, usuario, quantidades: [12, 10] });
  await durante.validate();

  const depois = Pedido.hydrate(durante.toObject());
  assert.equal(depois.conferencia.status, "concluida");
  assert.equal(depois.conferencia.itens[0].quantidadeConferida, 12);
  assert.equal(depois.itens[0].quantidadeSeparada, 12);
});

test("14. conferencia concluida persiste apos faturamento, envio e entrega", () => {
  const pedido = criarPedidoParaConferencia();
  iniciarConferencia(pedido);
  concluirConferencia({ pedido, quantidades: [12, 10] });
  const conferenciaConcluida = pedido.conferencia;

  const faturamento = applyLogisticsOrderUpdate({
    pedido,
    data: {
      status: "faturado",
      numeroNotaFiscal: "NF-2026-001",
      dataFaturamento: new Date("2026-08-11T18:00:00.000Z"),
    },
    usuario: { _id: objectId, tipo: "admin", nomeResponsavel: "Admin" },
  });
  const envio = applyLogisticsOrderUpdate({
    pedido,
    data: {
      status: "enviado",
      dataEnvio: new Date("2026-08-11T19:00:00.000Z"),
    },
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
  assert.equal(pedido.conferencia.status, "concluida");
});

const criarPedidoParaEdicaoAdmin = ({
  quantidade = 10,
  quantidadeSeparada = 8,
  status = "separado",
  conferencia = {
    status: "em_andamento",
    iniciadaEm: new Date("2026-08-13T12:00:00.000Z"),
    iniciadoPor: {
      usuarioId: new mongoose.Types.ObjectId(),
      usuarioNome: "Conferente anterior",
      usuarioTipo: "logistica",
    },
    versaoOperacional: 1,
  },
} = {}) => ({
  status,
  conferenciaObrigatoria: true,
  fechamentoLogisticoObrigatorio: true,
  versaoOperacional: 1,
  valorTotal: quantidade * 10,
  itens: [{
    produtoId: new mongoose.Types.ObjectId(),
    nomeProduto: "Shampoo",
    quantidade,
    quantidadeSeparada,
    situacaoSeparacao: quantidadeSeparada === quantidade ? "completo" : "parcial",
    valorUnitario: 10,
    subtotal: quantidade * 10,
  }],
  conferencia,
  ocorrencias: [],
  historicoStatus: [],
});

const adminEditor = () => ({
  _id: new mongoose.Types.ObjectId(),
  tipo: "admin",
  nomeResponsavel: "Ana Admin",
});

const editarQuantidadeComoAdmin = (pedido, quantidade, valorUnitario = 10) => (
  applyAdminOrderEdit({
    pedido,
    itensPedido: [{
      produtoId: pedido.itens[0].produtoId,
      nomeProduto: pedido.itens[0].nomeProduto,
      quantidade,
      valorUnitario,
      subtotal: quantidade * valorUnitario,
    }],
    valorTotal: quantidade * valorUnitario,
    observacao: "Pedido negociado com o cliente",
    usuario: adminEditor(),
    now: new Date("2026-08-13T13:00:00.000Z"),
  })
);

test("edição Admin 10/8 para 8 preserva separação, recalcula total e exige nova conferência", () => {
  const pedido = criarPedidoParaEdicaoAdmin();
  const result = editarQuantidadeComoAdmin(pedido, 8);

  assert.equal(result.separationReopened, false);
  assert.equal(pedido.status, "separado");
  assert.equal(pedido.itens[0].quantidade, 8);
  assert.equal(pedido.itens[0].quantidadeSeparada, 8);
  assert.equal(pedido.itens[0].situacaoSeparacao, "completo");
  assert.equal(pedido.valorTotal, 80);
  assert.equal(pedido.conferencia.status, "pendente");
  assert.equal(pedido.versaoOperacional, 2);
  assert.equal(pedido.historicoConferencias.length, 1);
  assert.equal(pedido.historicoAlteracoes[0].totalAnterior, 100);
  assert.equal(pedido.historicoAlteracoes[0].totalNovo, 80);
  assert.equal(buildSeparationPdfData(pedido).itens[0].quantidade, 8);
  const clientView = sanitizeClientOrder(pedido);
  assert.equal(clientView.itens[0].quantidade, 8);
  assert.equal(clientView.itens[0].subtotal, 80);
  assert.equal(clientView.valorTotal, 80);
});

test("edição Admin 10/8 para 6 mantém as 8 físicas e reabre separação inconsistente", () => {
  const pedido = criarPedidoParaEdicaoAdmin();
  const result = editarQuantidadeComoAdmin(pedido, 6);
  const separation = getItemSeparation(pedido.itens[0]);

  assert.equal(result.separationReopened, true);
  assert.equal(pedido.status, "separando");
  assert.equal(pedido.itens[0].quantidadeSeparada, 8);
  assert.equal(separation.situacaoSeparacao, "excedente");
  assert.equal(separation.quantidadeExcedenteSeparacao, 2);
  assert.equal(pedido.conferencia, undefined);
});

test("edição Admin 10/8 para 12 preserva trabalho e deixa quatro unidades pendentes", () => {
  const pedido = criarPedidoParaEdicaoAdmin();
  editarQuantidadeComoAdmin(pedido, 12);
  const separation = getItemSeparation(pedido.itens[0]);

  assert.equal(pedido.status, "separando");
  assert.equal(separation.quantidadeSeparada, 8);
  assert.equal(separation.quantidadeFaltanteSeparacao, 4);
  assert.equal(separation.situacaoSeparacao, "parcial");
});

test("barreira de separação acompanha a quantidade alterada pelo Admin", () => {
  const concluir = (pedido, separacaoItens) => applyLogisticsOrderUpdate({
    pedido,
    data: { status: "separado" },
    separacaoItens,
    usuario: conferenciaUsuario(),
  });
  const criarEmSeparacao = () => criarPedidoParaEdicaoAdmin({
    status: "separando",
    conferencia: undefined,
  });

  const reduzidoParaOito = criarEmSeparacao();
  editarQuantidadeComoAdmin(reduzidoParaOito, 8);
  const exato = concluir(reduzidoParaOito);
  assert.equal(exato.valid, true);
  assert.equal(reduzidoParaOito.status, "separado");

  const aumentadoParaDoze = criarEmSeparacao();
  editarQuantidadeComoAdmin(aumentadoParaDoze, 12);
  const aindaParcial = concluir(aumentadoParaDoze);
  assert.equal(aindaParcial.valid, false);
  assert.equal(aindaParcial.blockers[0].tipo, "quantidade_pendente");
  assert.match(aindaParcial.blockers[0].message, /pedido atual 12, separado 8/);

  const reduzidoParaSeis = criarEmSeparacao();
  editarQuantidadeComoAdmin(reduzidoParaSeis, 6);
  assert.equal(getItemSeparation(reduzidoParaSeis.itens[0]).situacaoSeparacao, "excedente");
  const excedente = concluir(reduzidoParaSeis);
  assert.equal(excedente.valid, false);
  assert.equal(excedente.blockers[0].tipo, "quantidade_excedente");
  assert.match(excedente.blockers[0].message, /pedido atual 6, separado 8/);

  const corrigido = concluir(reduzidoParaSeis, [{
    produtoId: String(reduzidoParaSeis.itens[0].produtoId),
    quantidadeSeparada: 6,
  }]);
  assert.equal(corrigido.valid, true);
  assert.equal(reduzidoParaSeis.status, "separado");
});

test("remoção administrativa elimina exigência atual sem apagar auditoria da conferência", () => {
  const pedido = criarPedidoParaEdicaoAdmin({
    quantidade: 8,
    quantidadeSeparada: 8,
  });
  const remainingId = new mongoose.Types.ObjectId();
  pedido.itens.push({
    produtoId: remainingId,
    nomeProduto: "Condicionador",
    quantidade: 5,
    quantidadeSeparada: 5,
    situacaoSeparacao: "completo",
    valorUnitario: 20,
    subtotal: 100,
  });
  pedido.valorTotal = 180;

  const result = applyAdminOrderEdit({
    pedido,
    itensPedido: [{
      produtoId: remainingId,
      nomeProduto: "Condicionador",
      quantidade: 5,
      valorUnitario: 20,
      subtotal: 100,
    }],
    valorTotal: 100,
    observacao: "Shampoo removido",
    usuario: adminEditor(),
  });

  assert.equal(result.separationReopened, false);
  assert.equal(pedido.itens.length, 1);
  assert.equal(String(pedido.itens[0].produtoId), String(remainingId));
  assert.equal(pedido.conferencia.status, "pendente");
  assert.ok(pedido.historicoAlteracoes[0].itens.some((item) => item.tipo === "removido"));
  assert.equal(pedido.historicoConferencias[0].conferencia.iniciadoPor.usuarioNome, "Conferente anterior");
});

test("histórico administrativo aparece na timeline com valores e autoria", () => {
  const pedido = criarPedidoParaEdicaoAdmin();
  editarQuantidadeComoAdmin(pedido, 8);
  pedido.createdAt = new Date("2026-08-13T11:00:00.000Z");
  const timeline = buildOrderAuditTimeline(pedido);
  const event = timeline.find((entry) => entry.tipo === "pedido_alterado_admin");
  assert.equal(event.responsavelNome, "Ana Admin");
  assert.match(event.detalhes, /100\.00.*80\.00/);
  assert.ok(timeline.some((entry) => entry.tipo === "conferencia_invalidada"));
});

test("backend rejeita conclusão direta da API quando separado difere do pedido atual", async () => {
  const originalFindById = Pedido.findById;
  const pedido = criarPedidoParaConferencia({ segundaQuantidadeSeparada: 8 });
  pedido.__v = 0;
  pedido.conferencia = {
    status: "em_andamento",
    versaoOperacional: 1,
  };
  pedido.versaoOperacional = 1;
  pedido.save = async () => assert.fail("conferência divergente não deve ser salva");
  Pedido.findById = () => ({ select: async () => pedido });
  const response = createResponse();
  try {
    await atualizarPedidoLogistica({
      params: { id: objectId },
      body: {
        versaoPedido: 0,
        conferencia: {
          acao: "concluir",
          itens: pedido.itens.map((item) => ({
            produtoId: String(item.produtoId),
            quantidadeConferida: item.quantidadeSeparada,
          })),
        },
      },
      usuario: conferenciaUsuario(),
      operadorLogistica: operadorLogistica(),
    }, response);
  } finally {
    Pedido.findById = originalFindById;
  }
  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /pedido atual/);
  assert.equal(response.body.itens[0].tipo, "quantidade_separada_divergente");
  assert.equal(pedido.conferencia.status, "em_andamento");
});

test("backend rejeita avanço direto da API com separação parcial", async () => {
  const originalFindById = Pedido.findById;
  const produtoId = new mongoose.Types.ObjectId();
  const pedido = {
    __v: 0,
    status: "separando",
    conferenciaObrigatoria: true,
    versaoOperacional: 1,
    itens: [{
      produtoId,
      nomeProduto: "Shampoo API",
      quantidade: 10,
      quantidadeSeparada: 8,
    }],
    save: async () => assert.fail("separação parcial não deve ser salva como concluída"),
  };
  Pedido.findById = () => ({ select: async () => pedido });
  const response = createResponse();
  try {
    await atualizarPedidoLogistica({
      params: { id: objectId },
      body: {
        versaoPedido: 0,
        status: "separado",
        separacaoItens: [{
          produtoId: String(produtoId),
          quantidadeSeparada: 8,
        }],
      },
      usuario: conferenciaUsuario(),
      operadorLogistica: operadorLogistica(),
    }, response);
  } finally {
    Pedido.findById = originalFindById;
  }

  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /Não é possível concluir a separação/);
  assert.equal(response.body.itens[0].tipo, "quantidade_pendente");
  assert.equal(pedido.status, "separando");
});

test("backend exige versão e rejeita atualização logística obsoleta", async () => {
  const originalFindById = Pedido.findById;
  const pedido = {
    __v: 3,
    status: "separando",
    itens: [],
    save: async () => assert.fail("payload obsoleto não deve ser salvo"),
  };
  Pedido.findById = () => ({ select: async () => pedido });
  try {
    const missing = createResponse();
    await atualizarPedidoLogistica({
      params: { id: objectId },
      body: { status: "separando" },
      usuario: conferenciaUsuario(),
    }, missing);
    assert.equal(missing.statusCode, 428);

    const stale = createResponse();
    await atualizarPedidoLogistica({
      params: { id: objectId },
      body: { versaoPedido: 2, status: "separando" },
      usuario: conferenciaUsuario(),
    }, stale);
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.body.versaoAtual, 3);
  } finally {
    Pedido.findById = originalFindById;
  }
});

test("backend rejeita edição comercial de pedido faturado e versão Admin obsoleta", async () => {
  const originalFindById = Pedido.findById;
  const produtoId = new mongoose.Types.ObjectId();
  const response = createResponse();
  Pedido.findById = () => ({
    select: async () => ({ __v: 4, status: "faturado" }),
  });
  try {
    await atualizarPedidoAdmin({
      params: { id: objectId },
      body: {
        versaoPedido: 4,
        itens: [{ produtoId: String(produtoId), quantidade: 1 }],
      },
      usuario: adminEditor(),
    }, response);
    assert.equal(response.statusCode, 409);
    assert.match(response.body.message, /faturados não podem/);

    Pedido.findById = () => ({
      select: async () => ({ __v: 5, status: "separando" }),
    });
    const stale = createResponse();
    await atualizarPedidoAdmin({
      params: { id: objectId },
      body: {
        versaoPedido: 4,
        itens: [{ produtoId: String(produtoId), quantidade: 1 }],
      },
      usuario: adminEditor(),
    }, stale);
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.body.versaoAtual, 5);
  } finally {
    Pedido.findById = originalFindById;
  }
});

test("schema e política administrativa permitem edição somente antes do faturamento", async () => {
  assert.equal(pedidoPodeSerEditadoPeloAdmin("aguardando_aprovacao"), true);
  assert.equal(pedidoPodeSerEditadoPeloAdmin("separando"), true);
  assert.equal(pedidoPodeSerEditadoPeloAdmin("separado"), true);
  assert.equal(pedidoPodeSerEditadoPeloAdmin("faturado"), false);
  assert.equal(Pedido.schema.options.optimisticConcurrency, true);
  assert.ok(Pedido.schema.path("historicoAlteracoes"));
  assert.ok(Pedido.schema.path("historicoConferencias"));
});

test("pedido editado com conferência arquivada continua válido no schema", async () => {
  const base = criarPedidoParaEdicaoAdmin();
  const pedido = new Pedido({
    numeroPedido: "PED-EDICAO-SCHEMA",
    clienteId: new mongoose.Types.ObjectId(),
    tabelaPrecoId: new mongoose.Types.ObjectId(),
    dia: 13,
    mes: 8,
    ano: 2026,
    ...base,
  });
  editarQuantidadeComoAdmin(pedido, 8);
  await assert.doesNotReject(() => pedido.validate());
  assert.equal(pedido.historicoAlteracoes.length, 1);
  assert.equal(pedido.historicoConferencias.length, 1);
});

test("fechamento 1. pedido historico recebe isencao por padrao no schema", () => {
  const pedido = new Pedido();
  assert.equal(pedido.fechamentoLogisticoObrigatorio, false);
  assert.equal(pedido.fechamentoLogistico, undefined);
});

test("fechamento 2. payload aceita peso com virgula e normaliza para numero", () => {
  const parsed = validateLogisticsOrderPayload({
    fechamentoLogistico: {
      quantidadeVolumes: "4",
      pesoTotalKg: "38,5",
      observacaoVolumes: "Quatro caixas lacradas",
    },
  });
  assert.equal(parsed.valid, true);
  assert.deepEqual(parsed.fechamentoLogistico, {
    quantidadeVolumes: 4,
    pesoTotalKg: 38.5,
    observacaoVolumes: "Quatro caixas lacradas",
  });
});

test("fechamento 3. quantidade de volumes zero e rejeitada", () => {
  const parsed = validateLogisticsClosing({
    quantidadeVolumes: 0,
    pesoTotalKg: 10,
    observacaoVolumes: "Caixa",
  });
  assert.match(parsed.error, /inteira e maior que zero/);
});

test("fechamento 4. quantidade fracionaria de volumes e rejeitada", () => {
  const parsed = validateLogisticsClosing({
    quantidadeVolumes: 1.5,
    pesoTotalKg: 10,
    observacaoVolumes: "Caixa",
  });
  assert.match(parsed.error, /inteira e maior que zero/);
});

test("fechamento 5. peso zero e rejeitado", () => {
  const parsed = validateLogisticsClosing({
    quantidadeVolumes: 1,
    pesoTotalKg: 0,
    observacaoVolumes: "Caixa",
  });
  assert.match(parsed.error, /peso total válido/);
});

test("fechamento 6. peso com separadores ambiguos e rejeitado", () => {
  const parsed = validateLogisticsClosing({
    quantidadeVolumes: 1,
    pesoTotalKg: "1.234,50",
    observacaoVolumes: "Caixa",
  });
  assert.match(parsed.error, /peso total válido/);
});

test("fechamento 7. descricao vazia e rejeitada", () => {
  const parsed = validateLogisticsClosing({
    quantidadeVolumes: 1,
    pesoTotalKg: 10,
    observacaoVolumes: "   ",
  });
  assert.match(parsed.error, /Descreva os volumes/);
});

test("fechamento 8. campo desconhecido e rejeitado", () => {
  const parsed = validateLogisticsClosing({
    quantidadeVolumes: 1,
    pesoTotalKg: 10,
    observacaoVolumes: "Caixa",
    faturado: true,
  });
  assert.match(parsed.error, /não permitidos/);
});

test("fechamento 9. deve ser salvo em operacao isolada", () => {
  const pedido = criarPedidoParaFechamento();
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: { observacaoLogistica: "Misturada" },
    fechamentoLogistico: {
      quantidadeVolumes: 1,
      pesoTotalKg: 10,
      observacaoVolumes: "Caixa",
    },
    usuario: conferenciaUsuario(),
    operador: operadorLogistica(),
  });
  assert.equal(result.valid, false);
  assert.match(result.message, /operação própria/);
});

test("fechamento 10. pedido historico isento nao aceita registro estruturado", () => {
  const { result } = registrarFechamento({
    pedido: criarPedidoParaFechamento({ fechamentoLogisticoObrigatorio: false }),
  });
  assert.equal(result.valid, false);
  assert.match(result.message, /histórico não exige/);
});

test("fechamento 11. nao pode ser preenchido antes do status separado", () => {
  const { result } = registrarFechamento({
    pedido: criarPedidoParaFechamento({ status: "separando" }),
  });
  assert.equal(result.valid, false);
  assert.match(result.message, /após a separação e antes do faturamento/);
});

test("fechamento 12. conferencia obrigatoria precisa estar concluida", () => {
  const { result } = registrarFechamento({
    pedido: criarPedidoParaFechamento({ conferencia: { status: "em_andamento" } }),
  });
  assert.equal(result.valid, false);
  assert.match(result.message, /Conclua a conferência/);
});

test("fechamento 13. Admin nao assume responsabilidade da Logistica", () => {
  const { result } = registrarFechamento({
    usuario: { _id: objectId, tipo: "admin", nomeResponsavel: "Admin" },
  });
  assert.equal(result.valid, false);
  assert.match(result.message, /operador da Logística por PIN/);
});

test("fechamento 14. conta Logistica sem operador identificado e rejeitada", () => {
  const { result } = registrarFechamento({ operador: null });
  assert.equal(result.valid, false);
  assert.match(result.message, /operador da Logística por PIN/);
});

test("fechamento 15. registro valido persiste dados autoria horario e ocorrencia", () => {
  const now = new Date("2026-08-12T15:20:00.000Z");
  const { pedido, usuario, operador, result } = registrarFechamento({ now });
  assert.equal(result.valid, true);
  assert.equal(result.fechamentoLogisticoAlterado, true);
  assert.equal(pedido.fechamentoLogistico.quantidadeVolumes, 3);
  assert.equal(pedido.fechamentoLogistico.pesoTotalKg, 38.5);
  assert.equal(pedido.fechamentoLogistico.preenchidoEm, now);
  assert.equal(pedido.fechamentoLogistico.preenchidoPor.usuarioId, usuario._id);
  assert.equal(pedido.fechamentoLogistico.preenchidoPor.operadorId, operador._id);
  assert.match(pedido.ocorrencias[0].conteudo, /Fechamento logístico concluído/);
});

test("fechamento 16. alteracao substitui resumo atual e preserva rastreio anterior", () => {
  const first = registrarFechamento();
  const second = registrarFechamento({
    pedido: first.pedido,
    now: new Date("2026-08-12T16:00:00.000Z"),
    fechamentoLogistico: {
      quantidadeVolumes: 5,
      pesoTotalKg: 42,
      observacaoVolumes: "Cinco caixas após reembalagem.",
    },
  });
  assert.equal(second.result.valid, true);
  assert.equal(second.pedido.fechamentoLogistico.quantidadeVolumes, 5);
  assert.equal(second.pedido.ocorrencias.length, 2);
  assert.match(second.pedido.ocorrencias[0].conteudo, /concluído/);
  assert.match(second.pedido.ocorrencias[1].conteudo, /atualizado/);
});

test("fechamento 17. Admin nao fatura novo pedido sem fechamento", () => {
  const pedido = criarPedidoParaFechamento();
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: {
      status: "faturado",
      numeroNotaFiscal: "NF-1",
      dataFaturamento: new Date("2026-08-12T17:00:00.000Z"),
    },
    usuario: { _id: objectId, tipo: "admin", nomeResponsavel: "Admin" },
  });
  assert.equal(result.valid, false);
  assert.match(result.message, /Conclua o fechamento logístico/);
  assert.equal(pedido.status, "separado");
});

test("fechamento 18. Logistica nao fatura mesmo depois do fechamento", () => {
  const registered = registrarFechamento();
  const result = applyLogisticsOrderUpdate({
    pedido: registered.pedido,
    data: {
      status: "faturado",
      numeroNotaFiscal: "NF-1",
      dataFaturamento: new Date("2026-08-12T17:00:00.000Z"),
    },
    usuario: registered.usuario,
    operador: registered.operador,
  });
  assert.equal(result.valid, false);
  assert.match(result.message, /Nota Fiscal.*Admin|Transição/);
});

test("fechamento 19. faturamento pelo Admin exige numero da Nota Fiscal", () => {
  const { pedido } = registrarFechamento();
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: {
      status: "faturado",
      dataFaturamento: new Date("2026-08-12T17:00:00.000Z"),
    },
    usuario: { _id: objectId, tipo: "admin", nomeResponsavel: "Admin" },
  });
  assert.equal(result.valid, false);
  assert.match(result.message, /número da Nota Fiscal/);
});

test("fechamento 20. faturamento pelo Admin exige data de faturamento", () => {
  const { pedido } = registrarFechamento();
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: { status: "faturado", numeroNotaFiscal: "NF-20" },
    usuario: { _id: objectId, tipo: "admin", nomeResponsavel: "Admin" },
  });
  assert.equal(result.valid, false);
  assert.match(result.message, /data de faturamento/);
});

test("fechamento 21. Admin fatura com fechamento NF e data completos", () => {
  const { pedido } = registrarFechamento();
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: {
      status: "faturado",
      numeroNotaFiscal: "NF-21",
      dataFaturamento: new Date("2026-08-12T17:00:00.000Z"),
    },
    usuario: { _id: objectId, tipo: "admin", nomeResponsavel: "Admin" },
  });
  assert.equal(result.valid, true);
  assert.equal(pedido.status, "faturado");
  assert.equal(pedido.numeroNotaFiscal, "NF-21");
  assert.equal(pedido.fechamentoLogistico.quantidadeVolumes, 3);
});

test("fechamento 22. dados de envio continuam bloqueados antes de faturado", () => {
  const { pedido } = registrarFechamento();
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: { transportadora: "Antecipada" },
    usuario: { _id: objectId, tipo: "admin", nomeResponsavel: "Admin" },
  });
  assert.equal(result.valid, false);
  assert.match(result.message, /Dados de envio.*faturado/);
});

test("fechamento 23. nao pode ser alterado depois de faturado", () => {
  const registered = registrarFechamento();
  registered.pedido.status = "faturado";
  const second = registrarFechamento({ pedido: registered.pedido });
  assert.equal(second.result.valid, false);
  assert.match(second.result.message, /antes do faturamento/);
});

test("fechamento 24. DTO do cliente remove obrigatoriedade dados e operador", () => {
  const { pedido } = registrarFechamento();
  const client = sanitizeClientOrder(pedido);
  assert.equal(Object.hasOwn(client, "fechamentoLogisticoObrigatorio"), false);
  assert.equal(Object.hasOwn(client, "fechamentoLogistico"), false);
  assert.equal(JSON.stringify(client).includes("Pedro Operador"), false);
});

test("fechamento 25. timeline estrutura o registro atual sem duplicar sua ocorrencia", () => {
  const first = registrarFechamento();
  const second = registrarFechamento({
    pedido: first.pedido,
    now: new Date("2026-08-12T16:00:00.000Z"),
    fechamentoLogistico: {
      quantidadeVolumes: 4,
      pesoTotalKg: 40.25,
      observacaoVolumes: "Quatro caixas revisadas.",
    },
  });
  const timeline = buildOrderAuditTimeline(second.pedido);
  assert.equal(timeline.filter((entry) => entry.tipo === "fechamento_logistico").length, 1);
  assert.equal(timeline.filter((entry) => entry.tipo === "ocorrencia").length, 1);
  const current = timeline.find((entry) => entry.tipo === "fechamento_logistico");
  assert.equal(current.dados.quantidadeVolumes, 4);
  assert.equal(current.operadorNome, second.operador.nome);
});

test("fechamento 26. relatorio administrativo inclui o resumo completo", () => {
  const { pedido } = registrarFechamento();
  pedido.numeroPedido = "PED-FECHAMENTO-PDF";
  const report = buildOrderAuditPdfData(pedido);
  assert.equal(report.fechamentoLogisticoObrigatorio, true);
  assert.equal(report.fechamentoLogistico.quantidadeVolumes, 3);
  assert.equal(report.fechamentoLogistico.pesoTotalKg, "38,5");
  assert.match(report.fechamentoLogistico.observacaoVolumes, /caixas grandes/);
  assert.equal(report.fechamentoLogistico.preenchidoPor, "Pedro Operador");
});

test("fechamento 27. dados fiscais obrigatorios nao podem ser apagados depois do faturamento", () => {
  const pedido = {
    status: "faturado",
    numeroNotaFiscal: "NF-PERSISTIDA",
    dataFaturamento: new Date("2026-08-12T17:00:00.000Z"),
  };
  const result = applyLogisticsOrderUpdate({
    pedido,
    data: { numeroNotaFiscal: "" },
    usuario: { _id: objectId, tipo: "admin", nomeResponsavel: "Admin" },
  });
  assert.equal(result.valid, false);
  assert.match(result.message, /não podem ser removidos/);
  assert.equal(pedido.numeroNotaFiscal, "NF-PERSISTIDA");
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
  assert.equal(detail.itens[0].quantidadeFaltante, 1);
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
    quantidadeFaltante: 1,
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
