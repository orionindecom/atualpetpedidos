import test from "node:test";
import assert from "node:assert/strict";
import {
  origemPrecosAtacado,
  produtosAtacadoJunho2026 as dados,
  promocionaisAtacadoIgnorados as promocionais,
} from "../src/scripts/data/precosAtacadoJunho2026.js";
import {
  ALIASES_EXPLICITOS_ATACADO,
  identificarTabelaAtacado,
  localizarProdutoAtacado,
  planejarImportacaoAtacado,
  validarDatasetAtacado,
} from "../src/scripts/importarPrecosAtacado.js";

const registro = (nomeBase, diluicao, embalagem, linhaOrigem, valorAtacado) => ({
  nomeBase,
  diluicao,
  embalagem,
  linhaOrigem,
  valorAtacado,
});

const montarNomeTeste = ({ nomeBase, diluicao, embalagem }) =>
  [nomeBase, diluicao, embalagem].filter(Boolean).join(" ");

test("dataset Atacado fecha as 158 linhas extraidas do PDF", () => {
  assert.equal(dados.length, 149);
  assert.equal(promocionais.length, 9);
  assert.equal(dados.length + promocionais.length, 158);
  assert.equal(origemPrecosAtacado.colunaPreco, "VALOR UNITARIO");
  assert.deepEqual(validarDatasetAtacado(), []);
  assert.equal(Object.keys(ALIASES_EXPLICITOS_ATACADO).length, 25);
});

test("dataset Atacado preserva contagens e identidades de cada bloco", () => {
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
  assert.equal(
    dados.some(
      (item) =>
        item.nomeBase === "SHAMPOO DREAM COLOR TUTTI-FRUTTI" &&
        item.diluicao === "1:5" &&
        item.embalagem === "1L"
    ),
    true
  );
  assert.equal(
    dados.some(
      (item) =>
        item.nomeBase === "SHAMPOO DREAM COLOR FRAMBOESA C/ CHANTILLY" &&
        item.diluicao === "1:5" &&
        item.embalagem === "1L"
    ),
    false
  );
});

test("valores unitarios sensiveis permanecem iguais ao PDF", () => {
  const localizar = (nomeBase, embalagem, diluicao = null) =>
    dados.find(
      (item) =>
        item.nomeBase === nomeBase &&
        item.embalagem === embalagem &&
        item.diluicao === diluicao
    );

  assert.equal(
    localizar("SHAMPOO DREAM COLOR PRE-LAVAGEM", "5L", "1:5")?.valorAtacado,
    undefined
  );
  assert.equal(
    localizar("SHAMPOO DREAM COLOR PRÉ-LAVAGEM", "5L", "1:5").valorAtacado,
    173.31
  );
  assert.equal(
    localizar("SHAMPOO DREAM COLOR BRANQUEADOR", "5L", "1:5").valorAtacado,
    148.35
  );
  assert.equal(
    localizar(
      "SHAMPOO DREAM COLOR FRAMBOESA C/ CHANTILLY",
      "5L",
      "1:5"
    ).valorAtacado,
    120.61
  );
  assert.equal(
    localizar("PERFUME VANITY ULTRA PREMIUM BABY", "50ML").valorAtacado,
    34
  );
  assert.equal(
    localizar("PERFUME VANITY ULTRA PREMIUM BABY", "500ML").valorAtacado,
    96
  );
  assert.equal(
    localizar("SHAMPOO ZOOM PRÉ-LAVAGEM", "5L", "1:4").valorAtacado,
    39.93
  );
});

test("tabela Atacado e localizada sem diferenciar maiusculas e minusculas", () => {
  const tabela = { _id: "atacado", nome: "Atacado 2026", ativa: true };

  assert.equal(identificarTabelaAtacado([tabela]), tabela);
  assert.equal(
    identificarTabelaAtacado([
      { _id: "outra", nome: "Tabela comum", tipo: "ATACADO", ativa: true },
    ]).tipo,
    "ATACADO"
  );
  assert.throws(
    () => identificarTabelaAtacado([tabela, { ...tabela, _id: "duplicada" }]),
    /Mais de uma tabela/
  );
  assert.throws(() => identificarTabelaAtacado([]), /Nenhuma tabela/);
});

test("normalizacao segura aceita acento, hifen, C barra COM e ampersand", () => {
  const item = registro(
    "CONDICIONADOR DREAM COLOR CEREJA C/ AVELÃ",
    "1:5",
    "5L",
    "DREAM COLOR LINE - SUPER PREMIUM",
    10
  );
  const produto = {
    _id: "produto",
    nome: "Condicionador Dream Color Cereja com Avela 1:5 5 L",
    linha: "Dream Color",
  };

  assert.equal(localizarProdutoAtacado([produto], item).produto, produto);

  const luxe = registro(
    "COLÔNIA LICHIA & ROMÃ",
    null,
    "500ML",
    "THE LUXE PREMIUM",
    79.41
  );
  const produtoLuxe = {
    _id: "luxe",
    nome: "Colonia The Luxe Lichia e Roma 500ml",
    linha: "The Luxe",
  };

  assert.equal(localizarProdutoAtacado([produtoLuxe], luxe).produto, produtoLuxe);
});

