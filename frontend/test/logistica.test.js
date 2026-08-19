import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatOrderStatus,
  getOrderProgress,
  ORDER_PROGRESS_STEPS,
} from "../src/utils/orderLogistics.js";
import {
  buildConferencePayload,
  buildLogisticsClosingPayload,
  getOrderFlowStage,
  buildOrderOperationsForm,
  buildOrderOperationsPayload,
  isLogisticsClosingComplete,
} from "../src/utils/orderOperations.js";

const readSource = (relativePath) => (
  readFileSync(new URL(relativePath, import.meta.url), "utf8")
);

test("rotas, guard e login direcionam logistica ao painel proprio", () => {
  const app = readSource("../src/App.jsx");
  const guards = readSource("../src/components/RouteGuards/RouteGuards.jsx");
  const login = readSource("../src/pages/Login/Login.jsx");
  assert.match(app, /path="\/logistica"[\s\S]*?<RoleRoute role="logistica">/);
  assert.match(app, /path="\/logistica\/pedidos"[\s\S]*?<RoleRoute role="logistica">/);
  assert.match(guards, /logistica: "\/logistica"/);
  assert.match(guards, /logistica: "\/logistica\/dashboard"/);
  assert.match(login, /logistica: "\/logistica"/);
});

test("menu de logistica contem apenas Dashboard e Pedidos", () => {
  const navbar = readSource("../src/components/Navbar/Navbar.jsx");
  const block = navbar.match(/const logisticaLinks = \[([\s\S]*?)\];/)?.[1] || "";
  assert.match(block, /\/logistica/);
  assert.match(block, /\/logistica\/pedidos/);
  assert.doesNotMatch(block, /\/clientes|\/produtos|\/precos|\/tabelas|\/marketing/);
});

