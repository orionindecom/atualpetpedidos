import test from "node:test";
import assert from "node:assert/strict";
import {
  produtosDistribuidorEspecializadoJunho2026 as dados,
  produtosPromocionaisIgnorados as promocionais,
} from "../src/scripts/data/distribuidorEspecializadoJunho2026.js";
import {
  criarRelatorioImportacao,
  localizarCorrespondencias,
  planejarImportacao,
  resolverCategoriaProdutoNovo,
  resolverLinhas,
  validarDadosImportacao,
} from "../src/scripts/importarDistribuidorEspecializado.js";

const tabelasTeste = {
  distribuidor: { _id: "tabela-distribuidor" },
  cliente_final_loja: { _id: "tabela-loja" },
  cliente_final_internet: { _id: "tabela-internet" },
};

test("dataset possui os 149 produtos e 9 promocionais esperados", () => {
  assert.equal(dados.length, 149);
  assert.equal(promocionais.length, 9);
  assert.deepEqual(validarDadosImportacao(dados), []);
  assert.equal(dados.some((item) => Object.hasOwn(item, "pack")), false);
});

test("dataset preserva a quantidade conferida em cada secao do PDF", () => {
  const contagens = Object.fromEntries(
    [...new Set(dados.map((item) => item.linhaOrigem))].map((linha) => [
      linha,
      dados.filter((item) => item.linhaOrigem === linha).length,
    ])
  );

  assert.deepEqual(contagens, {
    "DREAM COLOR LINE - SUPER PREMIUM": 48,
    "DREAM COLOR LINE CARE": 4,
    "THE LUXE PREMIUM": 42,
    "VANITY PET": 39,
    ZOOM: 16,
  });
});

test("valores de linhas sensiveis permanecem nas colunas corretas", () => {
  const localizar = (nomeBase, embalagem, diluicao = null) =>
    dados.find(
      (item) =>
        item.nomeBase === nomeBase &&
        item.embalagem === embalagem &&
        item.diluicao === diluicao
    );

  assert.deepEqual(
    localizar("DISPLAY PERFUME VANITY ULTRA PREMIUM", "50ML"),
    {
      nomeBase: "DISPLAY PERFUME VANITY ULTRA PREMIUM",
      diluicao: null,
      embalagem: "50ML",
      linhaOrigem: "VANITY PET",
      distribuidor: 560,
      clienteFinalLoja: 1240,
      clienteFinalInternet: 1700,
    }
  );
  assert.equal(
    localizar("SHAMPOO THE LUXE NEUTRO", "5L", "1:5")
      .clienteFinalInternet,
    201.97
  );
  assert.equal(
    localizar("CONDICIONADOR ZOOM", "750ML").clienteFinalInternet,
    19
  );
});

test("correspondencia normaliza unidade e preserva diluicao", () => {
  const registro = dados.find(
    (item) =>
      item.nomeBase === "SHAMPOO DREAM COLOR PRÉ-LAVAGEM" &&
      item.diluicao === "1:5"
  );
  const produtos = [
    {
      nome: "Shampoo Dream Color Pre-Lavagem 1:5 5 L",
      linha: "Dream Color",
    },
    {
      nome: "Shampoo Dream Color Pré-Lavagem 1:12 5L",
      linha: "Dream Color",
    },
  ];

  const correspondencias = localizarCorrespondencias(
    produtos,
    registro,
    "Dream Color"
  );

  assert.equal(correspondencias.exatas.length, 1);
  assert.equal(correspondencias.exatas[0], produtos[0]);
});

test("correspondencia incompleta e tratada como ambigua", () => {
  const registro = dados.find(
    (item) =>
      item.nomeBase === "PERFUME VANITY ULTRA PREMIUM BABY" &&
      item.embalagem === "50ML"
  );
  const produtoSemEmbalagem = {
    nome: "Perfume Vanity Ultra Premium Baby",
    linha: "Vanity Pet",
  };

  const correspondencias = localizarCorrespondencias(
    [produtoSemEmbalagem],
    registro,
    "Vanity Pet"
  );

  assert.deepEqual(correspondencias.exatas, []);
  assert.deepEqual(correspondencias.possiveis, [produtoSemEmbalagem]);
});

test("Dream Color Pre-Lavagem nao aceita fragrancia e diluicao diferentes", () => {
  const registro = dados.find(
    (item) =>
      item.nomeBase === "SHAMPOO DREAM COLOR PRÉ-LAVAGEM" &&
      item.diluicao === "1:5" &&
      item.embalagem === "5L"
  );
  const cocoMenta = {
    nome: "Shampoo Dream Color Pré-Lavagem Coco & Menta1:12 5L",
    linha: "Dream Color",
  };

  const correspondencias = localizarCorrespondencias(
    [cocoMenta],
    registro,
    "Dream Color"
  );

  assert.deepEqual(correspondencias, { exatas: [], possiveis: [] });
});

