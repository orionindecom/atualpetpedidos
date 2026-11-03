// Configuração única da campanha Natal Premiado Atual Pet 2026.
// Faixas, datas, numeração e limites são lidos somente daqui (backend e,
// via GET /api/public/natal-2026/config, também pela interface).

const parseDate = (value, fallback) => {
  const parsed = new Date(value || fallback);
  return Number.isNaN(parsed.getTime()) ? new Date(fallback) : parsed;
};

// Horário de Brasília (UTC-3, sem horário de verão desde 2019).
const INICIO_OFICIAL = "2026-11-03T00:00:00.000-03:00";
const FIM_CADASTROS_OFICIAL = "2026-12-10T23:59:59.999-03:00";
const SORTEIO_OFICIAL = "2026-12-15T00:00:00.000-03:00";

// Faixas definitivas. Cada pedido é avaliado individualmente, sem acumular pedidos.
// Abaixo de R$ 12.000 o pedido não tem direito a cupons nem bonificações (ver FAIXA_SEM_BENEFICIOS).
export const FAIXAS_NATAL_2026 = Object.freeze([
  Object.freeze({ nivel: 1, valorMinimo: 12000, cupons: 100, marketingPercentual: 3, produtosPercentual: 5 }),
  Object.freeze({ nivel: 2, valorMinimo: 20000, cupons: 200, marketingPercentual: 3, produtosPercentual: 7 }),
  Object.freeze({ nivel: 3, valorMinimo: 30000, cupons: 300, marketingPercentual: 3, produtosPercentual: 10 }),
  Object.freeze({ nivel: 4, valorMinimo: 40000, cupons: 400, marketingPercentual: 3, produtosPercentual: 10 }),
]);

export const FAIXA_SEM_BENEFICIOS = Object.freeze({ nivel: 0, valorMinimo: 0, cupons: 0, marketingPercentual: 0, produtosPercentual: 0 });

export const buildNatalConfig = (env = process.env) => Object.freeze({
  slug: "natal-2026",
  nome: "Natal Premiado Atual Pet 2026",
  premio: "1 Kit Groomer Profissional (1 soprador e 1 secador)",
  // Overrides existem apenas para homologação fora do período oficial.
  inicio: parseDate(env.NATAL2026_INICIO, INICIO_OFICIAL),
  fimCadastros: parseDate(env.NATAL2026_FIM_CADASTROS, FIM_CADASTROS_OFICIAL),
  sorteio: parseDate(env.NATAL2026_SORTEIO, SORTEIO_OFICIAL),
  timeZone: "America/Sao_Paulo",
  faixas: FAIXAS_NATAL_2026,
  numeracao: Object.freeze({
    minimo: Number(env.NATAL2026_CUPOM_MIN || 1),
    maximo: Number(env.NATAL2026_CUPOM_MAX || 99999),
    digitos: Number(env.NATAL2026_CUPOM_DIGITOS || 5),
    tentativas: 60,
  }),
  // Cadastros pendentes aceitos além do saldo disponível do lote (antiabuso).
  folgaFilaPendentes: Number(env.NATAL2026_FOLGA_FILA || 50),
  comprovante: Object.freeze({
    maxBytes: 10 * 1024 * 1024,
    minBytes: 200,
  }),
  // Tempo mínimo entre abrir o formulário e enviar (antirrobô).
  tempoMinimoPreenchimentoMs: 3000,
});

export const NATAL_2026 = buildNatalConfig();
