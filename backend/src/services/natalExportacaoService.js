import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { NATAL_2026 } from "../config/natalPremiado2026.js";
import NatalCupom from "../models/NatalCupom.js";
import NatalDistribuicao from "../models/NatalDistribuicao.js";
import NatalLote from "../models/NatalLote.js";
import NatalParticipacao from "../models/NatalParticipacao.js";
import { NatalExportacao } from "../models/NatalCampanhaEstado.js";
import { buildAutorNatal } from "../models/natalSchemas.js";
import { formatCadastroDocument } from "../utils/cadastroValidation.js";
import { dataBrasilia } from "../utils/natalCampanha.js";
import { NatalError, obterEstadoCampanha, registrarAuditoriaNatal } from "./natalBaseService.js";

const LOGO_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../assets/logo-natal-2026.png");

const descreverOrigem = (origem, lote) => {
  if (origem?.numeroPedido) return `Pedido ${origem.numeroPedido}`;
  if (origem?.tipo === "ajuste_manual") return "Ajuste administrativo";
  if (origem?.tipo === "nao_identificada") return "Não identificada";
  if (origem?.referencia) return truncarTexto(origem.referencia, 60);
  if (lote?.numeroPedido) return `Pedido ${lote.numeroPedido}`;
  return "Saldo anterior aos lotes";
};

const truncarTexto = (texto, max) => {
  const valor = String(texto || "");
  return valor.length > max ? `${valor.slice(0, max - 1)}…` : valor;
};

// Cada cupom é uma chance: o sorteio trabalha sobre cupons, nunca sobre cadastros.
// Entra somente o cupom "valido" cujo cadastro está aprovado e cujo lote de
// distribuição está aprovado (cupons antigos sem lote seguem a regra anterior).
// Pendentes, rejeitados, cancelados, invalidados e saldo não usado ficam de fora.
// Cupons de link antigo seguem exigindo lote ativo; os de link próprio não têm lote nem pedido.
export const listarCuponsValidosParaSorteio = async () => {
  const cupons = await NatalCupom.find({ status: "valido" }).sort({ numero: 1 }).lean();
  if (cupons.length === 0) return [];
  const idsLotes = [...new Set(cupons.filter((cupom) => cupom.loteId).map((cupom) => String(cupom.loteId)))];
  const idsDistribuicoes = [...new Set(cupons.filter((cupom) => cupom.distribuicaoId).map((cupom) => String(cupom.distribuicaoId)))];
  const [participacoes, lotes, distribuicoes] = await Promise.all([
    NatalParticipacao.find({ _id: { $in: cupons.map((cupom) => cupom.participacaoId) }, status: "aprovado" })
      .select("_id clienteId protocolo vendedorNome petshop decisao numeroPedido distribuidorNome status")
      .lean(),
    NatalLote.find({ _id: { $in: idsLotes }, status: "ativo" })
      .select("_id distribuidorNome numeroPedido")
      .lean(),
    NatalDistribuicao.find({ _id: { $in: idsDistribuicoes }, status: "aprovado" })
      .select("_id participacaoId clienteId protocolo vendedorNome")
      .lean(),
  ]);
  const participacoesPorId = new Map(participacoes.map((item) => [String(item._id), item]));
  const lotesPorId = new Map(lotes.map((item) => [String(item._id), item]));
  const distribuicoesPorId = new Map(distribuicoes.map((item) => [String(item._id), item]));

  const linhas = cupons.flatMap((cupom) => {
    const participacao = participacoesPorId.get(String(cupom.participacaoId));
    const lote = cupom.loteId ? lotesPorId.get(String(cupom.loteId)) : null;
    const distribuicao = cupom.distribuicaoId ? distribuicoesPorId.get(String(cupom.distribuicaoId)) : null;
    if (!participacao || (cupom.loteId && !lote) || (cupom.distribuicaoId && !distribuicao)) return [];
    // Vínculos coerentes: o cupom pertence ao cadastro e ao distribuidor do lote.
    if (String(participacao.clienteId) !== String(cupom.clienteId)) return [];
    if (distribuicao && (String(distribuicao.participacaoId) !== String(participacao._id) || String(distribuicao.clienteId) !== String(cupom.clienteId))) return [];
    return [{
      numero: cupom.numero,
      codigo: cupom.codigo,
      participacaoId: String(participacao._id),
      petshop: participacao.petshop.nomeFantasia,
      razaoSocial: participacao.petshop.razaoSocial,
      documento: participacao.petshop.documento || participacao.petshop.cnpj,
      distribuidor: lote?.distribuidorNome || participacao.distribuidorNome,
      pedido: lote?.numeroPedido || participacao.numeroPedido || "",
      protocolo: participacao.protocolo,
      lote: distribuicao?.protocolo || participacao.protocolo,
      origem: descreverOrigem(cupom.origemSaldo, lote),
      vendedor: distribuicao?.vendedorNome || participacao.vendedorNome,
      emitidoEm: cupom.emitidoEm,
      aprovadoEm: cupom.validadoEm || cupom.emitidoEm,
    }];
  });
  // Defesa adicional ao índice único: número repetido impede gerar a lista oficial.
  if (new Set(linhas.map((linha) => linha.numero)).size !== linhas.length) {
    throw new NatalError(500, "Há números de cupom repetidos na lista. A exportação foi interrompida.", "numero_repetido");
  }
  return linhas;
};