test("alias limitado reutiliza Zoom Pre-Lavagem sem diluicao no nome", () => {
  const registro = dados.find(
    (item) =>
      item.nomeBase === "SHAMPOO ZOOM PRÉ-LAVAGEM" &&
      item.diluicao === "1:4" &&
      item.embalagem === "5L"
  );
  const produto = {
    nome: "Shampoo Zoom Pré Lavagem 5L",
    linha: "Zoom",
    categoria: "Shampoo",
  };

  const correspondencias = localizarCorrespondencias(
    [produto],
    registro,
    "Zoom"
  );

  assert.deepEqual(correspondencias.exatas, [produto]);
  assert.deepEqual(correspondencias.possiveis, []);
});

test("produto The Luxe e localizado pelo bloco mesmo com nome sem linha literal", () => {
  const registro = dados.find(
    (item) =>
      item.nomeBase === "CONDICIONADOR CEREJA & AVELÃ" &&
      item.embalagem === "5L"
  );
  const produto = {
    nome: "Condicionador The Luxe Cereja & Avelã 1:5 5L",
    linha: "the luxe",
  };

  const correspondencias = localizarCorrespondencias(
    [produto],
    registro,
    "The Luxe"
  );

  assert.deepEqual(correspondencias.exatas, [produto]);
  assert.deepEqual(correspondencias.possiveis, []);
});

test("aromatizador e spray usam somente Cuidados Especiais existente", () => {
  const produtos = [
    {
      nome: "Produto de cuidados existente",
      linha: "Dream Color",
      categoria: "Cuidados Especiais",
    },
  ];
  const aromatizador = dados.find((item) =>
    item.nomeBase.startsWith("AROMATIZADOR DREAM COLOR")
  );
  const spray = dados.find((item) => item.nomeBase.startsWith("SPRAY DE VOLUME"));

  assert.equal(
    resolverCategoriaProdutoNovo(aromatizador, produtos).categoria,
    "Cuidados Especiais"
  );
  assert.equal(
    resolverCategoriaProdutoNovo(spray, produtos).categoria,
    "Cuidados Especiais"
  );
});

test("Perfume e Display reutilizam a categoria existente Colonia", () => {
  const produtos = [
    {
      nome: "Colônia existente",
      linha: "The Luxe",
      categoria: "Colônia",
    },
  ];
  const perfume = dados.find((item) =>
    item.nomeBase.startsWith("PERFUME VANITY ULTRA PREMIUM")
  );
  const display = dados.find((item) => item.nomeBase.startsWith("DISPLAY PERFUME"));

  assert.equal(
    resolverCategoriaProdutoNovo(perfume, produtos).categoria,
    "Colônia"
  );
  assert.equal(
    resolverCategoriaProdutoNovo(display, produtos).categoria,
    "Colônia"
  );

  const ausente = resolverCategoriaProdutoNovo(perfume, [
    { nome: "Shampoo", categoria: "Shampoo" },
  ]);
  assert.equal(ausente.categoria, null);
  assert.match(ausente.mensagem, /não encontrada no banco/);
});

test("The Luxe normaliza acentos, especiais e E versus ampersand", () => {
  const registro = dados.find(
    (item) =>
      item.nomeBase === "COLÔNIA LICHIA & ROMÃ" &&
      item.embalagem === "500ML"
  );
  const produto = {
    nome: "Colonia The Luxe Lichia e Roma 500ml",
    linha: "THE LUXE",
  };

  const correspondencias = localizarCorrespondencias(
    [produto],
    registro,
    "The Luxe"
  );

  assert.deepEqual(correspondencias.exatas, [produto]);
  assert.deepEqual(correspondencias.possiveis, []);
});

test("desempate The Luxe prefere candidata com diluicao explicita igual", () => {
  const registro = dados.find(
    (item) =>
      item.nomeBase === "CONDICIONADOR MELANCIA" &&
      item.diluicao === "1:5" &&
      item.embalagem === "5L"
  );
  const correta = {
    _id: "condicionador-correto",
    nome: "Condicionador The Luxe Melancia 1:5 5L",
    linha: "The Luxe",
    categoria: "Condicionador",
  };
  const semDiluicao = {
    _id: "condicionador-sem-diluicao",
    nome: "Condicionador The Luxe - Melancia 5L",
    linha: "The Luxe",
    categoria: "Condicionador",
  };

  const correspondencias = localizarCorrespondencias(
    [semDiluicao, correta],
    registro,
    "The Luxe"
  );

  assert.deepEqual(correspondencias.exatas, [correta]);
  assert.equal(correspondencias.resolucaoAutomatica.produto, correta);
});

