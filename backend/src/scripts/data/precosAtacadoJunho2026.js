import {
  produtosDistribuidorEspecializadoJunho2026,
  produtosPromocionaisIgnorados,
} from "./distribuidorEspecializadoJunho2026.js";

export const origemPrecosAtacado = Object.freeze({
  arquivo: "07.2026 - DISTRIBUIDOR ATACADISTA.pdf",
  referenciaTabela: "06/2026",
  colunaPreco: "VALOR UNITARIO",
  linhasPrecoExtraidas: 158,
  registrosImportaveis: 149,
  promocionaisIgnorados: 9,
});

const PRECOS_POR_LINHA = Object.freeze({
  "DREAM COLOR LINE - SUPER PREMIUM": Object.freeze([
    173.31, 148.35, 120.61, 120.61, 120.61, 120.61, 36.05, 36.05,
    36.05, 54.07, 54.07, 54.07, 54.07, 54.07, 54.07, 180.93, 180.93,
    180.93, 180.93, 180.93, 180.93, 60.56, 60.56, 60.56, 60.56,
    60.56, 60.56, 62.89, 51.75, 51.75, 51.75, 51.75, 253, 230,
    178.25, 178.25, 178.25, 178.25, 178.25, 178.25, 84.23, 81.16,
    58.23, 58.23, 58.23, 58.23, 58.23, 58.23,
  ]),
  "DREAM COLOR LINE CARE": Object.freeze([109.65, 73.1, 76.04, 64.28]),
  "THE LUXE PREMIUM": Object.freeze([
    85.54, 85.54, 84.61, 80.29, 80.29, 80.29, 80.29, 56.93, 83.98,
    170.15, 170.15, 170.15, 170.15, 80.5, 80.5, 80.5, 80.5, 92, 92,
    92, 92, 13.86, 31.19, 39.86, 32.74, 13.86, 71.3, 79.41, 79.41,
    79.41, 79.41, 79.41, 62.39, 62.39, 62.39, 62.39, 62.39, 62.39,
    62.39, 62.39, 62.39, 62.39,
  ]),
  "VANITY PET": Object.freeze([
    34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34,
    34, 34, 34, 96, 96, 96, 96, 96, 96, 96, 96, 96, 96, 96, 96, 96,
    96, 96, 96, 96, 96, 96, 560,
  ]),
  ZOOM: Object.freeze([
    39.93, 39.93, 39.93, 39.93, 39.93, 39.93, 40.33, 41.59, 6.1,
    6.1, 6.1, 6.1, 6.1, 7.14, 7.18, 6.35,
  ]),
});

const PRECO_PROMOCIONAIS = Object.freeze([
  6.43, 5.12, 2.77, 38.11, 91.99, 91.99, 91.99, 91.99, 9.56,
]);

const selecionarIdentidade = (registro) => ({
  nomeBase: registro.nomeBase,
  diluicao: registro.diluicao,
  embalagem: registro.embalagem,
  linhaOrigem: registro.linhaOrigem,
});

const ajustarIdentidadeDoPdfAtacado = (registro, indiceNaLinha) => {
  if (registro.linhaOrigem === "DREAM COLOR LINE - SUPER PREMIUM") {
    const shampoosUmLitro = [
      "SHAMPOO DREAM COLOR TANGERINA CITRUS",
      "SHAMPOO DREAM COLOR ALECRIM DO CAMPO",
      "SHAMPOO DREAM COLOR TUTTI-FRUTTI",
    ];

    if (indiceNaLinha >= 6 && indiceNaLinha <= 8) {
      return {
        ...selecionarIdentidade(registro),
        nomeBase: shampoosUmLitro[indiceNaLinha - 6],
      };
    }
  }

  if (
    registro.linhaOrigem === "DREAM COLOR LINE CARE" &&
    indiceNaLinha === 2
  ) {
    return {
      ...selecionarIdentidade(registro),
      nomeBase: "SHAMPOO DE VOLUME DREAM COLOR LINE CARE POWER PUFF",
    };
  }

  return selecionarIdentidade(registro);
};

const montarRegistrosDaLinha = (linhaOrigem, precos) => {
  const registros = produtosDistribuidorEspecializadoJunho2026.filter(
    (registro) => registro.linhaOrigem === linhaOrigem
  );

  if (registros.length !== precos.length) {
    throw new Error(
      `Dataset Atacado inconsistente em ${linhaOrigem}: ` +
        `${registros.length} identidades e ${precos.length} precos`
    );
  }

  return registros.map((registro, indice) =>
    Object.freeze({
      ...ajustarIdentidadeDoPdfAtacado(registro, indice),
      valorAtacado: precos[indice],
    })
  );
};

export const produtosAtacadoJunho2026 = Object.freeze(
  Object.entries(PRECOS_POR_LINHA).flatMap(([linhaOrigem, precos]) =>
    montarRegistrosDaLinha(linhaOrigem, precos)
  )
);

if (produtosPromocionaisIgnorados.length !== PRECO_PROMOCIONAIS.length) {
  throw new Error("Dataset Atacado inconsistente nos itens promocionais");
}

export const promocionaisAtacadoIgnorados = Object.freeze(
  produtosPromocionaisIgnorados.map((registro, indice) =>
    Object.freeze({
      ...selecionarIdentidade({ ...registro, diluicao: null, linhaOrigem: null }),
      valorAtacado: PRECO_PROMOCIONAIS[indice],
    })
  )
);
