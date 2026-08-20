import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { PassThrough } from "node:stream";
import pedidoMetricasRouter from "../src/routes/pedidoMetricasRoutes.js";
import { adminLimiter } from "../src/middlewares/rateLimitMiddleware.js";
import {
  calcularMetricasGerais,
  calcularMetricasOperadores,
  calcularPedidosAtencao,
  extrairMarcosPedido,
  pedidoTemParticipacaoOperador,
} from "../src/services/pedidoMetricasService.js";
import {
  duracaoValida,
  media,
  mediana,
  obterLimiteEtapa,
  parsePedidoMetricasQuery,
  percentil,
  resumirDuracoes,
} from "../src/utils/pedidoMetricas.js";
import {
  buildPedidoMetricasPdfData,
  gerarPdfMetricasPedidos,
} from "../src/services/pdfMetricasPedidosService.js";

const MINUTE = 60 * 1000;
const pedroId = new mongoose.Types.ObjectId();
const wesleyId = new mongoose.Types.ObjectId();
const produtoA = new mongoose.Types.ObjectId();
const produtoB = new mongoose.Types.ObjectId();

const operatorSnapshot = (id, nome) => ({
  usuarioId: new mongoose.Types.ObjectId(),
  usuarioNome: "Conta Logística",
  usuarioTipo: "logistica",
  operadorId: id,
  operadorNome: nome,
});

const statusEvent = ({ from, to, at, operatorId, operatorName }) => ({
  statusAnterior: from,
  novoStatus: to,
  alteradoEm: new Date(at),
  usuarioId: new mongoose.Types.ObjectId(),
  usuarioNome: "Conta Logística",
  usuarioTipo: to === "aprovado" ? "admin" : "logistica",
  ...(operatorId ? { operadorId: operatorId, operadorNome: operatorName } : {}),
});

const createControlledOrder = ({
  id = new mongoose.Types.ObjectId(),
  separationStartOperator = pedroId,
  separationEndOperator = pedroId,
  conferenceStartOperator = wesleyId,
  conferenceEndOperator = wesleyId,
  conferenceEnd = "2026-08-12T10:30:00.000Z",
  status = "separado",
} = {}) => ({
  _id: id,
  numeroPedido: `PED-${String(id).slice(-5)}`,
  nomeFantasiaCliente: "Pet Center Controlado",
  status,
  createdAt: new Date("2026-08-12T08:00:00.000Z"),
  aprovacao: {
    aprovadoEm: new Date("2026-08-12T08:30:00.000Z"),
    usuarioId: new mongoose.Types.ObjectId(),
    usuarioNome: "Admin",
    usuarioTipo: "admin",
  },
  historicoStatus: [
    statusEvent({ from: "aguardando_aprovacao", to: "aprovado", at: "2026-08-12T08:30:00.000Z" }),
    statusEvent({
      from: "aprovado",
      to: "separando",
      at: "2026-08-12T09:00:00.000Z",
      operatorId: separationStartOperator,
      operatorName: separationStartOperator.equals(pedroId) ? "Pedro" : "Wesley",
    }),
    statusEvent({
      from: "separando",
      to: "separado",
      at: "2026-08-12T09:45:00.000Z",
      operatorId: separationEndOperator,
      operatorName: separationEndOperator.equals(pedroId) ? "Pedro" : "Wesley",
    }),
  ],
  conferenciaObrigatoria: true,
  conferencia: {
    status: "concluida_com_divergencia",
    iniciadaEm: new Date("2026-08-12T10:15:00.000Z"),
    iniciadoPor: operatorSnapshot(
      conferenceStartOperator,
      conferenceStartOperator.equals(pedroId) ? "Pedro" : "Wesley"
    ),
    concluidaEm: new Date(conferenceEnd),
    concluidoPor: operatorSnapshot(
      conferenceEndOperator,
      conferenceEndOperator.equals(pedroId) ? "Pedro" : "Wesley"
    ),
    totalItens: 2,
    totalDivergencias: 1,
    itens: [
      {
        produtoId: produtoA,
        nomeProduto: "Shampoo A",
        quantidadeSolicitada: 10,
        quantidadeSeparada: 10,
        quantidadeConferida: 9,
        diferenca: -1,
      },
      {
        produtoId: produtoB,
        nomeProduto: "Condicionador B",
        quantidadeSolicitada: 5,
        quantidadeSeparada: 3,
        quantidadeConferida: 3,
        diferenca: 0,
      },
    ],
  },
  itens: [
    {
      produtoId: produtoA,
      nomeProduto: "Shampoo A",
      quantidade: 10,
      quantidadeSeparada: 10,
      quantidadeConferida: 9,
    },
    {
      produtoId: produtoB,
      nomeProduto: "Condicionador B",
      quantidade: 5,
      quantidadeSeparada: 3,
      quantidadeConferida: 3,
    },
  ],
});

