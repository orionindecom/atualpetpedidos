import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import { buildOrderAuditTimeline } from "../utils/pedidoAuditoria.js";

const TIME_ZONE = "America/Sao_Paulo";

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", { timeZone: TIME_ZONE });
};

const sanitizeFileName = (value) => (
  String(value || "pedido")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
);

const pdfText = (value) => String(value ?? "-")
  .replace(/[‐‑‒–—]/g, "-")
  .replace(/→/g, "->")
  .replace(/·/g, "-");

const STATUS_LABELS = Object.freeze({
  aguardando_aprovacao: "Aguardando aprovação",
  aprovado: "Aprovado",
  novo: "Novo",
  em_analise: "Em análise",
  separando: "Em separação",
  separado: "Separado",
  faturado: "Faturado",
  enviado: "Enviado",
  entregue: "Entregue",
  cancelado: "Cancelado",
});

const PROFILE_LABELS = Object.freeze({
  admin: "Admin",
  cliente: "Cliente",
  logistica: "Logística",
  operador_logistica: "Operador da Logística",
});

const statusLabel = (status) => STATUS_LABELS[status] || status || "-";

const asOptionalNumber = (value) => (
  value === undefined || value === null || value === "" ? null : Number(value)
);

const getAuditItemQuantities = (item) => {
  const quantidadeSolicitada = Number(item.quantidade || 0);
  const quantidadeSeparada = asOptionalNumber(item.quantidadeSeparada);
  const quantidadeFinal = asOptionalNumber(item.quantidadeFinal);
  const quantidadeAtendida = quantidadeFinal ?? quantidadeSeparada;
  return {
    quantidadeSolicitada,
    quantidadeSeparada,
    quantidadeConferida: item.quantidadeConferida ?? null,
    quantidadeFinal,
    quantidadeFaltante: quantidadeAtendida === null
      ? null
      : Math.max(quantidadeSolicitada - quantidadeAtendida, 0),
    situacaoSeparacao: item.situacaoSeparacao || "pendente",
    situacaoFinal: item.situacaoFinal,
  };
};

export const buildOrderAuditPdfData = (pedido) => {
  const source = typeof pedido?.toObject === "function" ? pedido.toObject() : { ...pedido };
  const timeline = buildOrderAuditTimeline(source);
  const deliveryFinalized = source.status === "entregue" || Boolean(source.dataEntrega) || (
    source.historicoStatus || []
  ).some((entry) => entry.novoStatus === "entregue");
  const items = (source.itens || []).map((item) => {
    const separation = getAuditItemQuantities(item);
    return {
      nomeProduto: item.nomeProduto || "Produto sem nome",
      quantidadeSolicitada: separation.quantidadeSolicitada,
      quantidadeSeparada: separation.quantidadeSeparada,
      quantidadeConferida: separation.quantidadeConferida,
      quantidadeFinal: separation.quantidadeFinal,
      quantidadeFaltante: separation.quantidadeFaltante,
      situacaoSeparacao: separation.situacaoSeparacao,
      situacaoFinal: separation.situacaoFinal,
    };
  });
  const separationStart = timeline.find((event) => event.tipo === "separacao_iniciada");
  const separationEnd = timeline.find((event) => event.tipo === "separacao_concluida");

  return {
    numeroPedido: source.numeroPedido || "-",
    cliente: source.nomeFantasiaCliente || source.razaoSocialCliente || "-",
    razaoSocial: source.razaoSocialCliente || "-",
    cnpj: source.cnpjCliente || "-",
    responsavel: source.nomeResponsavel || "-",
    dataPedido: formatDateTime(source.createdAt || source.dataPedido),
    status: deliveryFinalized ? "entregue" : source.status,
    statusLabel: statusLabel(deliveryFinalized ? "entregue" : source.status),
    aprovacao: source.aprovacao
      ? {
        data: formatDateTime(source.aprovacao.aprovadoEm),
        responsavel: source.aprovacao.usuarioNome || "Administrador",
      }
      : null,
    separacao: {
      iniciadaEm: separationStart ? formatDateTime(separationStart.data) : "-",
      iniciadaPor: separationStart?.responsavelNome || "-",
      concluidaEm: separationEnd ? formatDateTime(separationEnd.data) : "-",
      concluidaPor: separationEnd?.responsavelNome || "-",
    },
    items,
    conferenciaObrigatoria: source.conferenciaObrigatoria === true,
    conferencia: source.conferencia
      ? {
        status: source.conferencia.status,
        iniciadaEm: formatDateTime(source.conferencia.iniciadaEm),
        iniciadaPor: source.conferencia.iniciadoPor?.operadorNome ||
          source.conferencia.iniciadoPor?.usuarioNome || "-",
        concluidaEm: formatDateTime(source.conferencia.concluidaEm),
        concluidaPor: source.conferencia.concluidoPor?.operadorNome ||
          source.conferencia.concluidoPor?.usuarioNome || "-",
        totalItens: source.conferencia.totalItens ?? source.conferencia.itens?.length ?? 0,
        totalDivergencias: source.conferencia.totalDivergencias ?? 0,
        observacao: source.conferencia.observacao || "",
      }
      : null,
    timeline: timeline.map((event) => ({
      ...event,
      dataFormatada: formatDateTime(event.data),
      responsavelPerfilLabel:
        PROFILE_LABELS[event.responsavelPerfil] || event.responsavelPerfil,
      statusAnteriorLabel: statusLabel(event.statusAnterior),
      statusNovoLabel: statusLabel(event.statusNovo),
    })),
    possuiDadosOperacionaisLegados: source.conferenciaObrigatoria !== true,
  };
};