// Totais de conferência: cupons elegíveis (= participações no sorteio), cupons fora do
// sorteio por situação e pet shops distintos com ao menos um cupom elegível.
export const resumirListaSorteio = async (linhas) => {
  const porStatus = Object.fromEntries((await NatalCupom.aggregate([{ $group: { _id: "$status", total: { $sum: 1 } } }]))
    .map((item) => [item._id, item.total]));
  return {
    cuponsElegiveis: linhas.length,
    petshopsParticipantes: new Set(linhas.map((linha) => linha.participacaoId)).size,
    cuponsValidosForaDaLista: Number(porStatus.valido || 0) - linhas.length,
    cuponsAguardandoValidacao: Number(porStatus.pendente || 0),
    cuponsInvalidados: Number(porStatus.invalidado || 0),
    cuponsCancelados: Number(porStatus.cancelado || 0),
    cuponsRejeitados: Number(porStatus.rejeitado || 0),
    cuponsEmitidos: Object.values(porStatus).reduce((soma, valor) => soma + Number(valor), 0),
  };
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
  const cabecalho = [
    "numero_cupom", "pet_shop", "razao_social", "cpf_cnpj", "distribuidor", "pedido", "protocolo", "vendedor", "aprovado_em",
    "lote_distribuicao", "origem_saldo", "emitido_em",
  ];
  const dataHora = (valor) => (valor ? new Date(valor).toLocaleString("pt-BR", { timeZone: NATAL_2026.timeZone }) : "");
  const corpo = linhas.map((linha) => [
    linha.codigo,
    linha.petshop,
    linha.razaoSocial,
    formatCadastroDocument(linha.documento),
    linha.distribuidor,
    linha.pedido,
    linha.protocolo,
    linha.vendedor,
    dataHora(linha.aprovadoEm),
    linha.lote,
    linha.origem,
    dataHora(linha.emitidoEm),
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

// Documento parcialmente mascarado para relatórios públicos (LGPD).
export const mascararDocumento = (documento) => {
  const digitos = String(documento || "").replace(/\D/g, "");
  if (digitos.length === 14) return `${digitos.slice(0, 2)}.***.***/${digitos.slice(8, 12)}-**`;
  if (digitos.length === 11) return `***.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-**`;
  return "";
};

const ROTULOS_SITUACAO = Object.freeze({
  valido: "Válido",
  pendente: "Aguardando validação",
  rejeitado: "Rejeitado",
  cancelado: "Cancelado",
  invalidado: "Invalidado",
});

// Todos os cupons emitidos, com a situação de cada um, para o relatório de auditoria.
export const listarCuponsAuditoria = async () => {
  const [cupons, elegiveis] = await Promise.all([
    NatalCupom.find({}).sort({ numero: 1 }).lean(),
    listarCuponsValidosParaSorteio(),
  ]);
  const elegivelPorNumero = new Set(elegiveis.map((linha) => linha.numero));
  const [participacoes, distribuicoes, lotes] = await Promise.all([
    NatalParticipacao.find({ _id: { $in: [...new Set(cupons.map((item) => String(item.participacaoId)))] } })
      .select("_id protocolo petshop distribuidorNome").lean(),
    NatalDistribuicao.find({ _id: { $in: [...new Set(cupons.filter((item) => item.distribuicaoId).map((item) => String(item.distribuicaoId)))] } })
      .select("_id protocolo").lean(),
    NatalLote.find({ _id: { $in: [...new Set(cupons.filter((item) => item.loteId).map((item) => String(item.loteId)))] } })
      .select("_id distribuidorNome numeroPedido").lean(),
  ]);
  const porId = (lista) => new Map(lista.map((item) => [String(item._id), item]));
  const [mapaParticipacoes, mapaDistribuicoes, mapaLotes] = [porId(participacoes), porId(distribuicoes), porId(lotes)];
  return cupons.map((cupom) => {
    const participacao = mapaParticipacoes.get(String(cupom.participacaoId));
    const lote = cupom.loteId ? mapaLotes.get(String(cupom.loteId)) : null;
    const elegivel = elegivelPorNumero.has(cupom.numero);
    return {
      numero: cupom.numero,
      codigo: cupom.codigo,
      participacaoId: String(cupom.participacaoId),
      petshop: participacao?.petshop?.nomeFantasia || "",
      documento: participacao?.petshop?.documento || participacao?.petshop?.cnpj || "",
      distribuidor: lote?.distribuidorNome || participacao?.distribuidorNome || "",
      lote: mapaDistribuicoes.get(String(cupom.distribuicaoId))?.protocolo || participacao?.protocolo || "",
      origem: descreverOrigem(cupom.origemSaldo, lote),
      status: cupom.status,
      situacao: elegivel ? "Elegível" : (cupom.status === "valido" ? "Válido fora da lista" : ROTULOS_SITUACAO[cupom.status] || cupom.status),
      elegivel,
      emitidoEm: cupom.emitidoEm,
    };
  });
};

const dataBR = (valor) => (valor ? new Date(valor).toLocaleDateString("pt-BR", { timeZone: NATAL_2026.timeZone }) : "");
const dataHoraBR = (valor) => (valor ? new Date(valor).toLocaleString("pt-BR", { timeZone: NATAL_2026.timeZone }) : "");

const pdfParaBuffer = (montar, info) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ size: "A4", margin: 36, info });
  const partes = [];
  doc.on("data", (parte) => partes.push(parte));
  doc.on("end", () => resolve(Buffer.concat(partes)));
  doc.on("error", reject);
  montar(doc);
  doc.end();
});

