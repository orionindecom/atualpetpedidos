import { FAIXA_SEM_BENEFICIOS, NATAL_2026 } from "../config/natalPremiado2026.js";
import { beneficiosDaFaixa } from "./natalCampanha.js";

// Regras puras do modelo cumulativo por distribuidor (sem acesso a banco).
// Todos os cálculos usam centavos inteiros: o estado depende somente do total
// comprado, por isso recalcular o mesmo conjunto de compras dá sempre o mesmo resultado.

export const paraCentavos = (valor) => Math.round(Number(valor || 0) * 100);
export const paraReais = (centavos) => Math.round(Number(centavos || 0)) / 100;

const faixaDoCiclo = (acumuladoCentavos, faixas) => {
  let resultado = null;
  for (const faixa of faixas) {
    if (acumuladoCentavos >= paraCentavos(faixa.valorMinimo)) resultado = faixa;
  }
  return beneficiosDaFaixa(resultado || FAIXA_SEM_BENEFICIOS);
};

const percentualDe = (centavos, percentual) => Math.round((centavos * percentual) / 100);

const resumirCiclo = (numero, acumuladoCentavos, cicloCentavos, faixas) => {
  const faixa = faixaDoCiclo(acumuladoCentavos, faixas);
  return {
    numero,
    acumuladoCentavos,
    concluido: acumuladoCentavos >= cicloCentavos,
    faixa,
    cupons: faixa.cupons,
    produtos: { percentual: faixa.produtosPercentual, devidoCentavos: percentualDe(acumuladoCentavos, faixa.produtosPercentual) },
    marketing: { percentual: faixa.marketingPercentual, devidoCentavos: percentualDe(acumuladoCentavos, faixa.marketingPercentual) },
  };
};

// Situação do distribuidor para um total comprado. Ciclos sucessivos, sem limite:
// o excedente de um ciclo abre o seguinte, inclusive dentro do mesmo pedido.
export const calcularEstadoCumulativo = (totalCentavos, config = NATAL_2026) => {
  const total = Math.max(Math.round(Number(totalCentavos || 0)), 0);
  const cicloCentavos = paraCentavos(config.cicloValor);
  const ciclosConcluidos = Math.floor(total / cicloCentavos);
  const acumuladoCiclo = total - ciclosConcluidos * cicloCentavos;

  const ciclos = [];
  for (let numero = 1; numero <= ciclosConcluidos; numero += 1) {
    ciclos.push(resumirCiclo(numero, cicloCentavos, cicloCentavos, config.faixas));
  }
  if (acumuladoCiclo > 0) ciclos.push(resumirCiclo(ciclosConcluidos + 1, acumuladoCiclo, cicloCentavos, config.faixas));

  const somar = (selecionar) => ciclos.reduce((soma, ciclo) => soma + selecionar(ciclo), 0);
  const proxima = config.faixas.find((faixa) => paraCentavos(faixa.valorMinimo) > acumuladoCiclo) || null;

  return {
    totalCentavos: total,
    ciclosConcluidos,
    cicloAtual: ciclosConcluidos + 1,
    acumuladoCicloCentavos: acumuladoCiclo,
    faixaAtual: faixaDoCiclo(acumuladoCiclo, config.faixas),
    proximaFaixa: beneficiosDaFaixa(proxima),
    restanteProximaFaixaCentavos: proxima ? paraCentavos(proxima.valorMinimo) - acumuladoCiclo : 0,
    cuponsDevidos: somar((ciclo) => ciclo.cupons),
    produtosDevidoCentavos: somar((ciclo) => ciclo.produtos.devidoCentavos),
    marketingDevidoCentavos: somar((ciclo) => ciclo.marketing.devidoCentavos),
    ciclos,
  };
};

// Mostra em quais ciclos caiu o valor de cada compra, na ordem contábil. Só informa
// a origem dos valores: o total e os benefícios não dependem desta ordem.
export const alocarComprasNosCiclos = (compras = [], config = NATAL_2026) => {
  const cicloCentavos = paraCentavos(config.cicloValor);
  const ordenadas = [...compras].sort((a, b) => (
    new Date(a.data).getTime() - new Date(b.data).getTime() || String(a.id).localeCompare(String(b.id))
  ));
  let acumulado = 0;
  return ordenadas.map((compra) => {
    let restante = compra.valorCentavos;
    const ciclos = [];
    while (restante > 0) {
      const ciclo = Math.floor(acumulado / cicloCentavos) + 1;
      const parte = Math.min(restante, ciclo * cicloCentavos - acumulado);
      ciclos.push({ ciclo, valorCentavos: parte });
      acumulado += parte;
      restante -= parte;
    }
    return { ...compra, ciclos };
  });
};
