import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { NATAL_2026 } from "../config/natalPremiado2026.js";
import NatalCupom from "../models/NatalCupom.js";
import NatalLote from "../models/NatalLote.js";
import NatalParticipacao from "../models/NatalParticipacao.js";
import { NatalExportacao } from "../models/NatalCampanhaEstado.js";
import { buildAutorNatal } from "../models/natalSchemas.js";
import { formatCadastroDocument } from "../utils/cadastroValidation.js";
import { dataBrasilia } from "../utils/natalCampanha.js";
import { garantirIndicesNatal, obterEstadoCampanha, registrarAuditoriaNatal } from "./natalBaseService.js";

const LOGO_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../assets/logo-natal-2026.png");

// Somente cupons válidos de participações aprovadas em lotes ativos entram no
// sorteio; pendentes, rejeitados, cancelados, invalidados e saldo não usado ficam de fora.
export const listarCuponsValidosParaSorteio = async () => {
  await garantirIndicesNatal();
  const cupons = await NatalCupom.find({ status: "valido" }).sort({ numero: 1 }).lean();
  if (cupons.length === 0) return [];
  const [participacoes, lotes] = await Promise.all([
    NatalParticipacao.find({ _id: { $in: cupons.map((cupom) => cupom.participacaoId) }, status: "aprovado" })
      .select("_id protocolo vendedorNome petshop decisao numeroPedido distribuidorNome status")
      .lean(),
    NatalLote.find({ _id: { $in: [...new Set(cupons.map((cupom) => String(cupom.loteId)))] }, status: "ativo" })
      .select("_id distribuidorNome numeroPedido")
      .lean(),
  ]);
  const participacoesPorId = new Map(participacoes.map((item) => [String(item._id), item]));
  const lotesPorId = new Map(lotes.map((item) => [String(item._id), item]));

  return cupons.flatMap((cupom) => {
    const participacao = participacoesPorId.get(String(cupom.participacaoId));
    const lote = lotesPorId.get(String(cupom.loteId));
    if (!participacao || !lote) return [];
    return [{
      numero: cupom.numero,
      codigo: cupom.codigo,
      petshop: participacao.petshop.nomeFantasia,
      razaoSocial: participacao.petshop.razaoSocial,
      documento: participacao.petshop.documento || participacao.petshop.cnpj,
      distribuidor: lote.distribuidorNome,
      pedido: lote.numeroPedido,
      protocolo: participacao.protocolo,
      vendedor: participacao.vendedorNome,
      aprovadoEm: cupom.emitidoEm,
    }];
  });
};

// Evita que planilhas interpretem conteúdo digitado como fórmula.
const celulaCsv = (value) => {
  let texto = value === undefined || value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return `"${texto.replace(/"/g, '""')}"`;
};

const carimbo = (now) => {
  const data = dataBrasilia(now).replace(/-/g, "");
  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: NATAL_2026.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(now).replace(":", "");
  return `${data}-${hora}`;
};

export const gerarCsvCupons = (linhas) => {
  const cabecalho = ["numero_cupom", "pet_shop", "razao_social", "cpf_cnpj", "distribuidor", "pedido", "protocolo", "vendedor", "aprovado_em"];
  const corpo = linhas.map((linha) => [
    linha.codigo,
    linha.petshop,
    linha.razaoSocial,
    formatCadastroDocument(linha.documento),
    linha.distribuidor,
    linha.pedido,
    linha.protocolo,
    linha.vendedor,
    new Date(linha.aprovadoEm).toLocaleString("pt-BR", { timeZone: NATAL_2026.timeZone }),
  ].map(celulaCsv).join(";"));
  return Buffer.from(`﻿${[cabecalho.map(celulaCsv).join(";"), ...corpo].join("\r\n")}\r\n`, "utf8");
};

const VERMELHO = "#A70000";
const VERDE = "#556B2F";
const GRAFITE = "#414141";

const truncar = (texto, max) => {
  const valor = String(texto || "");
  return valor.length > max ? `${valor.slice(0, max - 1)}…` : valor;
};