const cabecalhoRelatorio = (doc, titulo, subtitulo) => {
  doc.rect(0, 0, doc.page.width, 64).fill(VERMELHO);
  try {
    doc.image(LOGO_PATH, doc.page.width - 36 - 44, 10, { width: 44 });
  } catch {
    // Sem a logo o relatório continua válido.
  }
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#FFFFFF").text(titulo, 36, 18, { width: doc.page.width - 140 });
  doc.font("Helvetica").fontSize(9).fillColor("#FFFFFF").text(subtitulo, 36, 40, { width: doc.page.width - 140 });
  doc.fillColor(GRAFITE);
  doc.y = 80;
};

// Relatório de auditoria: totais e uma linha por cupom. A versão pública mostra só os
// cupons elegíveis, com documento mascarado e sem dados internos.
export const gerarPdfAuditoria = (linhas, resumo, { publico = false, previa = false, now = new Date() } = {}) => pdfParaBuffer((doc) => {
  const titulo = publico ? "Natal Premiado Atual Pet 2026 — Lista de cupons participantes" : "Natal Premiado Atual Pet 2026 — Auditoria de cupons";
  cabecalhoRelatorio(doc, titulo, `${previa ? "PRÉVIA — lista oficial ainda não fechada · " : ""}Gerado em ${dataHoraBR(now)} · Sorteio em ${dataBR(NATAL_2026.sorteio)}`);

  const totais = publico
    ? [["Cupons elegíveis (chances no sorteio)", resumo.cuponsElegiveis], ["Pet shops participantes", resumo.petshopsParticipantes]]
    : [
      ["Cupons elegíveis (chances no sorteio)", resumo.cuponsElegiveis],
      ["Pet shops participantes", resumo.petshopsParticipantes],
      ["Cupons aguardando validação", resumo.cuponsAguardandoValidacao],
      ["Cupons invalidados", resumo.cuponsInvalidados],
      ["Cupons cancelados", resumo.cuponsCancelados],
      ["Cupons rejeitados", resumo.cuponsRejeitados],
      ["Cupons emitidos (todas as situações)", resumo.cuponsEmitidos],
    ];
  doc.font("Helvetica-Bold").fontSize(10).fillColor(VERDE).text("TOTAIS", 36, doc.y);
  doc.moveDown(0.3);
  for (const [rotulo, valor] of totais) {
    const y = doc.y;
    doc.font("Helvetica").fontSize(9.5).fillColor(GRAFITE).text(rotulo, 36, y, { width: 330 });
    doc.font("Helvetica-Bold").text(String(valor), 370, y, { width: 80, align: "right" });
    doc.moveDown(0.2);
  }
  doc.moveDown(0.4);
  doc.font("Helvetica").fontSize(8).fillColor("#666666").text(
    "Cada cupom é uma chance independente no sorteio. Um pet shop com vários cupons válidos tem várias chances. " +
    "Somente cupons válidos, de cadastros e lotes validados, participam.",
    36, doc.y, { width: doc.page.width - 72 }
  );
  doc.moveDown(0.8);

  const colunas = publico
    ? [["Cupom", 50], ["Pet shop", 150], ["CPF/CNPJ", 95], ["Distribuidor", 125], ["Lote", 85]]
    : [["Cupom", 42], ["Pet shop", 95], ["CPF/CNPJ", 82], ["Distribuidor", 80], ["Lote", 66], ["Origem", 64], ["Situação", 58], ["Emissão", 46]];
  const largura = colunas.reduce((soma, [, l]) => soma + l, 0);
  const desenharCabecalho = () => {
    const y = doc.y;
    doc.rect(36, y - 2, largura, 14).fill("#EFEFEF");
    let x = 36;
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(GRAFITE);
    for (const [rotulo, l] of colunas) {
      doc.text(rotulo, x + 2, y + 1, { width: l - 4, lineBreak: false });
      x += l;
    }
    doc.y = y + 15;
  };
  desenharCabecalho();
  const lista = publico ? linhas.filter((linha) => linha.elegivel !== false) : linhas;
  if (lista.length === 0) doc.font("Helvetica").fontSize(9).text("Nenhum cupom.", 38, doc.y + 4);
  for (const linha of lista) {
    if (doc.y > doc.page.height - 50) {
      doc.addPage();
      doc.y = 40;
      desenharCabecalho();
    }
    const valores = publico
      ? [linha.codigo, linha.petshop, mascararDocumento(linha.documento), linha.distribuidor, linha.lote]
      : [linha.codigo, linha.petshop, formatCadastroDocument(linha.documento), linha.distribuidor, linha.lote, linha.origem, linha.situacao, dataBR(linha.emitidoEm)];
    const y = doc.y;
    let x = 36;
    doc.font("Helvetica").fontSize(7.5).fillColor(GRAFITE);
    valores.forEach((valor, indice) => {
      const l = colunas[indice][1];
      doc.text(truncar(valor, Math.floor(l / 4.1)), x + 2, y, { width: l - 4, lineBreak: false });
      x += l;
    });
    doc.y = y + 12;
  }
}, { Title: publico ? "Natal Premiado 2026 - Cupons participantes" : "Natal Premiado 2026 - Auditoria de cupons" });

