export const criarPaginacaoCatalogoInicial = () => ({
  pagina: 1,
  temMais: false,
  total: 0,
});

export const criarEstadoCatalogoParaNovoFiltro = () => ({
  produtos: [],
  paginacao: criarPaginacaoCatalogoInicial(),
});

export const substituirProdutosCatalogo = (novosProdutos) => [
  ...novosProdutos,
];

export const acrescentarProdutosCatalogo = (produtosAtuais, novosProdutos) => {
  const produtosPorId = new Map(
    produtosAtuais.map((produto) => [produto.id, produto])
  );

  novosProdutos.forEach((produto) => produtosPorId.set(produto.id, produto));
  return [...produtosPorId.values()];
};
