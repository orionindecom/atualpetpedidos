import test from "node:test";
import assert from "node:assert/strict";
import {
  criarPipelineProdutosCatalogo,
  listarCatalogoCliente,
} from "../src/controllers/catalogoController.js";
import PrecoProduto from "../src/models/PrecoProduto.js";
import TabelaPreco from "../src/models/TabelaPreco.js";
import {
  compararProdutosCatalogo,
  prioridadeCategoriaCatalogo,
} from "../src/utils/catalogOrdering.js";

test("aplica a prioridade comercial das categorias normalizadas", () => {
  assert.equal(prioridadeCategoriaCatalogo("Shampoo"), 1);
  assert.equal(prioridadeCategoriaCatalogo("shampo"), 1);
  assert.equal(prioridadeCategoriaCatalogo("CONDICIONADOR"), 2);
  assert.equal(prioridadeCategoriaCatalogo("Máscara"), 3);
  assert.equal(prioridadeCategoriaCatalogo("Mascara"), 3);
  assert.equal(prioridadeCategoriaCatalogo("MÁSCARA"), 3);
  assert.equal(prioridadeCategoriaCatalogo("Colônia"), 4);
  assert.equal(prioridadeCategoriaCatalogo("colonia"), 4);
  assert.equal(prioridadeCategoriaCatalogo("COLÔNIA"), 4);
  assert.equal(prioridadeCategoriaCatalogo("Cuidados Especiais"), 5);
  assert.equal(prioridadeCategoriaCatalogo("cuidados_especiais"), 5);
  assert.equal(prioridadeCategoriaCatalogo("Outra"), 99);
});

test("primeira pagina filtrada inicia por shampoos e preserva a sequencia", () => {
  const produtos = [
    { id: "6", linha: "The Luxe", categoria: "Cuidados Especiais", nome: "Finalizador" },
    { id: "4", linha: "The Luxe", categoria: "Colônia", nome: "Colônia Romã" },
    { id: "3", linha: "The Luxe", categoria: "Máscara", nome: "Máscara Melancia" },
    { id: "2", linha: "The Luxe", categoria: "Condicionador", nome: "Condicionador Melancia" },
    { id: "1b", linha: "The Luxe", categoria: "shampo", nome: "Shampoo Neutro" },
    { id: "1a", linha: "The Luxe", categoria: "Shampoo", nome: "Shampoo Cereja" },
  ].sort((a, b) =>
    compararProdutosCatalogo(a, b, { ordenarPorLinha: false })
  );

  assert.deepEqual(
    produtos.map(({ categoria }) => prioridadeCategoriaCatalogo(categoria)),
    [1, 1, 2, 3, 4, 5]
  );
  assert.deepEqual(
    produtos.slice(0, 2).map(({ nome }) => nome),
    ["Shampoo Cereja", "Shampoo Neutro"]
  );
});

test("ordena por linha, nome normalizado e id deterministico", () => {
  const produtos = [
    { id: "z", linha: "Zoom", categoria: "Shampoo", nome: "Shampoo Zoom" },
    { id: "t", linha: "The Luxe", categoria: "Shampoo", nome: "Shampoo Luxe" },
    { id: "d", linha: "dream color", categoria: "Shampoo", nome: "Shampoo Dream" },
    { id: "b", linha: "Zoom", categoria: "Colônia", nome: "Água Fresca" },
    { id: "a", linha: "Zoom", categoria: "Colonia", nome: "Água Fresca" },
  ].sort(compararProdutosCatalogo);

  assert.deepEqual(
    produtos.map(({ id }) => id),
    ["d", "t", "z", "a", "b"]
  );
});

test("campos nulos ou ausentes nao quebram a ordenacao", () => {
  const produtos = [
    { _id: "2", categoria: null, linha: null, nome: null },
    { _id: "1" },
    { _id: "3", categoria: "Shampoo", linha: "Zoom", nome: "Neutro" },
  ];

  assert.doesNotThrow(() => produtos.sort(compararProdutosCatalogo));
  assert.equal(produtos.length, 3);
});

test("pipeline usa fallback seguro antes de normalizar strings", () => {
  const pipeline = criarPipelineProdutosCatalogo({
    filtroProduto: {},
    legacy: false,
    inicio: 0,
    limite: 12,
    ordenarPorLinha: true,
  });
  const campos = pipeline.find(
    (estagio) => estagio.$addFields?.catalogoCategoriaNormalizada
  ).$addFields;

  assert.deepEqual(campos.catalogoCategoriaNormalizada, {
    $toLower: {
      $trim: {
        input: { $ifNull: ["$produto.categoria", ""] },
      },
    },
  });
  assert.deepEqual(campos.catalogoLinhaOrdem.$toLower.$trim.input.$ifNull, [
    "$produto.linha",
    "",
  ]);
  assert.deepEqual(campos.catalogoNomeOrdem.$toLower.$trim.input.$ifNull, [
    "$produto.nome",
    "",
  ]);
  assert.equal(JSON.stringify(pipeline).includes("$replaceAll"), false);
});