test("estatística trata lista vazia, um valor, pares, ímpares, outlier e inválidos", () => {
  assert.equal(media([]), null);
  assert.equal(mediana([]), null);
  assert.equal(percentil([], 90), null);
  assert.equal(media([10]), 10);
  assert.equal(mediana([10]), 10);
  assert.equal(mediana([10, 20]), 15);
  assert.equal(mediana([10, 20, 30]), 20);
  assert.equal(media([10, 10, 10, 100]), 32.5);
  assert.equal(mediana([10, 10, 10, 100]), 10);
  assert.equal(percentil([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 90), 90);
  assert.deepEqual(resumirDuracoes([10, -1, Number.NaN, 30]), {
    mediaMs: 20,
    medianaMs: 20,
    p90Ms: 30,
    amostra: 2,
  });
});

test("duração valida exige dois marcos coerentes", () => {
  assert.equal(duracaoValida("2026-08-12T08:00:00Z", "2026-08-12T08:30:00Z"), 30 * MINUTE);
  assert.equal(duracaoValida("2026-08-12T09:00:00Z", "2026-08-12T08:30:00Z"), null);
  assert.equal(duracaoValida(null, "2026-08-12T08:30:00Z"), null);
});

test("alerta usa limite fixo com amostra pequena e P90 com amostra suficiente", () => {
  assert.deepEqual(obterLimiteEtapa({ amostra: 4, p90Ms: 90 * MINUTE }, "separacao"), {
    limiteMs: 4 * 60 * MINUTE,
    origem: "limite_fixo",
    amostra: 4,
  });
  assert.deepEqual(obterLimiteEtapa({ amostra: 5, p90Ms: 90 * MINUTE }, "separacao"), {
    limiteMs: 90 * MINUTE,
    origem: "p90",
    amostra: 5,
  });
});

test("filtro de período respeita São Paulo, presets, intervalo máximo e operador", () => {
  const now = new Date("2026-08-12T15:00:00.000Z");
  const today = parsePedidoMetricasQuery({ periodo: "hoje" }, now);
  assert.equal(today.valid, true);
  assert.equal(today.data.inicio.toISOString(), "2026-08-12T03:00:00.000Z");
  assert.equal(today.data.fim.toISOString(), "2026-08-13T02:59:59.999Z");

  const custom = parsePedidoMetricasQuery({
    periodo: "personalizado",
    dataInicio: "2026-08-01",
    dataFim: "2026-08-12",
    operadorId: String(pedroId),
  }, now);
  assert.equal(custom.valid, true);
  assert.equal(custom.data.operadorId, String(pedroId));

  assert.equal(parsePedidoMetricasQuery({
    periodo: "personalizado",
    dataInicio: "2025-01-01",
    dataFim: "2026-08-12",
  }, now).valid, false);
  assert.equal(parsePedidoMetricasQuery({ periodo: "30dias", operadorId: "inválido" }, now).valid, false);
});

test("cenário controlado calcula exatamente os oito tempos pedidos", () => {
  const marcos = extrairMarcosPedido(createControlledOrder());
  assert.equal(marcos.approvalMs, 30 * MINUTE);
  assert.equal(marcos.separationWaitMs, 30 * MINUTE);
  assert.equal(marcos.separationMs, 45 * MINUTE);
  assert.equal(marcos.conferenceWaitMs, 30 * MINUTE);
  assert.equal(marcos.conferenceMs, 15 * MINUTE);
  assert.equal(marcos.operationalMs, 60 * MINUTE);
  assert.equal(marcos.totalMs, 150 * MINUTE);
  assert.equal(marcos.stoppedMs, 90 * MINUTE);
});

test("ausência de etapas e duração negativa não contaminam médias", () => {
  const complete = createControlledOrder();
  const missing = {
    _id: new mongoose.Types.ObjectId(),
    numeroPedido: "PED-LEGADO",
    createdAt: new Date("2026-08-12T08:00:00Z"),
    status: "novo",
    itens: [],
  };
  const negative = createControlledOrder({ conferenceEnd: "2026-08-12T10:00:00.000Z" });
  const result = calcularMetricasGerais([complete, missing, negative]);
  assert.equal(result.tempos.aprovacao.amostra, 2);
  assert.equal(result.tempos.separacao.amostra, 2);
  assert.equal(result.tempos.conferencia.amostra, 1);
  assert.equal(result.tempos.total.amostra, 2);
  assert.ok(result.diagnostico.paresDeTimestampInvalidos > 0);
});

test("qualidade agrega faltas, divergências e produtos sem confundir venda", () => {
  const result = calcularMetricasGerais([createControlledOrder()]);
  assert.equal(result.qualidade.pedidosComDivergencia, 1);
  assert.equal(result.qualidade.itensComDivergencia, 1);
  assert.equal(result.qualidade.pedidosComFalta, 1);
  assert.equal(result.qualidade.itensComFalta, 1);
  assert.equal(result.qualidade.unidadesFaltantes, 2);
  const shampoo = result.produtosOcorrencias.find((product) => product.produto === "Shampoo A");
  const conditioner = result.produtosOcorrencias.find((product) => product.produto === "Condicionador B");
  assert.equal(shampoo.divergenciasConferencia, 1);
  assert.equal(conditioner.faltasSeparacao, 1);
  assert.equal(conditioner.pedidosComProduto, 1);
  assert.equal(conditioner.taxaPedidosAfetados, 100);
});

test("pedidos demorados são ordenados por tempo total", () => {
  const first = createControlledOrder();
  const second = createControlledOrder({
    id: new mongoose.Types.ObjectId(),
    conferenceEnd: "2026-08-12T12:30:00.000Z",
  });
  const result = calcularMetricasGerais([first, second]);
  assert.equal(String(result.pedidosMaisDemorados[0].pedidoId), String(second._id));
});

test("Pedro separa e Wesley confere sem misturar durações", () => {
  const result = calcularMetricasOperadores({
    pedidos: [createControlledOrder()],
    operadores: [
      { _id: pedroId, nome: "Pedro", ativo: true },
      { _id: wesleyId, nome: "Wesley", ativo: false },
    ],
    inicio: new Date("2026-08-12T00:00:00Z"),
    fim: new Date("2026-08-12T23:59:59Z"),
  });
  const pedro = result.operadores.find((operator) => operator.operador === "Pedro");
  const wesley = result.operadores.find((operator) => operator.operador === "Wesley");
  assert.equal(pedro.tempoSeparacao.mediaMs, 45 * MINUTE);
  assert.equal(pedro.tempoConferencia.amostra, 0);
  assert.equal(wesley.tempoSeparacao.amostra, 0);
  assert.equal(wesley.tempoConferencia.mediaMs, 15 * MINUTE);
  assert.equal(wesley.divergenciasIdentificadas, 1);
  assert.equal(wesley.ativo, false);
});

test("dois operadores na mesma separação preservam eventos mas não recebem duração falsa", () => {
  const result = calcularMetricasOperadores({
    pedidos: [createControlledOrder({ separationEndOperator: wesleyId })],
    operadores: [
      { _id: pedroId, nome: "Pedro", ativo: true },
      { _id: wesleyId, nome: "Wesley", ativo: true },
    ],
    inicio: new Date("2026-08-12T00:00:00Z"),
    fim: new Date("2026-08-12T23:59:59Z"),
  });
  const pedro = result.operadores.find((operator) => operator.operador === "Pedro");
  const wesley = result.operadores.find((operator) => operator.operador === "Wesley");
  assert.equal(pedro.separacoesIniciadas, 1);
  assert.equal(wesley.separacoesConcluidas, 1);
  assert.equal(pedro.tempoSeparacao.amostra, 0);
  assert.equal(wesley.tempoSeparacao.amostra, 0);
  assert.equal(result.atribuicaoDuracao.separacoesNaoAtribuidas, 1);
});

test("filtro por operador usa snapshots inclusive de operador desativado", () => {
  const order = createControlledOrder();
  assert.equal(pedidoTemParticipacaoOperador(order, pedroId), true);
  assert.equal(pedidoTemParticipacaoOperador(order, new mongoose.Types.ObjectId()), false);
  const filtered = calcularMetricasOperadores({
    pedidos: [order],
    operadores: [{ _id: wesleyId, nome: "Wesley", ativo: false }],
    inicio: new Date("2026-08-12T00:00:00Z"),
    fim: new Date("2026-08-12T23:59:59Z"),
    operadorId: String(wesleyId),
  });
  assert.deepEqual(filtered.operadores.map((operator) => operator.operador), ["Wesley"]);
});

test("métricas preservam a conferência arquivada após alteração administrativa", () => {
  const order = createControlledOrder();
  order.historicoConferencias = [{
    conferencia: order.conferencia,
    invalidadaEm: new Date("2026-08-12T11:00:00.000Z"),
    invalidadaPor: operatorSnapshot(wesleyId, "Wesley"),
    motivo: "Pedido alterado pelo Admin",
  }];
  order.conferencia = { status: "pendente" };

  assert.equal(pedidoTemParticipacaoOperador(order, wesleyId), true);
  const result = calcularMetricasOperadores({
    pedidos: [order],
    operadores: [{ _id: wesleyId, nome: "Wesley", ativo: true }],
    inicio: new Date("2026-08-12T00:00:00Z"),
    fim: new Date("2026-08-12T23:59:59Z"),
    operadorId: String(wesleyId),
  });
  const wesley = result.operadores[0];
  assert.equal(wesley.conferenciasIniciadas, 1);
  assert.equal(wesley.conferenciasConcluidas, 1);
  assert.equal(wesley.tempoConferencia.mediaMs, 15 * MINUTE);
  assert.equal(wesley.itensProcessados, 2);
  assert.equal(wesley.unidadesProcessadas, 12);
});

test("pedidos ativos diferenciam fila, operação e acima do padrão; entregues não entram", () => {
  const awaiting = {
    _id: new mongoose.Types.ObjectId(),
    numeroPedido: "PED-AGUARDA",
    nomeFantasiaCliente: "Cliente",
    status: "aguardando_aprovacao",
    createdAt: new Date("2026-08-10T08:00:00Z"),
  };
  const separating = createControlledOrder({ status: "separando" });
  separating.conferencia = undefined;
  separating.historicoStatus = separating.historicoStatus.slice(0, 2);
  const delivered = { ...createControlledOrder(), status: "entregue" };
  const emptyStats = calcularMetricasGerais([]).tempos;
  const result = calcularPedidosAtencao({
    pedidos: [awaiting, separating, delivered],
    tempos: emptyStats,
    now: new Date("2026-08-12T12:00:00Z"),
  });
  assert.equal(result.pedidos.some((order) => order.numeroPedido === delivered.numeroPedido), false);
  assert.equal(result.pedidos.find((order) => order.numeroPedido === "PED-AGUARDA").classificacao, "acima_tempo_normal");
  assert.equal(result.pedidos.some((order) => order.classificacao === "em_andamento"), true);
});

test("rota de métricas exige autenticação e perfil Admin no backend", () => {
  assert.deepEqual(
    pedidoMetricasRouter.stack.slice(0, 2).map((layer) => layer.name),
    ["proteger", "somenteAdmin"]
  );
  assert.equal(pedidoMetricasRouter.stack[2].handle, adminLimiter);
  const routes = pedidoMetricasRouter.stack.filter((layer) => layer.route);
  assert.deepEqual(routes.map((layer) => layer.route.path), ["/", "/pdf"]);

  for (const tipo of ["cliente", "logistica"]) {
    const response = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    pedidoMetricasRouter.stack[1].handle(
      { usuario: { tipo } },
      response,
      () => assert.fail(`${tipo} não pode acessar métricas administrativas`)
    );
    assert.equal(response.statusCode, 403);
  }

  let adminAutorizado = false;
  pedidoMetricasRouter.stack[1].handle(
    { usuario: { tipo: "admin" } },
    {},
    () => { adminAutorizado = true; }
  );
  assert.equal(adminAutorizado, true);
});

test("resposta de métricas não expõe valores ou dados internos de cliente", () => {
  const order = {
    ...createControlledOrder(),
    valorTotal: 999,
    emailCliente: "privado@example.com",
    cnpjCliente: "00000000000000",
  };
  const serialized = JSON.stringify(calcularMetricasGerais([order]));
  assert.doesNotMatch(serialized, /valorTotal|emailCliente|cnpjCliente|privado@example/);
});

const createMetricsFixture = (orders = [createControlledOrder()]) => {
  const general = calcularMetricasGerais(orders);
  return {
    filtros: {
      dataInicio: "2026-08-01",
      dataFim: "2026-08-12",
      timezone: "America/Sao_Paulo",
      operador: null,
      criterioPedidos: "Pedidos incluídos por createdAt no período.",
      criterioOperadores: "Eventos incluídos pela data real do evento no período.",
    },
    ...general,
    operadores: [],
    pedidosAtencao: [],
    metadados: { paresDeTimestampInvalidos: 0 },
  };
};

test("dados do PDF respeitam filtros, amostras e também aceitam período vazio", () => {
  const populated = buildPedidoMetricasPdfData(createMetricsFixture());
  assert.equal(populated.periodo, "2026-08-01 a 2026-08-12");
  assert.equal(populated.tempos.find((time) => time.key === "separacao").amostra, 1);
  const empty = buildPedidoMetricasPdfData(createMetricsFixture([]));
  assert.equal(empty.resumo.pedidosNoPeriodo, 0);
  assert.equal(empty.tempos.every((time) => time.amostra === 0), true);
});

test("PDF de métricas gera arquivo legível mesmo sem dados", async () => {
  const response = new PassThrough();
  response.headers = {};
  response.setHeader = (name, value) => { response.headers[name] = value; };
  const chunks = [];
  response.on("data", (chunk) => chunks.push(chunk));
  const complete = new Promise((resolve, reject) => {
    response.on("finish", resolve);
    response.on("error", reject);
  });
  gerarPdfMetricasPedidos(createMetricsFixture([]), response);
  await complete;
  const pdf = Buffer.concat(chunks);
  assert.equal(response.headers["Content-Type"], "application/pdf");
  assert.match(response.headers["Content-Disposition"], /2026-08-01-2026-08-12/);
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  assert.ok(pdf.length > 1500);
});
