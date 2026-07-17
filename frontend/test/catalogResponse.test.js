import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCatalogResponse } from "../src/utils/catalogResponse.js";
import {
  acrescentarProdutosCatalogo,
  criarEstadoCatalogoParaNovoFiltro,
  substituirProdutosCatalogo,
} from "../src/utils/catalogPagination.js";

test("normaliza a resposta legada em array", () => {
  const data = [
    { id: "1", linha: "Zoom", categoria: "Shampoo" },
    { id: "2", linha: "Zoom", categoria: "Perfume" },
  ];

  const result = normalizeCatalogResponse(data, { pagina: 1, limite: 12 });

  assert.deepEqual(result.produtos, data);
  assert.equal(result.paginacao.temMais, false);
  assert.equal(result.paginacao.total, 2);
  assert.deepEqual(result.filtros.linhas, ["Zoom"]);
  assert.deepEqual(result.filtros.categorias, ["Perfume", "Shampoo"]);
});

test("preserva a resposta paginada", () => {
  const data = {
    produtos: [{ id: "1" }],
    paginacao: {
      pagina: 2,
      limite: 12,
      total: 20,
      totalPaginas: 2,
      temMais: false,
    },
    filtros: { linhas: ["Zoom"], categorias: ["Shampoo"] },
  };

  assert.deepEqual(normalizeCatalogResponse(data), data);
});

test("aplica busca e filtros ao array legado", () => {
  const data = [
    { id: "1", nome: "Shampoo Neutro", linha: "Zoom", categoria: "Shampoo" },
    { id: "2", nome: "Perfume", linha: "Luxe", categoria: "Perfume" },
  ];

  const result = normalizeCatalogResponse(data, {
    busca: "shampoo",
    linha: "Zoom",
    categoria: "Shampoo",
  });

  assert.deepEqual(result.produtos, [data[0]]);
  assert.equal(result.paginacao.total, 1);
  assert.deepEqual(result.filtros.linhas, ["Luxe", "Zoom"]);
});

test("usa valores seguros quando o objeto estiver incompleto", () => {
  const result = normalizeCatalogResponse({ produtos: [] });

  assert.deepEqual(result.produtos, []);
  assert.equal(result.paginacao.pagina, 1);
  assert.equal(result.paginacao.temMais, false);
  assert.deepEqual(result.filtros, { linhas: [], categorias: [] });
});

test("trocar filtro reinicia a pagina e limpa os produtos anteriores", () => {
  const estado = criarEstadoCatalogoParaNovoFiltro();

  assert.deepEqual(estado.produtos, []);
  assert.deepEqual(estado.paginacao, {
    pagina: 1,
    temMais: false,
    total: 0,
  });
});

test("resposta da pagina 1 substitui a lista antiga", () => {
  const antigos = [{ id: "luxe-1" }];
  const novos = [{ id: "dream-1" }];
  const resultado = substituirProdutosCatalogo(novos);

  assert.deepEqual(resultado, novos);
  assert.notEqual(resultado, novos);
  assert.equal(resultado.includes(antigos[0]), false);
});

test("mostrar mais acrescenta a pagina seguinte sem reordenar", () => {
  const primeiraPagina = [
    { id: "1", categoria: "Shampoo" },
    { id: "2", categoria: "Shampoo" },
  ];
  const segundaPagina = [
    { id: "3", categoria: "Condicionador" },
    { id: "4", categoria: "Máscara" },
  ];

  assert.deepEqual(
    acrescentarProdutosCatalogo(primeiraPagina, segundaPagina),
    [...primeiraPagina, ...segundaPagina]
  );
});