// Cupons padronizados para impressão em A4 (10 por folha) com linhas de corte.
export const gerarPdfCupons = (linhas, { previa = false } = {}) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: "Natal Premiado Atual Pet 2026 - Cupons" } });
  const partes = [];
  doc.on("data", (parte) => partes.push(parte));
  doc.on("end", () => resolve(Buffer.concat(partes)));
  doc.on("error", reject);

  const margem = 28;
  const colunas = 2;
  const linhasPorFolha = 5;
  const largura = (doc.page.width - margem * 2) / colunas;
  const altura = (doc.page.height - margem * 2) / linhasPorFolha;
  const porFolha = colunas * linhasPorFolha;

  if (linhas.length === 0) {
    doc.font("Helvetica-Bold").fontSize(16).fillColor(GRAFITE)
      .text("Nenhum cupom válido para impressão.", margem, 120, { width: doc.page.width - margem * 2, align: "center" });
  }

  linhas.forEach((linha, indice) => {
    if (indice > 0 && indice % porFolha === 0) doc.addPage({ size: "A4", margin: 0 });
    const posicao = indice % porFolha;
    const x = margem + (posicao % colunas) * largura;
    const y = margem + Math.floor(posicao / colunas) * altura;
    const pad = 12;

    doc.save().lineWidth(0.6).dash(4, { space: 3 }).strokeColor("#9a9a9a").rect(x, y, largura, altura).stroke().restore();
    doc.rect(x + 6, y + 6, largura - 12, 22).fill(VERMELHO);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#FFFFFF")
      .text("NATAL PREMIADO ATUAL PET 2026", x + pad, y + 12.5, { width: largura - pad * 2, align: "center", lineBreak: false });

    try {
      doc.image(LOGO_PATH, x + largura - pad - 50, y + 36, { width: 50 });
    } catch {
      // Sem o arquivo da logo o cupom continua válido para impressão.
    }

    doc.font("Helvetica").fontSize(7.5).fillColor(GRAFITE).text("CUPOM Nº", x + pad, y + 36, { lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(30).fillColor(VERMELHO).text(linha.codigo, x + pad, y + 46, { lineBreak: false });

    const campo = (rotulo, valor, linhaY) => {
      doc.font("Helvetica-Bold").fontSize(7).fillColor(VERDE).text(rotulo, x + pad, linhaY, { lineBreak: false });
      doc.font("Helvetica").fontSize(8.5).fillColor(GRAFITE)
        .text(truncar(valor, 52), x + pad + 58, linhaY - 1, { width: largura - pad * 2 - 58, lineBreak: false });
    };
    campo("PET SHOP", linha.petshop, y + 90);
    campo("CPF/CNPJ", formatCadastroDocument(linha.documento), y + 104);
    campo("DISTRIBUIDOR", linha.distribuidor, y + 118);

    doc.font("Helvetica").fontSize(6.5).fillColor("#777777")
      .text(
        previa ? "PRÉVIA — lista oficial ainda não fechada" : "Sorteio em 15/12/2026 · Kit Groomer Profissional",
        x + pad, y + altura - 18, { width: largura - pad * 2, align: "center", lineBreak: false }
      );
  });

  doc.end();
});

export const gerarExportacao = async ({ tipo, usuario, now = new Date() }) => {
  const [linhas, estado] = await Promise.all([listarCuponsValidosParaSorteio(), obterEstadoCampanha()]);
  const listaFechada = Boolean(estado.listaFechada);
  const pdf = tipo === "pdf_urna";
  const buffer = pdf ? await gerarPdfCupons(linhas, { previa: !listaFechada }) : gerarCsvCupons(linhas);
  const sufixo = listaFechada ? "" : "-previa";
  const nomeArquivo = `natal-2026-${pdf ? "cupons-urna" : "lista-numerica"}-${carimbo(now)}${sufixo}.${pdf ? "pdf" : "csv"}`;
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const autor = buildAutorNatal(usuario);

  await NatalExportacao.create({
    tipo,
    geradaEm: now,
    autor,
    listaFechada,
    totalCupons: linhas.length,
    nomeArquivo,
    sha256,
    numeros: linhas.map((linha) => linha.numero),
  });
  await registrarAuditoriaNatal({
    acao: "exportacao_gerada",
    autor,
    now,
    detalhes: { tipo, totalCupons: linhas.length, listaFechada, sha256, nomeArquivo },
  });

  return {
    buffer,
    nomeArquivo,
    contentType: pdf ? "application/pdf" : "text/csv; charset=utf-8",
    totalCupons: linhas.length,
  };
};