const TIPOS_EXPORTACAO = Object.freeze({
  pdf_urna: { nome: "cupons-urna", extensao: "pdf", contentType: "application/pdf" },
  csv_numerica: { nome: "lista-numerica", extensao: "csv", contentType: "text/csv; charset=utf-8" },
  pdf_auditoria: { nome: "auditoria-cupons", extensao: "pdf", contentType: "application/pdf" },
  pdf_auditoria_publica: { nome: "cupons-participantes", extensao: "pdf", contentType: "application/pdf" },
});

export const gerarExportacao = async ({ tipo, usuario, now = new Date() }) => {
  const formato = TIPOS_EXPORTACAO[tipo];
  if (!formato) throw new NatalError(400, "Tipo de exportação inválido.", "tipo_invalido");
  const [linhas, estado] = await Promise.all([listarCuponsValidosParaSorteio(), obterEstadoCampanha()]);
  const listaFechada = Boolean(estado.listaFechada);
  let buffer;
  if (tipo === "pdf_urna") buffer = await gerarPdfCupons(linhas, { previa: !listaFechada });
  else if (tipo === "csv_numerica") buffer = gerarCsvCupons(linhas);
  else {
    const resumo = await resumirListaSorteio(linhas);
    const publico = tipo === "pdf_auditoria_publica";
    buffer = await gerarPdfAuditoria(publico ? linhas.map((linha) => ({ ...linha, elegivel: true })) : await listarCuponsAuditoria(), resumo, { publico, previa: !listaFechada, now });
  }
  const pdf = formato.extensao === "pdf";
  const sufixo = listaFechada ? "" : "-previa";
  const nomeArquivo = `natal-2026-${formato.nome}-${carimbo(now)}${sufixo}.${formato.extensao}`;
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
    contentType: pdf ? "application/pdf" : formato.contentType,
    totalCupons: linhas.length,
  };
};

