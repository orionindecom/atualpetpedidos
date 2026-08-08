import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";

const formatarData = (pedido) => {
  const data = pedido.dataPedido || pedido.createdAt;
  if (data) {
    const parsed = new Date(data);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    }
  }

  if (pedido.dia && pedido.mes && pedido.ano) {
    return `${String(pedido.dia).padStart(2, "0")}/${String(pedido.mes).padStart(2, "0")}/${pedido.ano}`;
  }

  return "-";
};

const sanitizarNomeArquivo = (value) => (
  String(value || "pedido")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
);

export const buildSeparationPdfData = (pedido) => ({
  numeroPedido: pedido.numeroPedido || "-",
  cliente: pedido.nomeFantasiaCliente || pedido.razaoSocialCliente || "-",
  dataPedido: formatarData(pedido),
  itens: Array.isArray(pedido.itens)
    ? pedido.itens.map((item) => ({
      nomeProduto: item.nomeProduto || "Produto sem nome",
      quantidade: item.quantidade,
    }))
    : [],
  observacao: typeof pedido.observacao === "string" ? pedido.observacao.trim() : "",
});

export const gerarPdfSeparacaoPedido = (pedido, res) => {
  const dados = buildSeparationPdfData(pedido);
  const doc = new PDFDocument({ margin: 60, size: "A4" });
  const esquerda = 60;
  const direita = 535;
  const larguraProduto = 385;
  const xQuantidade = 470;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=separacao-${sanitizarNomeArquivo(dados.numeroPedido)}.pdf`
  );
  doc.pipe(res);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const logoPath = path.join(__dirname, "../assets/logo-atualpet.png");

  try {
    doc.image(logoPath, esquerda, 32, { width: 105 });
  } catch {
    doc.fontSize(18).font("Helvetica-Bold").text("ATUALPET", esquerda, 42);
  }

  doc
    .fontSize(15)
    .font("Helvetica-Bold")
    .text("PEDIDO PARA SEPARAÇÃO", esquerda, 48, {
      width: direita - esquerda,
      align: "right",
    });

  doc.y = 125;
  doc.moveTo(esquerda, doc.y).lineTo(direita, doc.y).strokeColor("#b7c3c0").stroke();
  doc.moveDown(1.2);
  doc.fontSize(10).font("Helvetica-Bold").text("Pedido:", { continued: true });
  doc.font("Helvetica").text(` ${dados.numeroPedido}`);
  doc.font("Helvetica-Bold").text("Cliente:", { continued: true });
  doc.font("Helvetica").text(` ${dados.cliente}`);
  doc.font("Helvetica-Bold").text("Data do pedido:", { continued: true });
  doc.font("Helvetica").text(` ${dados.dataPedido}`);
  doc.moveDown(1.2);

  const escreverCabecalhoTabela = () => {
    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor("#174e4b")
      .text("PRODUTO", esquerda, doc.y, { width: larguraProduto });
    doc.text("QTD", xQuantidade, doc.y - 11, { width: 55, align: "right" });
    doc.moveDown(0.6);
    doc.moveTo(esquerda, doc.y).lineTo(direita, doc.y).strokeColor("#7aa9a5").stroke();
    doc.moveDown(0.5);
    doc.fillColor("#1f2937");
  };

  escreverCabecalhoTabela();

  dados.itens.forEach((item) => {
    const alturaProduto = doc.heightOfString(item.nomeProduto, { width: larguraProduto });
    const alturaLinha = Math.max(alturaProduto, 14) + 10;

    if (doc.y + alturaLinha > 745) {
      doc.addPage();
      doc.y = 60;
      escreverCabecalhoTabela();
    }

    const y = doc.y;
    doc.fontSize(10).font("Helvetica").text(item.nomeProduto, esquerda, y, {
      width: larguraProduto,
    });
    doc.font("Helvetica-Bold").text(String(item.quantidade), xQuantidade, y, {
      width: 55,
      align: "right",
    });
    doc.y = y + alturaLinha;
    doc.moveTo(esquerda, doc.y).lineTo(direita, doc.y).strokeColor("#e2e8e6").stroke();
    doc.moveDown(0.5);
  });

  if (dados.observacao) {
    if (doc.y > 680) doc.addPage();
    doc.moveDown();
    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .text("Observações do pedido:", esquerda, doc.y, {
        width: direita - esquerda,
      });
    doc.moveDown(0.3);
    doc.font("Helvetica").text(dados.observacao, esquerda, doc.y, {
      width: direita - esquerda,
    });
  }

  doc.moveDown(2);
  doc
    .fontSize(8)
    .font("Helvetica")
    .fillColor("#64748b")
    .text("Documento operacional sem informações comerciais.", esquerda, doc.y, {
      width: direita - esquerda,
      align: "center",
    });

  doc.end();
};
