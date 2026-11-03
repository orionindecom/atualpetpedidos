import { FAIXA_SEM_BENEFICIOS, NATAL_2026 } from "../config/natalPremiado2026.js";
import { isValidBrazilianPhone, normalizeDigits, validateCadastroDocument } from "./cadastroValidation.js";

// Regras puras da campanha Natal Premiado 2026 (sem acesso a banco).

export const PARTICIPACAO_STATUS = Object.freeze([
  "pendente",
  "aprovado",
  "rejeitado",
  "cancelado",
  "invalidado_pedido",
  "invalidado_revisao",
]);

export const PARTICIPACAO_STATUS_LABELS = Object.freeze({
  pendente: "Pendente",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  cancelado: "Cancelado",
  invalidado_pedido: "Invalidado por cancelamento do pedido",
  invalidado_revisao: "Invalidado por revisão de faixa",
});

export const GESTORES_CAMPANHA = Object.freeze(["admin", "comercial"]);

export const isGestorCampanha = (usuario) => Boolean(
  usuario && usuario.ativo !== false && GESTORES_CAMPANHA.includes(usuario.tipo)
);

export const isDistribuidorCampanha = (usuario) => Boolean(
  usuario && usuario.ativo !== false && usuario.tipo === "cliente"
);

const toCents = (value) => Math.round(Number(value || 0) * 100);

// Maior faixa cujo valor mínimo foi atingido pelo valor do pedido.
export const calcularFaixa = (valor, faixas = NATAL_2026.faixas) => {
  const cents = toCents(valor);
  let resultado = null;
  for (const faixa of faixas) {
    if (cents >= toCents(faixa.valorMinimo)) resultado = faixa;
  }
  return resultado;
};

// Benefícios efetivos para um valor: a faixa atingida ou "sem benefícios" (0 cupons, 0%).
export const beneficiosParaValor = (valor, faixas = NATAL_2026.faixas) => beneficiosDaFaixa(calcularFaixa(valor, faixas) || FAIXA_SEM_BENEFICIOS);

export const beneficiosDaFaixa = (faixa) => (faixa ? {
  nivel: faixa.nivel,
  valorMinimo: faixa.valorMinimo,
  cupons: faixa.cupons,
  marketingPercentual: faixa.marketingPercentual,
  produtosPercentual: faixa.produtosPercentual,
} : null);

export const proximaFaixa = (valor, faixas = NATAL_2026.faixas) => {
  const cents = toCents(valor);
  return faixas.find((faixa) => toCents(faixa.valorMinimo) > cents) || null;
};

// Data civil (AAAA-MM-DD) no horário de Brasília.
export const dataBrasilia = (date, timeZone = NATAL_2026.timeZone) => {
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};

export const situacaoCadastros = (config = NATAL_2026, now = new Date()) => {
  if (now < config.inicio) return "nao_iniciada";
  if (now > config.fimCadastros) return "encerrada";
  return "aberta";
};

// O pedido participa quando foi lançado dentro do período da campanha.
export const pedidoDentroDoPeriodo = (pedido, config = NATAL_2026) => {
  const criado = new Date(pedido?.createdAt || pedido?.dataPedido || NaN);
  if (Number.isNaN(criado.getTime())) return false;
  return criado >= config.inicio && criado <= config.fimCadastros;
};

// Todo status posterior à aprovação (exceto cancelado) mantém o pedido aprovado.
export const pedidoAprovadoParaCampanha = (pedido) => Boolean(
  pedido && !["aguardando_aprovacao", "cancelado"].includes(pedido.status)
);

export const formatarNumeroCupom = (numero, digitos = NATAL_2026.numeracao.digitos) => (
  String(numero).padStart(digitos, "0")
);

export const saldoLote = (lote) => {
  const concedidos = Number(lote?.cuponsConcedidos || 0);
  const aprovados = Number(lote?.contadores?.aprovados || 0);
  return {
    concedidos,
    aprovados,
    pendentes: Number(lote?.contadores?.pendentes || 0),
    rejeitados: Number(lote?.contadores?.rejeitados || 0),
    cancelados: Number(lote?.contadores?.cancelados || 0),
    invalidados: Number(lote?.contadores?.invalidados || 0),
    invalidadosRevisao: Number(lote?.contadores?.invalidadosRevisao || 0),
    disponivel: lote?.status === "ativo" ? Math.max(concedidos - aprovados, 0) : 0,
  };
};

const LIMITES = Object.freeze({
  vendedorNome: [2, 120],
  nomeFantasia: [2, 160],
  razaoSocial: [2, 200],
  responsavel: [2, 120],
});