test("Dream Color Care e tratado como a mesma linha comercial do PDF", () => {
  const item = registro(
    "SHAMPOO DE VOLUME DREAM COLOR LINE CARE POWER PUFF",
    null,
    "1L",
    "DREAM COLOR LINE CARE",
    76.04
  );
  const produto = {
    _id: "6a5aab4997e2675dd0e46f10",
    nome: "Shampoo de Volume Power Puff 1L",
    linha: "Dream Color Care",
    ativo: true,
  };

  const resultado = localizarProdutoAtacado([produto], item);

  assert.equal(resultado.produto, produto);
  assert.equal(resultado.tipo, "alias");
});

test("aliases auditados usam IDs deterministas e nunca recaem em fuzzy match", () => {
  assert.equal(
    ALIASES_EXPLICITOS_ATACADO[
      "SHAMPOO THE LUXE CEREJA & AVELÃ 1:5 5L"
    ],
    "6a512102328c36f3a611f344"
  );
  assert.equal(
    Object.values(ALIASES_EXPLICITOS_ATACADO).includes(
      "6a321465da2735773a656538"
    ),
    false
  );
  assert.equal(
    ALIASES_EXPLICITOS_ATACADO[
      "CONDICIONADOR DREAM COLOR JASMIM C/ AMENDOAS 1:5 1L"
    ],
    "6a5e4a86011c103e77abdda2"
  );
  assert.equal(
    ALIASES_EXPLICITOS_ATACADO["CONDICIONADOR MELANCIA 1:5 5L"],
    "6a512da7328c36f3a611f34d"
  );

  const item = dados.find(
    (registro) =>
      registro.nomeBase === "SHAMPOO THE LUXE CEREJA & AVELÃ" &&
      registro.embalagem === "5L"
  );
  const candidatoErrado = {
    _id: "6a321465da2735773a656538",
    nome: "Shampoo The Luxe Cereja e Avelã 5L",
    linha: "The Luxe",
    ativo: true,
  };
  const resultado = localizarProdutoAtacado([candidatoErrado], item);

  assert.equal(resultado.produto, null);
  assert.match(resultado.bloqueio, /produto ausente ou inativo/);
});

test("match nao ignora fragrancia, volume ou diluicao", () => {
  const item = registro(
    "SHAMPOO DREAM COLOR TANGERINA CITRUS",
    "1:5",
    "5L",
    "DREAM COLOR LINE - SUPER PREMIUM",
    120.61
  );
  const produtos = [
    {
      _id: "fragrancia",
      nome: "Shampoo Dream Color Alecrim do Campo 1:5 5L",
      linha: "Dream Color",
    },
    {
      _id: "volume",
      nome: "Shampoo Dream Color Tangerina Citrus 1:5 1L",
      linha: "Dream Color",
    },
    {
      _id: "diluicao",
      nome: "Shampoo Dream Color Tangerina Citrus 1:12 5L",
      linha: "Dream Color",
    },
  ];

  assert.deepEqual(localizarProdutoAtacado(produtos, item), {
    produto: null,
    tipo: null,
    candidatas: [],
  });
});

test("planejamento nunca cria produto e compara preco por tabela mais produto", () => {
  const tabela = { _id: "tabela", nome: "Atacado 2026", ativa: true };
  const registros = [
    registro("SHAMPOO ZOOM NEUTRO", "1:4", "5L", "ZOOM", 39.93),
    registro("SHAMPOO ZOOM MORANGO", null, "750ML", "ZOOM", 6.1),
    registro("SHAMPOO ZOOM INEXISTENTE", null, "750ML", "ZOOM", 9.99),
  ];
  const produtos = [
    {
      _id: "neutro",
      nome: "SHAMPOO ZOOM NEUTRO 1:4 5L",
      linha: "ZOOM",
      ativo: true,
    },
    {
      _id: "morango",
      nome: "Shampoo Zoom Morango 750 ml",
      linha: "Zoom",
      ativo: true,
    },
  ];
  const precos = [
    { _id: "preco-1", tabelaPrecoId: "tabela", produtoId: "neutro", valor: 39.93 },
    { _id: "preco-2", tabelaPrecoId: "tabela", produtoId: "morango", valor: 5 },
  ];
  const { plano, relatorio } = planejarImportacaoAtacado({
    tabela,
    produtos,
    precos,
    registros,
  });

  assert.equal(plano.length, 2);
  assert.equal(plano.some((item) => "produtoNovo" in item), false);
  assert.equal(relatorio.precos.inalterados, 1);
  assert.equal(relatorio.precos.atualizar, 1);
  assert.equal(relatorio.precos.criar, 0);
  assert.deepEqual(relatorio.naoEncontrados, [
    "SHAMPOO ZOOM INEXISTENTE 750ML",
  ]);
  assert.deepEqual(relatorio.diferencasPreco, [
    { produto: "Shampoo Zoom Morango 750 ml", atual: 5, pdf: 6.1, diferenca: 1.1 },
  ]);
});