test("pagina de logistica usa endpoints dedicados e paginacao", () => {
  const page = readSource("../src/pages/LogisticaPedidos/LogisticaPedidos.jsx");
  const dashboard = readSource("../src/pages/LogisticaDashboard/LogisticaDashboard.jsx");
  assert.match(page, /api\.get\("\/logistica\/pedidos"/);
  assert.match(page, /api\.patch\(`\/logistica\/pedidos\/\$\{detail\._id\}`/);
  assert.match(page, /<PaginationControls/);
  assert.match(page, /aguardandoAcao/);
  assert.match(page, /\["faturado", "enviado", "entregue"\]\.includes\(pedido\.status\)/);
  assert.match(dashboard, /Aguardando conferência, fechamento ou faturamento/);
});

test("tela logistica mantem itens e valores somente leitura", () => {
  const page = readSource("../src/pages/LogisticaPedidos/LogisticaPedidos.jsx");
  const detail = readSource("../src/components/OrderDetails/OrderDetailModal.jsx");
  const items = readSource("../src/components/OrderDetails/OrderItems.jsx");
  assert.match(page, /<OrderDetailModal/);
  assert.match(detail, /<OrderItems/);
  assert.match(items, /formatCurrency\(item\.valorUnitario\)/);
  assert.doesNotMatch(page, /updateField\("itens"/);
  assert.doesNotMatch(page, /updateField\("valorTotal"/);
  assert.doesNotMatch(page, /updateField\("cliente/);
});

test("admin e logistica reutilizam o mesmo detalhe operacional", () => {
  const admin = readSource("../src/pages/AdminPedidos/AdminPedidos.jsx");
  const logistics = readSource("../src/pages/LogisticaPedidos/LogisticaPedidos.jsx");
  assert.match(admin, /<OrderDetailModal/);
  assert.match(admin, /isAdmin/);
  assert.match(admin, /\/pedidos\/\$\{detail\._id\}\/aprovar/);
  assert.match(logistics, /<OrderDetailModal/);
});

test("distribuidor visualiza tracking sem campos internos", () => {
  const page = readSource("../src/pages/MeusPedidos/MeusPedidos.jsx");
  assert.match(page, /<OrderProgress status=\{pedido\.status\}/);
  assert.match(page, /pedido\.numeroNotaFiscal/);
  assert.match(page, /pedido\.transportadora/);
  assert.match(page, /pedido\.codigoRastreio/);
  assert.match(page, /pedido\.dataEnvio/);
  assert.match(page, /pedido\.dataEntrega/);
  assert.doesNotMatch(page, /Produtos do pedido|<OrderItems|pedido\.itens/);
  assert.doesNotMatch(page, /pedido\.temDivergencia|pedido\.ocorrencias/);
  assert.doesNotMatch(page, /observacaoLogistica|historicoStatus|usuarioNome|usuarioTipo|Faltante|Atendido/);
});

test("cliente confirma recebimento somente quando o pedido esta enviado", () => {
  const page = readSource("../src/pages/MeusPedidos/MeusPedidos.jsx");
  assert.match(page, /pedido\.status === "enviado"/);
  assert.match(page, /Confirma que este pedido foi recebido\?/);
  assert.match(page, /api\.patch\(`\/pedidos\/\$\{pedido\._id\}\/confirmar-recebimento`\)/);
  assert.match(page, /Confirmar recebimento/);
  assert.match(page, /setPedidos/);
  assert.match(page, /formatOrderDateTime\(pedido\.dataEntrega/);
});

test("logistica consulta entrega sem conseguir edita-la", () => {
  const page = readSource("../src/pages/LogisticaPedidos/LogisticaPedidos.jsx");
  const detail = readSource("../src/components/OrderDetails/OrderDetailModal.jsx");
  assert.match(detail, /formatOrderDateTime\(detail\.dataEntrega, "Ainda não confirmada"\)/);
  assert.doesNotMatch(page, /updateField\("dataEntrega"/);
  assert.doesNotMatch(detail, /onFieldChange\("dataEntrega"/);
});

test("logistica baixa PDF operacional pelo endpoint dedicado", () => {
  const page = readSource("../src/pages/LogisticaPedidos/LogisticaPedidos.jsx");
  const pdfUtils = readSource("../src/utils/pdfPedido.js");
  assert.match(page, /abrirOuBaixarPdfSeparacao/);
  assert.match(readSource("../src/components/OrderDetails/OrderDetailModal.jsx"), /PDF de separação/);
  assert.match(page, /abrirOuBaixarPdfSeparacao/);
  assert.match(pdfUtils, /\/logistica\/pedidos\/\$\{pedidoId\}\/pdf-separacao/);
  assert.match(pdfUtils, /responseType: "blob"/);
});

test("timeline representa fluxo e cancelamento", () => {
  assert.deepEqual(ORDER_PROGRESS_STEPS, [
    "aguardando_aprovacao",
    "aprovado",
    "separando",
    "separado",
    "faturado",
    "enviado",
    "entregue",
  ]);
  assert.equal(formatOrderStatus("novo"), "Pedido recebido");
  assert.equal(formatOrderStatus("aguardando_aprovacao"), "Aguardando aprovação");
  assert.deepEqual(getOrderProgress("em_analise"), {
    canceled: false,
    currentIndex: 1,
  });
  assert.deepEqual(getOrderProgress("cancelado"), {
    canceled: true,
    currentIndex: -1,
  });
});

test("payload progressivo nao antecipa separacao ou dados comerciais", () => {
  const aprovado = {
    status: "aprovado",
    itens: [{ produtoId: "507f1f77bcf86cd799439011", quantidade: 12 }],
  };
  const formAprovado = buildOrderOperationsForm(aprovado);
  formAprovado.status = "separando";
  formAprovado.separacao["507f1f77bcf86cd799439011"] = 8;
  const payloadAprovado = buildOrderOperationsPayload(aprovado, formAprovado);
  assert.equal(Object.hasOwn(payloadAprovado, "separacaoItens"), false);
  assert.equal(Object.hasOwn(payloadAprovado, "numeroNotaFiscal"), false);
  assert.equal(Object.hasOwn(payloadAprovado, "dataEnvio"), false);

  const pedido = { ...aprovado, status: "separando" };
  const form = buildOrderOperationsForm(pedido);
  assert.equal(form.separacao["507f1f77bcf86cd799439011"], "");
  form.status = "separado";
  form.separacao["507f1f77bcf86cd799439011"] = 8;
  form.ocorrenciaConteudo = "Falta confirmada";
  form.ocorrenciaTipo = "falta_produto";
  const payload = buildOrderOperationsPayload(pedido, form);
  assert.deepEqual(payload.separacaoItens, [{
    produtoId: "507f1f77bcf86cd799439011",
    quantidadeSeparada: 8,
  }]);
  assert.equal(payload.novaOcorrencia.tipo, "falta_produto");
  assert.equal(payload.novaOcorrencia.visibilidade, "interna");
  assert.equal(Object.hasOwn(payload, "valorTotal"), false);
  assert.equal(Object.hasOwn(payload, "itens"), false);
});

test("etapas do detalhe definem uma unica proxima acao operacional", () => {
  assert.equal(getOrderFlowStage({ status: "aprovado" }).nextStatus, "separando");
  assert.equal(getOrderFlowStage({ status: "separando" }).showSeparationEditor, true);
  assert.equal(getOrderFlowStage({
    status: "separado",
    conferenciaObrigatoria: true,
    conferencia: { status: "pendente" },
  }).conferenceFocused, true);
  assert.equal(getOrderFlowStage({
    status: "separado",
    conferenciaObrigatoria: true,
    conferencia: { status: "concluida" },
  }).nextStatus, "faturado");
  assert.equal(getOrderFlowStage({ status: "faturado" }).showShipping, true);
  assert.equal(getOrderFlowStage({ status: "enviado" }).showShippingSummary, true);
  assert.equal(getOrderFlowStage({ status: "entregue" }).terminal, true);
  assert.equal(getOrderFlowStage({ status: "cancelado" }).terminal, true);
  assert.equal(getOrderFlowStage({ status: "novo", entregaFinalizada: true }).terminal, true);
});

test("fechamento pendente vira etapa derivada sem criar novo status", () => {
  const pedido = {
    status: "separado",
    conferenciaObrigatoria: true,
    conferencia: { status: "concluida" },
    fechamentoLogisticoObrigatorio: true,
  };
  const stage = getOrderFlowStage(pedido);
  assert.equal(stage.key, "logistics_closing");
  assert.equal(stage.showLogisticsClosing, true);
  assert.equal(stage.nextStatus, undefined);
  assert.equal(pedido.status, "separado");
});

test("fechamento completo libera etapa administrativa de faturamento", () => {
  const pedido = {
    status: "separado",
    conferenciaObrigatoria: true,
    conferencia: { status: "concluida" },
    fechamentoLogisticoObrigatorio: true,
    fechamentoLogistico: {
      quantidadeVolumes: 3,
      pesoTotalKg: 38.5,
      observacaoVolumes: "Três caixas",
      preenchidoEm: "2026-08-12T15:00:00.000Z",
      preenchidoPor: { operadorId: "507f1f77bcf86cd799439011" },
    },
  };
  assert.equal(isLogisticsClosingComplete(pedido), true);
  const stage = getOrderFlowStage(pedido);
  assert.equal(stage.key, "ready_billing");
  assert.equal(stage.nextStatus, "faturado");
  assert.equal(stage.showInvoicing, true);
});

test("pedido historico sem obrigatoriedade ignora fechamento sem erro", () => {
  const stage = getOrderFlowStage({ status: "separado" });
  assert.equal(stage.key, "ready_billing");
  assert.equal(stage.nextStatus, "faturado");
});

test("formulario recarrega os dados atuais do fechamento", () => {
  const form = buildOrderOperationsForm({
    status: "separado",
    fechamentoLogistico: {
      quantidadeVolumes: 2,
      pesoTotalKg: 12.75,
      observacaoVolumes: "Duas caixas lacradas",
    },
  });
  assert.equal(form.quantidadeVolumes, 2);
  assert.equal(form.pesoTotalKg, 12.75);
  assert.equal(form.observacaoVolumes, "Duas caixas lacradas");
});

test("payload do fechamento normaliza virgula sem incluir status", () => {
  const payload = buildLogisticsClosingPayload({
    quantidadeVolumes: "4",
    pesoTotalKg: "38,5",
    observacaoVolumes: "  Quatro caixas  ",
  });
  assert.deepEqual(payload, {
    fechamentoLogistico: {
      quantidadeVolumes: "4",
      pesoTotalKg: "38.5",
      observacaoVolumes: "Quatro caixas",
    },
  });
  assert.equal(Object.hasOwn(payload, "status"), false);
});

test("faturamento envia somente NF e data antes da mudanca de status", () => {
  const pedido = { status: "separado", itens: [] };
  const form = buildOrderOperationsForm(pedido);
  form.status = "faturado";
  form.numeroNotaFiscal = "NF-2026-1";
  form.dataFaturamento = "2026-08-12";
  form.transportadora = "Não deve antecipar";
  form.dataEnvio = "2026-08-13";
  const payload = buildOrderOperationsPayload(pedido, form);
  assert.equal(payload.numeroNotaFiscal, "NF-2026-1");
  assert.equal(payload.dataFaturamento, "2026-08-12");
  assert.equal(Object.hasOwn(payload, "transportadora"), false);
  assert.equal(Object.hasOwn(payload, "dataEnvio"), false);
});

test("envio nao reenvia nem permite editar campos de faturamento", () => {
  const pedido = {
    status: "faturado",
    numeroNotaFiscal: "NF-PERSISTIDA",
    dataFaturamento: "2026-08-12T00:00:00.000Z",
    itens: [],
  };
  const form = buildOrderOperationsForm(pedido);
  form.status = "enviado";
  form.numeroNotaFiscal = "NF-ALTERADA";
  form.dataFaturamento = "2026-08-10";
  form.transportadora = "Atual Transportes";
  form.dataEnvio = "2026-08-13";
  const payload = buildOrderOperationsPayload(pedido, form);
  assert.equal(payload.transportadora, "Atual Transportes");
  assert.equal(payload.dataEnvio, "2026-08-13");
  assert.equal(Object.hasOwn(payload, "numeroNotaFiscal"), false);
  assert.equal(Object.hasOwn(payload, "dataFaturamento"), false);
});

test("modal reserva fechamento a Logistica e faturamento ao Admin", () => {
  const modal = readSource("../src/components/OrderDetails/OrderDetailModal.jsx");
  const logistics = readSource("../src/pages/LogisticaPedidos/LogisticaPedidos.jsx");
  assert.match(modal, /flowStage\.showLogisticsClosing && !isAdmin/);
  assert.match(modal, /flowStage\.showLogisticsClosing && isAdmin/);
  assert.match(modal, /flowStage\.showInvoicing && isAdmin/);
  assert.match(logistics, /X-Operador-Contexto/);
  assert.match(logistics, /buildLogisticsClosingPayload/);
});

test("conferencia preenche os valores separados e monta payload por item", () => {
  const pedido = {
    status: "separado",
    conferenciaObrigatoria: true,
    conferencia: { status: "em_andamento" },
    itens: [
      { produtoId: "507f1f77bcf86cd799439011", quantidade: 12, quantidadeSeparada: 12 },
      { produtoId: "507f1f77bcf86cd799439012", quantidade: 10, quantidadeSeparada: 8 },
    ],
  };
  const form = buildOrderOperationsForm(pedido);
  assert.equal(form.conferencia["507f1f77bcf86cd799439011"], 12);
  assert.equal(form.conferencia["507f1f77bcf86cd799439012"], 8);
  form.conferencia["507f1f77bcf86cd799439011"] = 11;
  form.observacaoConferencia = "Uma unidade divergente";

  assert.deepEqual(buildConferencePayload(pedido, form), {
    conferencia: {
      acao: "concluir",
      itens: [
        { produtoId: "507f1f77bcf86cd799439011", quantidadeConferida: 11 },
        { produtoId: "507f1f77bcf86cd799439012", quantidadeConferida: 8 },
      ],
      observacao: "Uma unidade divergente",
    },
  });
  assert.equal(Object.hasOwn(buildOrderOperationsPayload(pedido, form), "separacaoItens"), false);
});

test("Admin e Logistica compartilham conferencia e cliente nao recebe detalhes internos", () => {
  const modal = readSource("../src/components/OrderDetails/OrderDetailModal.jsx");
  const conferenceItems = readSource("../src/components/OrderDetails/ConferenceItems.jsx");
  const admin = readSource("../src/pages/AdminPedidos/AdminPedidos.jsx");
  const logistics = readSource("../src/pages/LogisticaPedidos/LogisticaPedidos.jsx");
  const client = readSource("../src/pages/MeusPedidos/MeusPedidos.jsx");

  assert.match(modal, /ConferÃªncia nÃ£o registrada|Conferência não registrada/);
  assert.match(modal, /onStartConference/);
  assert.match(modal, /onCompleteConference/);
  assert.match(conferenceItems, /Quantidade conferida de/);
  assert.match(conferenceItems, /DiferenÃ§a|Diferença/);
  assert.match(admin, /buildConferencePayload/);
  assert.match(logistics, /buildConferencePayload/);
  assert.doesNotMatch(client, /conferencia|concluidoPor|quantidadeConferida/);
});

test("card administrativo mostra status e somente abre o detalhe", () => {
  const admin = readSource("../src/pages/AdminPedidos/AdminPedidos.jsx");
  const cards = admin.match(/\{pedidosFiltrados\.map[\s\S]*?\{detail && operationsForm/)?.[0] || "";
  assert.match(cards, /statusBadge/);
  assert.match(cards, /Visualizar pedido/);
  assert.doesNotMatch(cards, /Salvar Status|Editar Pedido|Baixar PDF|Excluir Pedido/);
  assert.doesNotMatch(admin, /statusSelecionado|alterarStatus/);
});

test("detalhe administrativo centraliza edicao PDFs relatorio e exclusao", () => {
  const modal = readSource("../src/components/OrderDetails/OrderDetailModal.jsx");
  const admin = readSource("../src/pages/AdminPedidos/AdminPedidos.jsx");
  assert.match(modal, /Editar pedido/);
  assert.match(modal, /PDF comercial/);
  assert.match(modal, /PDF de separação/);
  assert.match(modal, /Relatório operacional/);
  assert.match(modal, /className=\{styles\.dangerButton\}/);
  assert.match(admin, /onDownloadReportPdf=\{baixarRelatorioPedido\}/);
});

test("pedido entregue vira detalhe terminal sem formulario operacional", () => {
  const modal = readSource("../src/components/OrderDetails/OrderDetailModal.jsx");
  const operations = readSource("../src/utils/orderOperations.js");
  assert.match(operations, /pedido\.status === "entregue"/);
  assert.match(operations, /Pedido entregue — estado final/);
  assert.match(modal, /operationFormVisible/);
  assert.match(modal, /!terminal && conferenceStatus === "em_andamento"/);
  assert.match(modal, /isAdmin && !terminal && \["aguardando_aprovacao"/);
  assert.match(modal, /isAdmin && !terminal/);
});

test("detalhe exibe apenas os controles pertinentes a etapa atual", () => {
  const modal = readSource("../src/components/OrderDetails/OrderDetailModal.jsx");
  assert.match(modal, /Próxima ação necessária/);
  assert.match(modal, /flowStage\.showSeparationEditor/);
  assert.match(modal, /flowStage\.conferenceFocused/);
  assert.match(modal, /flowStage\.showInvoicing && isAdmin/);
  assert.match(modal, /flowStage\.showShipping && <section>/);
  assert.match(modal, /flowStage\.showShippingSummary/);
  assert.match(modal, /required=\{sendingSelected\}/);
});

test("timeline do detalhe usa somente consolidacao real do backend", () => {
  const modal = readSource("../src/components/OrderDetails/OrderDetailModal.jsx");
  assert.match(modal, /detail\.historicoPedido \|\| \[\]/);
  assert.match(modal, /Histórico do pedido/);
  assert.match(modal, /entry\.titulo/);
  assert.doesNotMatch(modal, /detail\.historicoStatus|detail\.ocorrencias|buildTimeline/);
});

test("nova ocorrencia na operacao e sempre interna", () => {
  const modal = readSource("../src/components/OrderDetails/OrderDetailModal.jsx");
  const operations = readSource("../src/utils/orderOperations.js");
  assert.match(modal, /Visível somente para Admin e Logística/);
  assert.doesNotMatch(modal, /ocorrenciaVisibilidade|Visível ao Cliente/);
  assert.match(operations, /visibilidade: "interna"/);
  assert.doesNotMatch(operations, /form\.ocorrenciaVisibilidade/);
});

test("Meus Pedidos remove produtos sem alterar tracking, total ou PDF", () => {
  const client = readSource("../src/pages/MeusPedidos/MeusPedidos.jsx");
  assert.doesNotMatch(client, /Produtos do pedido|OrderItems|pedido\.itens/);
  assert.match(client, /formatCurrency\(pedido\.valorTotal\)/);
  assert.match(client, /abrirOuBaixarPdfPedido/);
  assert.match(client, /<OrderProgress/);
});

test("Admin possui gestão dedicada de operadores da Logística", () => {
  const app = readSource("../src/App.jsx");
  const navbar = readSource("../src/components/Navbar/Navbar.jsx");
  const page = readSource("../src/pages/AdminOperadoresLogistica/AdminOperadoresLogistica.jsx");
  assert.match(app, /path="\/admin\/operadores-logistica"[\s\S]*?<RoleRoute role="admin">/);
  assert.match(navbar, /\/admin\/operadores-logistica/);
  assert.match(page, /api\.post\("\/admin\/operadores-logistica"/);
  assert.match(page, /api\.patch\([\s\S]*?\/admin\/operadores-logistica\/\$\{operator\._id\}/);
  assert.match(page, /\/\$\{operator\._id\}\/pin/);
  assert.match(page, /type="password"/);
  assert.match(page, /Desativar/);
  assert.match(page, /Ativar/);
});

test("abertura logística exige operador e PIN por pedido", () => {
  const page = readSource("../src/pages/LogisticaPedidos/LogisticaPedidos.jsx");
  const modal = readSource("../src/components/OperatorIdentification/OperatorIdentificationModal.jsx");
  assert.match(page, /api\.get\("\/logistica\/operadores"/);
  assert.match(page, /\/pedidos\/\$\{identification\.pedidoId\}\/identificar/);
  assert.match(page, /contextoOperacional/);
  assert.match(page, /"X-Operador-Contexto"/);
  assert.match(page, /setOperatorContext\(null\)/);
  assert.match(page, /reauthentication: true/);
  assert.doesNotMatch(page, /localStorage|sessionStorage/);
  assert.match(modal, /Quem está operando\?/);
  assert.match(modal, /PIN do operador/);
  assert.match(modal, /type="password"/);
  assert.match(modal, /inputMode="numeric"/);
  assert.match(modal, /pattern="\[0-9\]\{4,6\}"/);
});

test("contexto operacional protege alterações e PDF sem enviar autoria no body", () => {
  const page = readSource("../src/pages/LogisticaPedidos/LogisticaPedidos.jsx");
  const pdf = readSource("../src/utils/pdfPedido.js");
  const operations = readSource("../src/utils/orderOperations.js");
  assert.match(page, /api\.patch\(`\/logistica\/pedidos\/\$\{detail\._id\}`[\s\S]*?X-Operador-Contexto/);
  assert.match(pdf, /X-Operador-Contexto/);
  assert.doesNotMatch(operations, /operadorId|operadorNome|contextoOperacional/);
});

test("utilitario baixa relatorio no endpoint administrativo", () => {
  const pdf = readSource("../src/utils/pdfPedido.js");
  assert.match(pdf, /abrirOuBaixarRelatorioPedido/);
  assert.match(pdf, /\/pedidos\/\$\{pedidoId\}\/relatorio/);
  assert.match(pdf, /relatorio-\$\{sanitizeFileName/);
});

test("relatorio possui estado de carregamento independente dos outros PDFs", () => {
  const admin = readSource("../src/pages/AdminPedidos/AdminPedidos.jsx");
  assert.match(admin, /downloadingCommercialPdf/);
  assert.match(admin, /downloadingSeparationPdf/);
  assert.match(admin, /downloadingReportPdf/);
  assert.match(admin, /abrirOuBaixarRelatorioPedido/);
});

test("layout do detalhe distribui acoes e itens do cliente no mobile", () => {
  const css = readSource("../src/components/OrderDetails/OrderDetails.module.css");
  assert.match(css, /modalHeaderActions \{[^}]*flex-wrap: wrap/);
  assert.match(css, /customerItemRow/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /\.customerItemRow \{ grid-template-columns: minmax\(0, 1fr\) 62px; \}/);
});

test("status no card administrativo e somente leitura", () => {
  const admin = readSource("../src/pages/AdminPedidos/AdminPedidos.jsx");
  assert.match(admin, /data-status=\{pedido\.entregaFinalizada \? "entregue" : pedido\.status\}/);
  assert.match(admin, /formatarStatus\(pedido\.entregaFinalizada \? "entregue" : pedido\.status\)/);
  assert.doesNotMatch(admin, /\/pedidos\/\$\{pedidoId\}\/status/);
});