test("pipeline paginado sem filtros usa pagina inicial valida", () => {
  const pipeline = criarPipelineProdutosCatalogo({
    filtroProduto: {},
    legacy: false,
    inicio: 0,
    limite: 12,
    ordenarPorLinha: true,
  });

  assert.deepEqual(pipeline[0], { $match: {} });
  assert.equal(pipeline.find((estagio) => "$skip" in estagio).$skip, 0);
  assert.equal(pipeline.find((estagio) => "$limit" in estagio).$limit, 12);
});

test("pipeline ordena todo o resultado antes de aplicar skip e limit", () => {
  const pipeline = criarPipelineProdutosCatalogo({
    filtroProduto: { "produto.linha": "The Luxe" },
    legacy: false,
    inicio: 12,
    limite: 12,
    ordenarPorLinha: false,
  });
  const indiceSort = pipeline.findIndex((estagio) => estagio.$sort);
  const indiceSkip = pipeline.findIndex((estagio) => "$skip" in estagio);
  const indiceLimit = pipeline.findIndex((estagio) => "$limit" in estagio);
  const indiceProject = pipeline.findIndex((estagio) => estagio.$project);

  assert.deepEqual(pipeline[0], {
    $match: { "produto.linha": "The Luxe" },
  });
  assert.ok(indiceSort > 0);
  assert.ok(indiceSort < indiceSkip);
  assert.ok(indiceSkip < indiceLimit);
  assert.ok(indiceLimit < indiceProject);
  assert.deepEqual(pipeline[indiceSort].$sort, {
    catalogoCategoriaOrdem: 1,
    catalogoNomeOrdem: 1,
    "produto._id": 1,
  });
});

test("pipeline legado mantem ordenacao completa sem paginacao", () => {
  const pipeline = criarPipelineProdutosCatalogo({
    filtroProduto: {},
    legacy: true,
    inicio: 0,
    limite: 12,
    ordenarPorLinha: true,
  });
  const ordenacao = pipeline.find((estagio) => estagio.$sort).$sort;

  assert.equal(pipeline.some((estagio) => "$skip" in estagio), false);
  assert.equal(pipeline.some((estagio) => "$limit" in estagio), false);
  assert.equal(ordenacao.catalogoLinhaOrdem, 1);
  assert.equal(ordenacao.catalogoCategoriaOrdem, 1);
  assert.equal(ordenacao.catalogoNomeOrdem, 1);
  assert.equal(ordenacao["produto._id"], 1);
});

test("endpoint paginado e legado respondem sem erro interno", { concurrency: false }, async () => {
  const aggregateOriginal = PrecoProduto.aggregate;
  const findByIdOriginal = TabelaPreco.findById;

  PrecoProduto.aggregate = () => ({
    option: async () => [
      {
        produtos: [
          {
            id: "produto-1",
            nome: null,
            linha: null,
            categoria: null,
            preco: 10,
          },
        ],
        total: [{ quantidade: 1 }],
        linhas: [],
        categorias: [],
      },
    ],
  });
  TabelaPreco.findById = () => {
    const consulta = {
      select: () => consulta,
      lean: () => consulta,
      maxTimeMS: async () => ({ nome: "Tabela Teste" }),
    };

    return consulta;
  };

  const executar = async (query) => {
    const resposta = {
      statusCode: null,
      body: null,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };

    await listarCatalogoCliente(
      {
        query,
        usuario: { tabelaPrecoId: "tabela-1" },
      },
      resposta
    );

    return resposta;
  };

  try {
    const paginada = await executar({ pagina: "1", limite: "12" });
    const filtrada = await executar({
      pagina: "1",
      limite: "12",
      linha: "The Luxe",
    });
    const legada = await executar({});

    assert.equal(paginada.statusCode, 200);
    assert.equal(Array.isArray(paginada.body.produtos), true);
    assert.equal(filtrada.statusCode, 200);
    assert.equal(Array.isArray(filtrada.body.produtos), true);
    assert.equal(legada.statusCode, 200);
    assert.equal(Array.isArray(legada.body), true);
  } finally {
    PrecoProduto.aggregate = aggregateOriginal;
    TabelaPreco.findById = findByIdOriginal;
  }
});
