import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";

const moeda = (valor) => {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
};

const formatarData = (pedido) => {
  const dia = String(pedido.dia).padStart(2, "0");
  const mes = String(pedido.mes).padStart(2, "0");
  const ano = pedido.ano;

  return `${dia}/${mes}/${ano}`;
};

export const gerarPdfPedido = (pedido, res) => {
  const doc = new PDFDocument({
    margin: 70,
    size: "A4",
  });

  const esquerda = 70;
  const direita = 525;
  const largura = direita - esquerda;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename=${pedido.numeroPedido}.pdf`
  );

  doc.pipe(res);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const logoPath = path.join(__dirname, "../assets/logo-atualpet.png");

  try {
    doc.image(logoPath, esquerda, 35, {
      width: 120,
    });
  } catch {
    doc.fontSize(20).text("ATUALPET", esquerda, 45, {
      width: largura,
      align: "left",
    });
  }

  doc.fontSize(16).font("Helvetica").text("Pedido Comercial", esquerda, 55, {
    width: largura,
    align: "right",
  });

  doc.y = 140;

  doc.moveTo(esquerda, doc.y).lineTo(direita, doc.y).stroke();
  doc.moveDown();

  doc.fontSize(11).font("Helvetica-Bold").text("Pedido:", esquerda, doc.y, {
    continued: true,
  });
  doc.font("Helvetica").text(` ${pedido.numeroPedido}`);

  doc.font("Helvetica-Bold").text("Data:", esquerda, doc.y, {
    continued: true,
  });
  doc.font("Helvetica").text(` ${formatarData(pedido)}`);



  doc.moveDown();

  doc.moveTo(esquerda, doc.y).lineTo(direita, doc.y).stroke();
  doc.moveDown();

  doc.font("Helvetica-Bold").text("Cliente:", esquerda, doc.y, {
    continued: true,
  });
  doc.font("Helvetica").text(` ${pedido.nomeFantasiaCliente || "-"}`);

  doc.font("Helvetica-Bold").text("Razão Social:", esquerda, doc.y, {
    continued: true,
  });
  doc.font("Helvetica").text(` ${pedido.razaoSocialCliente || "-"}`);

  doc.font("Helvetica-Bold").text("CNPJ:", esquerda, doc.y, {
    continued: true,
  });
  doc.font("Helvetica").text(` ${pedido.cnpjCliente || "-"}`);

  doc.font("Helvetica-Bold").text("Telefone:", esquerda, doc.y, {
    continued: true,
  });
  doc.font("Helvetica").text(` ${pedido.telefoneCliente || "-"}`);

  doc.font("Helvetica-Bold").text("WhatsApp:", esquerda, doc.y, {
    continued: true,
  });
  doc.font("Helvetica").text(` ${pedido.whatsappCliente || "-"}`);

  doc.moveDown();

  doc.moveTo(esquerda, doc.y).lineTo(direita, doc.y).stroke();
  doc.moveDown();

  pedido.itens.forEach((item, index) => {
    doc.fontSize(12).font("Helvetica-Bold").text(item.nomeProduto, esquerda);

    doc.moveDown(0.4);

    doc.fontSize(10).font("Helvetica-Bold").text("Quantidade:", esquerda, doc.y, {
      continued: true,
    });
    doc.font("Helvetica").text(` ${item.quantidade}`);

    doc.font("Helvetica-Bold").text("Valor unitário:", esquerda, doc.y, {
      continued: true,
    });
    doc.font("Helvetica").text(` ${moeda(item.valorUnitario)}`);

    doc.font("Helvetica-Bold").text("Subtotal:", esquerda, doc.y, {
      continued: true,
    });
    doc.font("Helvetica").text(` ${moeda(item.subtotal)}`);

    doc.moveDown();

    if (index < pedido.itens.length - 1) {
      doc.moveTo(esquerda, doc.y).lineTo(direita, doc.y).stroke();
      doc.moveDown();
    }
  });

  doc.moveDown();

  doc.moveTo(esquerda, doc.y).lineTo(direita, doc.y).stroke();
  doc.moveDown();

  doc
    .fontSize(14)
    .font("Helvetica-Bold")
    .text(`TOTAL DO PEDIDO: ${moeda(pedido.valorTotal)}`, esquerda, doc.y, {
      width: largura,
      align: "right",
    });

  if (pedido.observacao) {
    doc.moveDown();

    doc.fontSize(11).font("Helvetica-Bold").text("Observação:", esquerda);
    doc.fontSize(10).font("Helvetica").text(pedido.observacao, esquerda, doc.y, {
      width: largura,
    });
  }

  doc.moveDown(2);

  doc.moveTo(esquerda, doc.y).lineTo(direita, doc.y).stroke();
  doc.moveDown();

  doc.fontSize(8).font("Helvetica").text(
    "Documento gerado automaticamente pelo sistema AtualPet.",
    esquerda,
    doc.y,
    {
      width: largura,
      align: "center",
    }
  );

  doc.end();
};