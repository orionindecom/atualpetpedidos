import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildOrderMetricsParams,
  formatDuration,
  formatPercentage,
  getAttentionLabel,
} from "../src/utils/orderMetrics.js";

const readSource = (relativePath) => readFileSync(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  "utf8"
);

test("formatador central exibe duração amigável sem milissegundos", () => {
  assert.equal(formatDuration(null), "Sem amostra");
  assert.equal(formatDuration(18 * 60 * 1000), "18min");
  assert.equal(formatDuration((60 + 24) * 60 * 1000), "1h 24min");
  assert.equal(formatDuration((2 * 24 * 60 + 3 * 60) * 60 * 1000), "2d 3h");
  assert.equal(formatPercentage(12.34), "12,3%");
});

test("filtros enviam datas somente no período personalizado e operador quando selecionado", () => {
  assert.deepEqual(buildOrderMetricsParams({
    periodo: "30dias",
    dataInicio: "2026-01-01",
    dataFim: "2026-12-31",
    operadorId: "",
  }), { periodo: "30dias" });
  assert.deepEqual(buildOrderMetricsParams({
    periodo: "personalizado",
    dataInicio: "2026-08-01",
    dataFim: "2026-08-12",
    operadorId: "507f1f77bcf86cd799439011",
  }), {
    periodo: "personalizado",
    dataInicio: "2026-08-01",
    dataFim: "2026-08-12",
    operadorId: "507f1f77bcf86cd799439011",
  });
});

test("classificação diferencia aguardando, andamento e acima do normal", () => {
  assert.equal(getAttentionLabel("aguardando"), "Aguardando");
  assert.equal(getAttentionLabel("em_andamento"), "Em andamento");
  assert.equal(getAttentionLabel("acima_tempo_normal"), "Acima do tempo normal");
});

test("Admin possui rota e navegação exclusivas para métricas operacionais", () => {
  const app = readSource("../src/App.jsx");
  const navbar = readSource("../src/components/Navbar/Navbar.jsx");
  assert.match(app, /path="\/admin\/metricas-operacionais"[\s\S]*?<RoleRoute role="admin">/);
  assert.match(navbar, /\/admin\/metricas-operacionais/);
  assert.match(navbar, /Métricas Operacionais/);
});

test("dashboard usa endpoint agregado, filtros, PDF, amostras e acesso ao pedido", () => {
  const page = readSource("../src/pages/AdminMetricasPedidos/AdminMetricasPedidos.jsx");
  const utils = readSource("../src/utils/orderMetrics.js");
  const adminOrders = readSource("../src/pages/AdminPedidos/AdminPedidos.jsx");
  assert.match(page, /api\.get\("\/admin\/metricas-pedidos"/);
  assert.match(page, /\/admin\/metricas-pedidos\/pdf/);
  assert.match(page, /Todos os operadores/);
  assert.match(utils, /Últimos 7 dias/);
  assert.match(page, /mediana/);
  assert.match(page, /P90/);
  assert.match(page, /Tempos em horas corridas/);
  assert.match(page, /\/pedidos\?pedido=\$\{order\.pedidoId\}/);
  assert.match(adminOrders, /searchParams\.get\("pedido"\)/);
  assert.doesNotMatch(page, /valorTotal|faturamento|melhor operador|pior operador/i);
});

test("layout converte tabelas em cards e não cria overflow horizontal no mobile", () => {
  const css = readSource("../src/pages/AdminMetricasPedidos/AdminMetricasPedidos.module.css");
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /\.operatorTable article[\s\S]*grid-template-columns: 1fr/);
  assert.doesNotMatch(css, /^\s*width:\s*\d{4,}px/m);
});