test("produto comum planejado como novo nao aparece como nao encontrado", () => {
  const registro = dados.find(
    (item) =>
      item.nomeBase === "SHAMPOO DREAM COLOR PRÉ-LAVAGEM" &&
      item.diluicao === "1:5" &&
      item.embalagem === "5L"
  );
  const produtos = [
    {
      _id: "produto-categoria",
      nome: "Shampoo Dream Color Existente 1L",
      linha: "Dream Color",
      categoria: "Shampoo",
    },
  ];
  const relatorio = criarRelatorioImportacao("SIMULACAO", [registro]);
  const plano = planejarImportacao({
    produtos,
    precos: [],
    tabelas: tabelasTeste,
    relatorio,
    registros: [registro],
  });

  assert.equal(plano.length, 1);
  assert.equal(plano[0].produtoNovo.nome.includes("PRÉ-LAVAGEM 1:5 5L"), true);
  assert.equal(relatorio.produtosNovosPlanejados, 1);
  assert.deepEqual(relatorio.produtosNaoEncontrados, []);
});

test("The Luxe e ignorado antes de consultar produtos ou precos", () => {
  const registro = dados.find(
    (item) =>
      item.nomeBase === "CONDICIONADOR CEREJA & AVELÃ" &&
      item.embalagem === "5L"
  );
  const acessoProibido = new Proxy([], {
    get() {
      throw new Error("The Luxe nao deve consultar esta colecao");
    },
  });
  const relatorio = criarRelatorioImportacao("SIMULACAO", [registro]);
  const plano = planejarImportacao({
    produtos: acessoProibido,
    precos: acessoProibido,
    tabelas: tabelasTeste,
    relatorio,
    registros: [registro],
  });

  assert.deepEqual(plano, []);
  assert.equal(relatorio.produtosEfetivamenteProcessados, 0);
  assert.equal(relatorio.produtosTheLuxeIgnorados.length, 1);
  assert.equal(relatorio.produtosExistentesReutilizados, 0);
  assert.equal(relatorio.produtosNovosPlanejados, 0);
  assert.deepEqual(relatorio.produtosNaoEncontrados, []);
  assert.deepEqual(relatorio.correspondenciasAmbiguas, []);
  assert.deepEqual(relatorio.ambiguidadesResolvidasAutomaticamente, []);

  for (const precos of Object.values(relatorio.precos)) {
    assert.deepEqual(precos, {
      criar: 0,
      atualizar: 0,
      inalterado: 0,
      efetivadosCriar: 0,
      efetivadosAtualizar: 0,
    });
  }
});

test("contagens separam os 42 The Luxe dos 107 produtos processaveis", () => {
  const relatorio = criarRelatorioImportacao("SIMULACAO", dados);
  const plano = planejarImportacao({
    produtos: [],
    precos: [],
    tabelas: tabelasTeste,
    relatorio,
    registros: dados,
  });
  const nomesIgnorados = new Set(relatorio.produtosTheLuxeIgnorados);

  assert.equal(relatorio.produtosAnalisados, 149);
  assert.equal(relatorio.produtosTheLuxeIgnorados.length, 42);
  assert.equal(relatorio.produtosEfetivamenteProcessados, 107);
  assert.equal(
    relatorio.produtosEfetivamenteProcessados +
      relatorio.produtosTheLuxeIgnorados.length,
    relatorio.produtosAnalisados
  );
  assert.equal(relatorio.promocionaisIgnorados.length, 9);
  assert.equal(
    plano.some((item) => item.registro.linhaOrigem === "THE LUXE PREMIUM"),
    false
  );
  assert.equal(
    relatorio.produtosNaoEncontrados.some((nome) => nomesIgnorados.has(nome)),
    false
  );
  assert.equal(
    relatorio.correspondenciasAmbiguas.some(({ item }) =>
      nomesIgnorados.has(item)
    ),
    false
  );
  assert.equal(relatorio.produtosExistentesReutilizados, 0);
  assert.equal(relatorio.produtosNovosPlanejados, 0);
});

test("linhas logicas usam valores canonicos sem conflito de capitalizacao", () => {
  const linhas = resolverLinhas([
    { nome: "Produto", linha: "Dream Color" },
    { nome: "Produto", linha: "Zoom" },
    { nome: "Shampoo The Luxe", linha: "The Luxe" },
    { nome: "Condicionador", linha: "the luxe" },
  ]);

  assert.equal(linhas["DREAM COLOR LINE CARE"], "Dream Color");
  assert.equal(linhas["VANITY PET"], "Vanity Pet");
  assert.equal(linhas["THE LUXE PREMIUM"], "The Luxe");
  assert.equal(linhas.ZOOM, "Zoom");
});
