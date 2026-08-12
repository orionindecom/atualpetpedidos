import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";

const PAGE = Object.freeze({ left: 44, right: 551, bottom: 770 });
const CONTENT_WIDTH = PAGE.right - PAGE.left;

const pdfText = (value) => String(value ?? "-")
  .replace(/[‐‑‒–—]/g, "-")
  .replace(/→/g, "->")
  .replace(/↓/g, "-")
  .replace(/↑/g, "+");

const formatDuration = (milliseconds) => {
  if (!Number.isFinite(milliseconds)) return "Sem amostra";
  const totalMinutes = Math.round(milliseconds / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}min`);
  return parts.join(" ");
};

const formatPercent = (value) => (
  `${Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
);

const TIME_LABELS = Object.freeze({
  aprovacao: "Criação até aprovação",
  esperaSeparacao: "Espera pelo início da separação",
  separacao: "Separação",
  esperaConferencia: "Espera pela conferência",
  conferencia: "Conferência",
  total: "Criação até conclusão da conferência",
  operacional: "Tempo operacional",
  parado: "Tempo parado",
});

export const buildPedidoMetricasPdfData = (metrics) => ({
  periodo: `${metrics.filtros.dataInicio} a ${metrics.filtros.dataFim}`,
  timezone: metrics.filtros.timezone,
  operador: metrics.filtros.operador || "Todos os operadores",
  resumo: metrics.resumo,
  tempos: Object.entries(metrics.tempos).map(([key, statistic]) => ({
    key,
    label: TIME_LABELS[key] || key,
    media: formatDuration(statistic.mediaMs),
    mediana: formatDuration(statistic.medianaMs),
    p90: formatDuration(statistic.p90Ms),
    amostra: statistic.amostra,
  })),
  operadores: metrics.operadores || [],
  qualidade: metrics.qualidade,
  produtos: metrics.produtosOcorrencias || [],
  pedidosCriticos: [
    ...(metrics.pedidosAtencao || []).filter((pedido) => (
      pedido.classificacao === "acima_tempo_normal"
    )).map((pedido) => ({
      numeroPedido: pedido.numeroPedido,
      cliente: pedido.cliente,
      motivo: pedido.etapa,
      duracao: formatDuration(pedido.tempoEtapaMs),
    })),
    ...(metrics.pedidosMaisDemorados || []).map((pedido) => ({
      numeroPedido: pedido.numeroPedido,
      cliente: pedido.cliente,
      motivo: "Tempo total concluído",
      duracao: formatDuration(pedido.totalMs),
    })),
  ].slice(0, 12),
  metadados: metrics.metadados,
});

export const gerarPdfMetricasPedidos = (metrics, res) => {
  const data = buildPedidoMetricasPdfData(metrics);
  const doc = new PDFDocument({ margin: PAGE.left, size: "A4", bufferPages: true });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=metricas-operacionais-${metrics.filtros.dataInicio}-${metrics.filtros.dataFim}.pdf`
  );
  doc.pipe(res);

  const ensureSpace = (height = 60) => {
    if (doc.y + height > PAGE.bottom) {
      doc.addPage();
      doc.y = PAGE.left;
    }
    doc.x = PAGE.left;
  };
  const section = (title, subtitle = "", contentHeight = 0) => {
    ensureSpace(Math.max(subtitle ? 54 : 42, contentHeight));
    doc.moveDown(0.65);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#174e4b")
      .text(pdfText(title), PAGE.left, doc.y, { width: CONTENT_WIDTH });
    if (subtitle) {
      doc.font("Helvetica").fontSize(7.8).fillColor("#64748b")
        .text(pdfText(subtitle), PAGE.left, doc.y, { width: CONTENT_WIDTH });
    }
    doc.moveDown(0.3);
    doc.moveTo(PAGE.left, doc.y).lineTo(PAGE.right, doc.y).strokeColor("#aac9c6").stroke();
    doc.moveDown(0.5);
    doc.fillColor("#1f2937");
  };
  const field = (label, value) => {
    ensureSpace(18);
    doc.x = PAGE.left;
    doc.font("Helvetica-Bold").fontSize(8.5).text(`${pdfText(label)}: `, { continued: true });
    doc.font("Helvetica").text(pdfText(value));
  };
  const tableHeader = (columns) => {
    ensureSpace(32);
    const y = doc.y;
    doc.rect(PAGE.left, y, CONTENT_WIDTH, 19).fill("#e7f3f2");
    let x = PAGE.left + 5;
    for (const column of columns) {
      doc.font("Helvetica-Bold").fontSize(7.1).fillColor("#174e4b")
        .text(pdfText(column.label), x, y + 6, { width: column.width - 8, lineBreak: false });
      x += column.width;
    }
    doc.y = y + 23;
    doc.x = PAGE.left;
    doc.fillColor("#1f2937");
  };
  const tableRow = (columns, values, minimumHeight = 24) => {
    const heights = columns.map((column, index) => (
      doc.heightOfString(pdfText(values[index]), { width: column.width - 8 })
    ));
    const height = Math.max(minimumHeight, ...heights.map((value) => value + 10));
    ensureSpace(height + 2);
    const y = doc.y;
    let x = PAGE.left + 5;
    for (const [index, column] of columns.entries()) {
      doc.font("Helvetica").fontSize(7.2).fillColor("#334155")
        .text(pdfText(values[index]), x, y + 5, { width: column.width - 8 });
      x += column.width;
    }
    doc.moveTo(PAGE.left, y + height).lineTo(PAGE.right, y + height)
      .strokeColor("#e2e8f0").stroke();
    doc.y = y + height + 3;
    doc.x = PAGE.left;
  };

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  try {
    doc.image(path.join(__dirname, "../assets/logo-atualpet.png"), PAGE.left, 29, { width: 90 });
  } catch {
    doc.font("Helvetica-Bold").fontSize(17).fillColor("#174e4b").text("ATUALPET", PAGE.left, 39);
  }
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#174e4b")
    .text("MÉTRICAS OPERACIONAIS DE PEDIDOS", 155, 39, {
      width: PAGE.right - 155,
      align: "right",
    });
  doc.y = 91;
  doc.fillColor("#1f2937");

  section("PERÍODO ANALISADO", "Tempos calculados em horas corridas.");
  field("Período", data.periodo);
  field("Timezone", data.timezone);
  field("Operador", data.operador);
  field("Critério dos pedidos", metrics.filtros.criterioPedidos);
  field("Critério dos operadores", metrics.filtros.criterioOperadores);

  section("RESUMO");
  field("Pedidos no período", data.resumo.pedidosNoPeriodo);
  field("Itens únicos", data.resumo.itensUnicos);
  field("Unidades solicitadas", data.resumo.unidadesSolicitadas);
  field("Pedidos com divergência", formatPercent(data.resumo.percentualPedidosComDivergencia));

  section("TEMPOS DO FLUXO", "Média, mediana, P90 e tamanho real da amostra.");
  if (data.tempos.some((time) => time.amostra > 0)) {
    const timeColumns = [
      { label: "Etapa", width: 207 },
      { label: "Média", width: 78 },
      { label: "Mediana", width: 78 },
      { label: "P90", width: 78 },
      { label: "n", width: 66 },
    ];
    tableHeader(timeColumns);
    for (const time of data.tempos) {
      tableRow(timeColumns, [time.label, time.media, time.mediana, time.p90, time.amostra]);
    }
  } else {
    doc.font("Helvetica").fontSize(8.5).text(
      "Nenhuma etapa possui timestamps suficientes para calcular durações neste período.",
      PAGE.left,
      doc.y,
      { width: CONTENT_WIDTH }
    );
  }

  section("OPERADORES", data.operadores.length
    ? "Sem ranking; durações só são atribuídas ao mesmo operador no início e no fim do ciclo."
    : "Nenhum evento de operador foi encontrado no período.", 90);
  if (data.operadores.length) {
    const operatorColumns = [
      { label: "Operador", width: 135 },
      { label: "Pedidos", width: 52 },
      { label: "Sep. fim", width: 56 },
      { label: "Conf. fim", width: 58 },
      { label: "Itens", width: 48 },
      { label: "Média sep.", width: 78 },
      { label: "Média conf.", width: 80 },
    ];
    tableHeader(operatorColumns);
    for (const operator of data.operadores) {
      tableRow(operatorColumns, [
        `${operator.operador}${operator.ativo === false ? " (inativo)" : ""}`,
        operator.pedidosParticipados,
        operator.separacoesConcluidas,
        operator.conferenciasConcluidas,
        operator.itensProcessados,
        formatDuration(operator.tempoSeparacao.mediaMs),
        formatDuration(operator.tempoConferencia.mediaMs),
      ]);
    }
  } else {
    doc.font("Helvetica").fontSize(8.5).text("Sem dados para os filtros aplicados.");
  }

  section("QUALIDADE", "", 155);
  field("Pedidos com divergência", data.qualidade.pedidosComDivergencia);
  field("Itens com divergência", data.qualidade.itensComDivergencia);
  field("Pedidos com falta", data.qualidade.pedidosComFalta);
  field("Itens com falta", data.qualidade.itensComFalta);
  field("Unidades faltantes", data.qualidade.unidadesFaltantes);
  field("Pedidos com item indisponível", data.qualidade.pedidosComItemIndisponivel);
  field("Pedidos com falta parcial", data.qualidade.pedidosComFaltaParcial);

  section("PRODUTOS COM MAIS OCORRÊNCIAS", "", 100);
  if (data.produtos.length) {
    const productColumns = [
      { label: "Produto", width: 207 },
      { label: "Pedidos afetados", width: 86 },
      { label: "Faltas", width: 62 },
      { label: "Divergências", width: 74 },
      { label: "Taxa", width: 78 },
    ];
    tableHeader(productColumns);
    for (const product of data.produtos) {
      tableRow(productColumns, [
        product.produto,
        product.pedidosAfetados,
        product.faltasSeparacao,
        product.divergenciasConferencia,
        formatPercent(product.taxaPedidosAfetados),
      ]);
    }
  } else {
    doc.font("Helvetica").fontSize(8.5).text("Nenhuma falta ou divergência estruturada no período.");
  }

  section("PEDIDOS CRÍTICOS", data.pedidosCriticos.length
    ? "Pedidos acima do padrão atual e pedidos concluídos mais demorados."
    : "Nenhum pedido crítico para os filtros aplicados.", 100);
  if (data.pedidosCriticos.length) {
    const criticalColumns = [
      { label: "Pedido", width: 92 },
      { label: "Cliente", width: 175 },
      { label: "Motivo", width: 156 },
      { label: "Tempo", width: 84 },
    ];
    tableHeader(criticalColumns);
    for (const order of data.pedidosCriticos) {
      tableRow(criticalColumns, [order.numeroPedido, order.cliente, order.motivo, order.duracao]);
    }
  }

  ensureSpace(64);
  doc.x = PAGE.left;
  doc.moveDown(1.2).font("Helvetica-Oblique").fontSize(7.3).fillColor("#64748b")
    .text(
      `Registros com timestamps ausentes ou inconsistentes são excluídos apenas da métrica afetada. Pares inválidos detectados: ${data.metadados.paresDeTimestampInvalidos || 0}.`,
      { width: CONTENT_WIDTH }
    );

  const pages = doc.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index += 1) {
    doc.switchToPage(index);
    doc.font("Helvetica").fontSize(7).fillColor("#94a3b8")
      .text(`Página ${index + 1} de ${pages.count}`, PAGE.left, 786, {
        width: CONTENT_WIDTH,
        align: "right",
        lineBreak: false,
      });
  }
  doc.end();
};