const ROTULOS = Object.freeze({
  vendedorNome: "o nome do vendedor",
  nomeFantasia: "o nome fantasia do pet shop",
  razaoSocial: "a razão social",
  responsavel: "o nome do responsável",
});

const limparTexto = (value) => (typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim()
  : "");

export const normalizarInstagram = (value) => {
  let texto = limparTexto(value).toLowerCase();
  texto = texto.replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/[/?#].*$/, "");
  texto = texto.replace(/^@+/, "");
  return /^[a-z0-9._]{1,30}$/.test(texto) && !/^\.|\.$|\.\./.test(texto) ? texto : null;
};

// Aceita número ou texto no formato brasileiro ("12.345,67") ou decimal ("12345.67").
export const parseValorMonetario = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let texto = value.replace(/[R$\s]/g, "");
  if (!texto) return null;
  if (texto.includes(",")) texto = texto.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(texto)) return null;
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
};

export const validarParticipacaoPublica = (body = {}, { config = NATAL_2026, now = new Date() } = {}) => {
  const errors = {};
  const data = {};

  for (const [campo, [min, max]] of Object.entries(LIMITES)) {
    const valor = limparTexto(body[campo]);
    if (valor.length < min || valor.length > max) {
      errors[campo] = `Informe ${ROTULOS[campo]} (${min} a ${max} caracteres).`;
    } else {
      data[campo] = valor;
    }
  }

  // CPF ou CNPJ (o campo legado "cnpj" continua aceito).
  const documento = validateCadastroDocument(body.documento ?? body.cnpj);
  if (!documento.valid) errors.documento = documento.error || "Informe um CPF ou CNPJ válido.";
  else {
    data.documento = documento.digits;
    data.tipoDocumento = documento.type;
  }

  const whatsapp = normalizeDigits(body.whatsapp);
  if (!isValidBrazilianPhone(whatsapp)) errors.whatsapp = "Informe um WhatsApp ou telefone com DDD.";
  else data.whatsapp = whatsapp;

  const instagram = normalizarInstagram(body.instagram);
  if (!instagram) errors.instagram = "Informe o Instagram do estabelecimento (ex.: @petshop).";
  else data.instagram = instagram;

  const dataCompra = typeof body.dataCompra === "string" ? body.dataCompra.trim() : "";
  const hoje = dataBrasilia(now, config.timeZone);
  const inicio = dataBrasilia(config.inicio, config.timeZone);
  const fim = dataBrasilia(config.fimCadastros, config.timeZone);
  const limite = hoje < fim ? hoje : fim;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataCompra) || Number.isNaN(new Date(`${dataCompra}T12:00:00-03:00`).getTime()) ||
    dataBrasilia(new Date(`${dataCompra}T12:00:00-03:00`), config.timeZone) !== dataCompra) {
    errors.dataCompra = "Informe a data da compra.";
  } else if (dataCompra < inicio || dataCompra > limite) {
    errors.dataCompra = "A data da compra precisa estar dentro do período da campanha e não pode ser futura.";
  } else {
    data.dataCompra = dataCompra;
  }

  const valorCompra = parseValorMonetario(body.valorCompra);
  if (valorCompra === null || valorCompra <= 0 || valorCompra > 10000000) {
    errors.valorCompra = "Informe o valor da compra.";
  } else {
    data.valorCompra = Math.round(valorCompra * 100) / 100;
  }

  if (body.aceiteTermos !== true && body.aceiteTermos !== "true") {
    errors.aceiteTermos = "Confirme a declaração para enviar o cadastro.";
  }

  return { valid: Object.keys(errors).length === 0, errors, data };
};

// Pistas simples de robô: campo oculto preenchido ou envio rápido demais.
export const pareceEnvioAutomatizado = (body = {}, { config = NATAL_2026, now = Date.now() } = {}) => {
  if (typeof body.website === "string" && body.website.trim() !== "") return true;
  const iniciadoEm = Number(body.iniciadoEm);
  if (!Number.isFinite(iniciadoEm) || iniciadoEm <= 0) return true;
  return now - iniciadoEm < config.tempoMinimoPreenchimentoMs;
};

export const resumoConfigPublica = (config = NATAL_2026) => ({
  slug: config.slug,
  nome: config.nome,
  premio: config.premio,
  inicio: config.inicio.toISOString(),
  fimCadastros: config.fimCadastros.toISOString(),
  sorteio: config.sorteio.toISOString(),
  faixas: config.faixas.map(beneficiosDaFaixa),
  comprovanteMaxBytes: config.comprovante.maxBytes,
});