// Resultado do sorteio: identifica o cupom sorteado e o participante correspondente.
// O sorteio em si é externo (urna ou extração); aqui só se confere e documenta o número.
export const gerarResultadoSorteio = async ({ numero, usuario, now = new Date() }) => {
  const digitos = String(numero ?? "").replace(/\D/g, "").slice(0, 9);
  if (!digitos) throw new NatalError(400, "Informe o número do cupom sorteado.", "numero_invalido");
  const [linhas, estado] = await Promise.all([listarCuponsValidosParaSorteio(), obterEstadoCampanha()]);
  const sorteado = linhas.find((linha) => linha.numero === Number(digitos));
  if (!sorteado) {
    const cupom = await NatalCupom.findOne({ numero: Number(digitos) }).select("status").lean();
    throw new NatalError(
      409,
      cupom ? `O cupom ${digitos} não é elegível (situação: ${ROTULOS_SITUACAO[cupom.status] || cupom.status}). Sorteie outro número.` : `O cupom ${digitos} não existe.`,
      "cupom_nao_elegivel"
    );
  }
  const resumo = await resumirListaSorteio(linhas);
  const listaFechada = Boolean(estado.listaFechada);
  // Impressão digital da lista usada: permite conferir que nada mudou depois.
  const assinaturaLista = crypto.createHash("sha256").update(linhas.map((linha) => linha.numero).join(",")).digest("hex");
  const chancesDoParticipante = linhas.filter((linha) => linha.participacaoId === sorteado.participacaoId).length;
  const autor = buildAutorNatal(usuario);

  const buffer = await pdfParaBuffer((doc) => {
    cabecalhoRelatorio(doc, "Natal Premiado Atual Pet 2026 — Resultado do sorteio", `${listaFechada ? "" : "PRÉVIA — lista oficial ainda não fechada · "}Gerado em ${dataHoraBR(now)}`);
    doc.moveDown(1);
    doc.font("Helvetica").fontSize(10).fillColor(GRAFITE).text("Cupom sorteado", { align: "center" });
    doc.font("Helvetica-Bold").fontSize(48).fillColor(VERMELHO).text(sorteado.codigo, { align: "center" });
    doc.moveDown(0.5);
    const campo = (rotulo, valor) => {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(VERDE).text(rotulo.toUpperCase());
      doc.font("Helvetica").fontSize(12).fillColor(GRAFITE).text(valor || "—");
      doc.moveDown(0.5);
    };
    campo("Pet shop", sorteado.petshop);
    campo("CPF/CNPJ", mascararDocumento(sorteado.documento));
    campo("Distribuidor", sorteado.distribuidor);
    campo("Lote de distribuição", sorteado.lote);
    campo("Prêmio", NATAL_2026.premio);
    campo("Chances do participante", `${chancesDoParticipante} cupom(ns) válido(s) de ${resumo.cuponsElegiveis} cupons elegíveis`);
    campo("Pet shops participantes", String(resumo.petshopsParticipantes));
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(7.5).fillColor("#666666")
      .text(`Assinatura da lista elegível (SHA-256 dos números em ordem): ${assinaturaLista}`)
      .text(`Responsável pela emissão: ${autor.usuarioNome || "—"}`);
  }, { Title: `Natal Premiado 2026 - Resultado - Cupom ${sorteado.codigo}` });

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const nomeArquivo = `natal-2026-resultado-cupom-${sorteado.codigo}-${carimbo(now)}${listaFechada ? "" : "-previa"}.pdf`;
  await NatalExportacao.create({
    tipo: "pdf_resultado",
    geradaEm: now,
    autor,
    listaFechada,
    totalCupons: linhas.length,
    nomeArquivo,
    sha256,
    numeros: [sorteado.numero],
  });
  await registrarAuditoriaNatal({
    acao: "resultado_sorteio_gerado",
    autor,
    now,
    clienteId: undefined,
    participacaoId: sorteado.participacaoId,
    cupomNumero: sorteado.numero,
    detalhes: { cupom: sorteado.codigo, totalElegiveis: linhas.length, chancesDoParticipante, assinaturaLista, listaFechada, sha256, nomeArquivo },
  });
  return { buffer, nomeArquivo, contentType: "application/pdf", totalCupons: linhas.length, sorteado: { codigo: sorteado.codigo, petshop: sorteado.petshop } };
};
