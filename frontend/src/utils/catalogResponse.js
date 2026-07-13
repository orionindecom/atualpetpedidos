const uniqueSortedStrings = (values) => [
  ...new Set(values.filter((value) => typeof value === "string" && value)),
].sort((a, b) => a.localeCompare(b, "pt-BR"));

const filtersFromProducts = (produtos) => ({
  linhas: uniqueSortedStrings(produtos.map((produto) => produto.linha)),
  categorias: uniqueSortedStrings(
    produtos.map((produto) => produto.categoria)
  ),
});

export const normalizeCatalogResponse = (
  data,
  {
    pagina = 1,
    limite = 12,
    busca = "",
    linha = "",
    categoria = "",
  } = {}
) => {
  if (Array.isArray(data)) {
    const buscaNormalizada = busca.trim().toLocaleLowerCase("pt-BR");
    const produtos = data.filter((produto) => {
      const combinaBusca = buscaNormalizada
        ? String(produto.nome || "")
            .toLocaleLowerCase("pt-BR")
            .includes(buscaNormalizada)
        : true;
      const combinaLinha = linha ? produto.linha === linha : true;
      const combinaCategoria = categoria
        ? produto.categoria === categoria
        : true;

      return combinaBusca && combinaLinha && combinaCategoria;
    });

    return {
      produtos,
      paginacao: {
        pagina: 1,
        limite: produtos.length || limite,
        total: produtos.length,
        totalPaginas: produtos.length > 0 ? 1 : 0,
        temMais: false,
      },
      filtros: filtersFromProducts(data),
    };
  }

  const produtos = Array.isArray(data?.produtos) ? data.produtos : [];
  const respostaPaginacao = data?.paginacao || {};
  const respostaFiltros = data?.filtros || {};
  const filtrosDerivados = filtersFromProducts(produtos);

  return {
    produtos,
    paginacao: {
      pagina: Number(respostaPaginacao.pagina) || pagina,
      limite: Number(respostaPaginacao.limite) || limite,
      total: Number(respostaPaginacao.total) || 0,
      totalPaginas: Number(respostaPaginacao.totalPaginas) || 0,
      temMais: respostaPaginacao.temMais === true,
    },
    filtros: {
      linhas: Array.isArray(respostaFiltros.linhas)
        ? respostaFiltros.linhas
        : filtrosDerivados.linhas,
      categorias: Array.isArray(respostaFiltros.categorias)
        ? respostaFiltros.categorias
        : filtrosDerivados.categorias,
    },
  };
};
