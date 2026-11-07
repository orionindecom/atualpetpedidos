// Apoio de interface do Natal Premiado 2026. Faixas e regras vêm sempre da API
// (/public/natal-2026/config); aqui ficam apenas formatação e montagem de links.

export const NATAL_PUBLIC_BASE = "/public/natal-2026";

export const PARTICIPACAO_STATUS_LABELS = Object.freeze({
  pendente: "Pendente",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  cancelado: "Cancelado",
  invalidado_pedido: "Invalidado (pedido cancelado)",
  invalidado_revisao: "Invalidado por revisão de faixa",
});

export const PARTICIPACAO_STATUS_TONES = Object.freeze({
  pendente: "accent",
  aprovado: "active",
  rejeitado: "danger",
  cancelado: "inactive",
  invalidado_pedido: "inactive",
  invalidado_revisao: "inactive",
});

export const ALERTA_LABELS = Object.freeze({
  mesmo_comprovante: "Mesmo comprovante enviado em outro cadastro ou lote",
  mesma_compra: "Mesmo CPF/CNPJ, data e valor de compra",
  mesmo_cnpj_data: "Mesmo CPF/CNPJ e data de compra",
  mesmo_documento_distribuidor: "Cadastro antigo com o mesmo CPF/CNPJ neste distribuidor",
});

export const HISTORICO_LABELS = Object.freeze({
  recebido: "Cadastro recebido",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  cancelado: "Cancelado",
  invalidado_pedido: "Invalidado pelo cancelamento do pedido",
  invalidado_revisao: "Invalidado por revisão de faixa",
  alerta_duplicidade: "Alerta de duplicidade",
  ajuste_apos_fechamento: "Ajuste após fechamento",
  lote_recebido: "Novo lote de cupons recebido",
  lote_aprovado: "Lote de cupons aprovado",
  lote_rejeitado: "Lote de cupons rejeitado",
  lote_cancelado: "Lote de cupons cancelado",
  cupons_invalidados_revisao: "Cupons invalidados por revisão de faixa",
});

// ---------- Múltiplos cupons por cadastro ----------

export const CUPOM_STATUS_LABELS = Object.freeze({
  pendente: "Aguardando validação",
  valido: "Válido",
  rejeitado: "Rejeitado",
  cancelado: "Cancelado",
  invalidado: "Invalidado",
});

export const CUPOM_STATUS_TONES = Object.freeze({
  pendente: "accent",
  valido: "active",
  rejeitado: "danger",
  cancelado: "inactive",
  invalidado: "inactive",
});

export const LOTE_STATUS_LABELS = Object.freeze({
  pendente: "Aguardando validação",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  cancelado: "Cancelado",
  invalidado: "Invalidado",
});

export const LOTE_CANAL_LABELS = Object.freeze({
  link_publico: "Link do distribuidor",
  painel_distribuidor: "Painel do distribuidor",
  migracao: "Cadastro anterior aos lotes",
});

// Teto por envio, igual ao do servidor (o saldo do distribuidor limita antes).
export const LIMITE_CUPONS_POR_ENVIO = 1000;

// Validação de interface; o servidor valida de novo e é quem decide.
export const validarQuantidadeCupons = (texto, maximo) => {
  const valor = String(texto ?? "").trim();
  if (!/^\d{1,7}$/.test(valor)) return { valido: false, erro: "Informe um número inteiro de cupons, a partir de 1." };
  const quantidade = Number(valor);
  if (quantidade < 1) return { valido: false, erro: "A quantidade mínima é 1 cupom." };
  if (quantidade > LIMITE_CUPONS_POR_ENVIO) return { valido: false, erro: `A quantidade máxima por envio é de ${LIMITE_CUPONS_POR_ENVIO} cupons.` };
  if (Number.isFinite(maximo) && quantidade > maximo) {
    return { valido: false, erro: maximo > 0 ? `O saldo disponível é de ${maximo} cupom(ns).` : "Não há cupons disponíveis." };
  }
  return { valido: true, quantidade };
};

export const textoCupons = (quantidade) => `${quantidade} ${Number(quantidade) === 1 ? "cupom" : "cupons"}`;
export const textoChances = (quantidade) => `${quantidade} ${Number(quantidade) === 1 ? "chance" : "chances"}`;

// Identificador de um envio: repetir o mesmo envio (clique duplo, conexão que caiu)
// devolve o resultado original no servidor, sem gerar cupons de novo.
export const gerarChaveEnvio = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

// Resumo de cupons de um cadastro (os antigos de 1 cupom não trazem "cupons").
export const resumoCupons = (participacao) => participacao?.cupons || {
  total: 1,
  validos: participacao?.status === "aprovado" ? 1 : 0,
  pendentes: participacao?.status === "pendente" ? 1 : 0,
  cancelados: participacao?.status === "cancelado" ? 1 : 0,
  rejeitados: participacao?.status === "rejeitado" ? 1 : 0,
  invalidados: String(participacao?.status || "").startsWith("invalidado") ? 1 : 0,
};

export const FAIXA_EVENTO_LABELS = Object.freeze({
  criacao: "Lote criado na aprovação",
  aumento_faixa: "Faixa ampliada",
  valor_atualizado: "Valor do pedido atualizado (faixa mantida)",
  invalidacao: "Lote invalidado",
  revisao_mantida: "Redução revisada: benefícios mantidos",
  revisao_adequada: "Redução revisada: benefícios adequados ao novo valor",
  reducao_sem_revisao: "Redução sem revisão administrativa (pendente)",
});