export const gerarPdfRelatorioPedido = (pedido, res) => {
  const data = buildOrderAuditPdfData(pedido);
  const doc = new PDFDocument({ margin: 48, size: "A4", bufferPages: true });
  const left = 48;
  const right = 547;
  const width = right - left;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=relatorio-${sanitizeFileName(data.numeroPedido)}.pdf`
  );
  doc.pipe(res);

  const ensureSpace = (height = 70) => {
    if (doc.y + height <= 765) return;
    doc.addPage();
    doc.y = 48;
  };
  const sectionTitle = (title) => {
    ensureSpace(45);
    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#174e4b").text(title);
    doc.moveDown(0.35);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor("#a8c8c5").stroke();
    doc.moveDown(0.55);
    doc.fillColor("#1f2937");
  };
  const field = (label, value) => {
    doc.font("Helvetica-Bold").fontSize(9).text(`${pdfText(label)}: `, { continued: true });
    doc.font("Helvetica").text(pdfText(value));
  };

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  try {
    doc.image(path.join(__dirname, "../assets/logo-atualpet.png"), left, 30, { width: 94 });
  } catch {
    doc.fontSize(18).font("Helvetica-Bold").text("ATUALPET", left, 38);
  }
  doc
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor("#174e4b")
    .text("RELATÓRIO OPERACIONAL DO PEDIDO", 170, 42, {
      width: right - 170,
      align: "right",
    });
  doc.y = 96;
  doc.fillColor("#1f2937");

  sectionTitle("IDENTIFICAÇÃO");
  field("Pedido", data.numeroPedido);
  field("Cliente", data.cliente);
  field("Razão social", data.razaoSocial);
  field("CNPJ", data.cnpj);
  field("Responsável", data.responsavel);
  field("Criado em", data.dataPedido);
  field("Estado final no momento da emissão", data.statusLabel);

  sectionTitle("APROVAÇÃO");
  if (data.aprovacao) {
    field("Aprovado em", data.aprovacao.data);
    field("Aprovado por", data.aprovacao.responsavel);
  } else {
    doc.font("Helvetica").fontSize(9).text("Não há registro estruturado de aprovação neste pedido.");
  }

  sectionTitle("ITENS E QUANTIDADES OPERACIONAIS");
  for (const item of data.items) {
    ensureSpace(58);
    doc.font("Helvetica-Bold").fontSize(9).text(pdfText(item.nomeProduto), { width });
    doc.font("Helvetica").fontSize(8).fillColor("#475569").text(
      `Solicitado: ${item.quantidadeSolicitada}  |  Separado: ${item.quantidadeSeparada ?? "não registrado"}  |  Conferido: ${item.quantidadeConferida ?? "não registrado"}  |  Final: ${item.quantidadeFinal ?? "não registrado"}  |  Faltante: ${item.quantidadeFaltante ?? "não registrado"}`,
      { width }
    );
    doc.fillColor("#1f2937").moveDown(0.55);
  }

  sectionTitle("SEPARAÇÃO E CONFERÊNCIA");
  field("Separação iniciada em", data.separacao.iniciadaEm);
  field("Separação iniciada por", data.separacao.iniciadaPor);
  field("Separação concluída em", data.separacao.concluidaEm);
  field("Separação concluída por", data.separacao.concluidaPor);
  doc.moveDown(0.5);
  if (data.conferencia) {
    field("Situação", data.conferencia.status || "-");
    field("Iniciada em", data.conferencia.iniciadaEm);
    field("Iniciada por", data.conferencia.iniciadaPor);
    field("Concluída em", data.conferencia.concluidaEm);
    field("Concluída por", data.conferencia.concluidaPor);
    field("Itens conferidos", data.conferencia.totalItens);
    field("Divergências", data.conferencia.totalDivergencias);
    if (data.conferencia.observacao) field("Observação", data.conferencia.observacao);
  } else {
    doc.font("Helvetica").fontSize(9).text(
      data.conferenciaObrigatoria
        ? "A conferência obrigatória ainda não possui execução registrada."
        : "Conferência não registrada para este pedido histórico."
    );
  }

  sectionTitle("HISTÓRICO IMUTÁVEL REGISTRADO");
  if (data.timeline.length === 0) {
    doc.font("Helvetica").fontSize(9).text("Nenhum evento persistido disponível.");
  }
  for (const event of data.timeline) {
    ensureSpace(72);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#1f2937").text(pdfText(event.titulo));
    doc.font("Helvetica").fontSize(8).fillColor("#64748b").text(
      pdfText(`${event.dataFormatada} - ${event.responsavelNome || "Responsável não registrado"}${event.responsavelPerfilLabel ? ` (${event.responsavelPerfilLabel})` : ""}`)
    );
    if (event.statusAnterior || event.statusNovo) {
      doc.text(pdfText(`${event.statusAnteriorLabel} -> ${event.statusNovoLabel}`));
    }
    if (event.detalhes) doc.fillColor("#334155").text(pdfText(event.detalhes), { width });
    doc.moveDown(0.7);
  }

  if (data.possuiDadosOperacionaisLegados) {
    ensureSpace(42);
    doc
      .font("Helvetica-Oblique")
      .fontSize(7.5)
      .fillColor("#64748b")
      .text("Pedido anterior à obrigatoriedade da conferência estruturada; campos operacionais ausentes permanecem indicados como não registrados.", { width });
  }

  ensureSpace(50);
  doc.moveDown(1.2);
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor("#64748b")
    .text(
      "Relatório administrativo para consulta e auditoria operacional interna. Não substitui documento fiscal, comprovante de entrega ou declaração jurídica.",
      left,
      doc.y,
      { width, align: "center" }
    );

  const pages = doc.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index += 1) {
    doc.switchToPage(index);
    doc.font("Helvetica").fontSize(7).fillColor("#94a3b8").text(
      `Página ${index + 1} de ${pages.count}`,
      left,
      780,
      { width, align: "right", lineBreak: false }
    );
  }
  doc.end();
};