test("promocionais sao somente relatados e nunca entram no plano", () => {
  const tabela = { _id: "tabela", nome: "Atacado 2026", ativa: true };
  const produtoPromocional = {
    _id: "almotolia",
    nome: "Almotolia 1L",
    linha: "Acessorios",
    ativo: true,
  };
  const { plano, relatorio } = planejarImportacaoAtacado({
    tabela,
    produtos: [produtoPromocional],
    precos: [],
    registros: [],
  });

  assert.deepEqual(plano, []);
  assert.equal(relatorio.promocionais.length, 9);
  assert.equal(
    relatorio.promocionais.find((item) => item.item === "ALMOTOLIA 1L")
      .situacao,
    "ignorado; produto encontrado no catalogo"
  );
});

test("planejamento ignora duplicado inativo e usa somente Jasmim ativo", () => {
  const tabela = { _id: "tabela", nome: "Atacado 2026", ativa: true };
  const item = registro(
    "CONDICIONADOR DREAM COLOR JASMIM C/ AMENDOAS",
    "1:5",
    "5L",
    "DREAM COLOR LINE - SUPER PREMIUM",
    180.93
  );
  const inativo = {
    _id: "6a5aab4897e2675dd0e46ef4",
    nome: "CONDICIONADOR DREAM COLOR JASMIM C/ AMENDOAS 1:5 5L",
    linha: "Dream Color",
    ativo: false,
  };
  const ativo = {
    _id: "6a5e4a60011c103e77abdda1",
    nome: "CONDICIONADOR DREAM COLOR JASMIM C/ AMENDOAS 1:5 5L",
    linha: "Dream Color",
    ativo: true,
  };
  const { plano, relatorio } = planejarImportacaoAtacado({
    tabela,
    produtos: [inativo, ativo],
    precos: [],
    registros: [item],
  });

  assert.equal(plano.length, 1);
  assert.equal(String(plano[0].produtoId), ativo._id);
  assert.equal(relatorio.encontradosExatamente.length, 1);
  assert.deepEqual(relatorio.ambiguos, []);
});

test("Talco usa somente o alias explicito confirmado", () => {
  const tabela = { _id: "tabela", nome: "Atacado 2026", ativa: true };
  const talco = dados.find((item) => item.nomeBase.includes("(TALCO)"));
  const candidatoGenerico = {
    _id: "6a512551328c36f3a611f347",
    nome: "Shampoo The Luxe Limpeza Profunda 5L",
    linha: "The Luxe",
    ativo: true,
  };
  const { plano, relatorio } = planejarImportacaoAtacado({
    tabela,
    produtos: [candidatoGenerico],
    precos: [],
    registros: [talco],
  });

  assert.equal(
    ALIASES_EXPLICITOS_ATACADO[montarNomeTeste(talco)],
    candidatoGenerico._id
  );
  assert.equal(plano.length, 1);
  assert.equal(String(plano[0].produtoId), candidatoGenerico._id);
  assert.equal(relatorio.encontradosPorAliasExplicito.length, 1);
  assert.deepEqual(relatorio.naoEncontrados, []);
  assert.deepEqual(relatorio.produtosBloqueandoAplicacao, []);
});

test("precos Atacado de produtos inativos ficam fora do plano", () => {
  const tabela = { _id: "tabela", nome: "Atacado 2026", ativa: true };
  const item = registro(
    "SHAMPOO DREAM COLOR FRAMBOESA C/ CHANTILLY",
    "1:12",
    "5L",
    "DREAM COLOR LINE - SUPER PREMIUM",
    178.25
  );
  const produtoInativo = {
    _id: "6a307479464441b61314ba79",
    nome: "SHAMPOO DREAM COLOR FRAMBOESA C/ CHANTILLY 1:12 5L",
    linha: "Dream Color",
    ativo: false,
  };
  const precoAntigo = {
    _id: "preco-antigo",
    produtoId: produtoInativo._id,
    tabelaPrecoId: tabela._id,
    valor: 22.89,
  };
  const { plano, relatorio } = planejarImportacaoAtacado({
    tabela,
    produtos: [produtoInativo],
    precos: [precoAntigo],
    registros: [item],
  });

  assert.deepEqual(plano, []);
  assert.equal(relatorio.precos.atualizar, 0);
  assert.equal(relatorio.precosAtuaisVinculados[0].valor, 22.89);
});
