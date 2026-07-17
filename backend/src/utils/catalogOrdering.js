const CATEGORIAS_ORDENADAS = [
  { prioridade: 1, aliases: ["shampoo", "shampo"] },
  { prioridade: 2, aliases: ["condicionador"] },
  { prioridade: 3, aliases: ["mascara", "máscara"] },
  { prioridade: 4, aliases: ["colonia", "colônia", "perfume"] },
  { prioridade: 5, aliases: ["cuidados especiais", "cuidados_especiais"] },
];

export const normalizarTextoCatalogo = (valor = "") =>
  String(valor)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");

export const prioridadeCategoriaCatalogo = (categoria) => {
  const categoriaNormalizada = normalizarTextoCatalogo(categoria);
  const grupo = CATEGORIAS_ORDENADAS.find(({ aliases }) =>
    aliases.includes(categoriaNormalizada)
  );

  return grupo?.prioridade ?? 99;
};

const compararTexto = (a, b) =>
  normalizarTextoCatalogo(a).localeCompare(
    normalizarTextoCatalogo(b),
    "pt-BR"
  );

export const compararProdutosCatalogo = (
  produtoA,
  produtoB,
  { ordenarPorLinha = true } = {}
) => {
  if (ordenarPorLinha) {
    const ordemLinha = compararTexto(produtoA.linha, produtoB.linha);

    if (ordemLinha !== 0) {
      return ordemLinha;
    }
  }

  const ordemCategoria =
    prioridadeCategoriaCatalogo(produtoA.categoria) -
    prioridadeCategoriaCatalogo(produtoB.categoria);

  if (ordemCategoria !== 0) {
    return ordemCategoria;
  }

  const ordemNome = compararTexto(produtoA.nome, produtoB.nome);

  if (ordemNome !== 0) {
    return ordemNome;
  }

  return String(produtoA._id || produtoA.id || "").localeCompare(
    String(produtoB._id || produtoB.id || "")
  );
};

const criarExpressaoTextoNormalizado = (campo) => {
  return {
    $toLower: {
      $trim: {
        input: { $ifNull: [campo, ""] },
      },
    },
  };
};

export const criarEstagiosOrdenacaoCatalogo = ({
  ordenarPorLinha = true,
} = {}) => [
  {
    $addFields: {
      catalogoLinhaOrdem: criarExpressaoTextoNormalizado("$produto.linha"),
      catalogoCategoriaNormalizada: criarExpressaoTextoNormalizado(
        "$produto.categoria"
      ),
      catalogoNomeOrdem: criarExpressaoTextoNormalizado("$produto.nome"),
    },
  },
  {
    $addFields: {
      catalogoCategoriaOrdem: {
        $switch: {
          branches: CATEGORIAS_ORDENADAS.map(({ prioridade, aliases }) => ({
            case: { $in: ["$catalogoCategoriaNormalizada", aliases] },
            then: prioridade,
          })),
          default: 99,
        },
      },
    },
  },
  {
    $sort: {
      ...(ordenarPorLinha ? { catalogoLinhaOrdem: 1 } : {}),
      catalogoCategoriaOrdem: 1,
      catalogoNomeOrdem: 1,
      "produto._id": 1,
    },
  },
];