export const MOVIMENTO_CUPOM_LABELS = Object.freeze({
  legado: "Concedidos no modelo anterior",
  conquista: "Liberados por compras",
  revisao_adequacao: "Retirados por revisão",
  ajuste_manual: "Ajuste manual",
});

export const BONIFICACAO_EVENTO_LABELS = Object.freeze({
  complemento: "Complemento calculado",
  recalculo: "Recálculo",
  adequacao: "Adequação administrativa",
  entrega: "Entrega registrada",
});

export const MOTIVO_SINCRONIZACAO_LABELS = Object.freeze({
  conta_ausente: "compras sem saldo registrado",
  acumulado_defasado: "acumulado desatualizado",
  cupons_pendentes: "cupons a liberar",
  bonificacao_pendente: "bonificação a registrar",
  contadores_divergentes: "cupons utilizados divergentes",
});

export const descreverPendenciaSincronizacao = ({ distribuidorNome, motivos = [] }) => (
  `${distribuidorNome || "Distribuidor"} (${motivos.map((motivo) => MOTIVO_SINCRONIZACAO_LABELS[motivo] || motivo).join(", ")})`
);

export const COMPRA_EXTERNA_STATUS_LABELS = Object.freeze({
  pendente: "Aguardando validação",
  validada: "Validada",
  rejeitada: "Rejeitada",
  cancelada: "Cancelada",
});

export const COMPRA_EXTERNA_STATUS_TONES = Object.freeze({
  pendente: "accent",
  validada: "active",
  rejeitada: "danger",
  cancelada: "inactive",
});

const toCents = (value) => Math.round(Number(value || 0) * 100);

// Mesma regra do backend, aplicada sobre as faixas recebidas da API.
export const faixaParaValor = (faixas = [], valor = 0) => {
  let resultado = null;
  for (const faixa of faixas) {
    if (toCents(valor) >= toCents(faixa.valorMinimo)) resultado = faixa;
  }
  return resultado;
};

export const proximaFaixaParaValor = (faixas = [], valor = 0) => (
  faixas.find((faixa) => toCents(faixa.valorMinimo) > toCents(valor)) || null
);

// Prévia de um valor isolado com a regra de ciclos (mesma regra do backend).
export const cuponsParaValor = (faixas = [], cicloValor = 0, valor = 0) => {
  const ciclo = toCents(cicloValor);
  if (ciclo <= 0) return 0;
  const total = toCents(valor);
  const concluidos = Math.floor(total / ciclo);
  const restante = (total - concluidos * ciclo) / 100;
  return concluidos * (faixas.at(-1)?.cupons || 0) + (faixaParaValor(faixas, restante)?.cupons || 0);
};

export const descreverFaixa = (faixa) => (faixa?.cupons > 0 ? `${formatMoney(faixa.valorMinimo)} · ${faixa.cupons} cupons` : "Sem faixa");

// Link que o distribuidor deve divulgar. Os demais continuam válidos e usam o mesmo saldo.
export const separarLinks = (links = []) => {
  const principal = links.find((link) => link.principal) || links.find((link) => link.status === "ativo") || null;
  return { principal, anteriores: links.filter((link) => link !== principal) };
};

export const formatMoney = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const formatDateBR = (value) => {
  if (!value) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [ano, mes, dia] = value.split("-");
    return `${dia}/${mes}/${ano}`;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
};

export const formatDateTimeBR = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const formatCnpjBR = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 14
    ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : digits;
};

// CPF (11 dígitos) ou CNPJ (14 dígitos), conforme o tamanho.
export const formatDocumentoBR = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return formatCnpjBR(digits);
};

export const formatPhoneBR = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11) return digits.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  if (digits.length === 10) return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  return digits;
};

export const buildParticipacaoLink = (codigo, origin = window.location.origin) => (
  `${origin}/natal-2026/participar/${encodeURIComponent(codigo)}`
);

export const buildWhatsappShareUrl = ({ link, distribuidorNome }) => {
  const texto = `Natal Premiado Atual Pet 2026${distribuidorNome ? ` — ${distribuidorNome}` : ""}\n` +
    `Cadastre aqui os pet shops que compraram produtos Atual Pet:\n${link}`;
  return `https://wa.me/?text=${encodeURIComponent(texto)}`;
};

let configPromise = null;

// A configuração pública muda raramente; uma consulta por carregamento da página basta.
export const carregarConfigNatal = (client) => {
  if (!configPromise) {
    configPromise = client.get(`${NATAL_PUBLIC_BASE}/config`).then((response) => response.data).catch((error) => {
      configPromise = null;
      throw error;
    });
  }
  return configPromise;
};

// Fotos de celular costumam passar de 5 MB; reduzimos para JPEG antes do envio.
export const comprimirImagem = async (file, { maxLado = 2200, qualidade = 0.82, limiteBytes = 1.5 * 1024 * 1024 } = {}) => {
  if (!file?.type?.startsWith("image/") || file.size <= limiteBytes || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", qualidade));
    if (!blob || blob.size >= file.size) return file;
    const nome = (file.name || "comprovante").replace(/\.[^.]+$/, "") || "comprovante";
    return new File([blob], `${nome}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
};

export const COMPROVANTE_TIPOS = Object.freeze(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
