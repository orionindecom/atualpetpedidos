import dotenv from "dotenv";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import Produto from "../models/Produto.js";
import TabelaPreco from "../models/TabelaPreco.js";
import PrecoProduto from "../models/PrecoProduto.js";
import {
  origemDistribuidorEspecializado,
  produtosDistribuidorEspecializadoJunho2026,
  produtosPromocionaisIgnorados,
} from "./data/distribuidorEspecializadoJunho2026.js";

dotenv.config({ quiet: true });

const TIPOS_TABELA = [
  "distribuidor",
  "cliente_final_loja",
  "cliente_final_internet",
];
const AMBIENTES_GRAVACAO_DIRETA = new Set([
  "development",
  "test",
  "staging",
]);
const LINHA_THE_LUXE = "THE LUXE PREMIUM";

const normalizarComparacao = (valor = "") =>
  String(valor)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .normalize("NFC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/(\d)\s*(ML|KG|L|G)\b/gi, "$1$2")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR");

const normalizarLinhaLogica = (linha) => {
  const valor = normalizarComparacao(linha);

  if (["the luxe", "the luxe premium", "deluxe"].includes(valor)) {
    return "the luxe";
  }

  if (["vanity", "vanity pet"].includes(valor)) {
    return "vanity pet";
  }

  return valor;
};

const montarNomeProduto = ({ nomeBase, diluicao, embalagem }) =>
  [nomeBase, diluicao, embalagem].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

const extrairEmbalagem = (nome) =>
  normalizarComparacao(nome).match(/\b\d+(?:[.,]\d+)?(?:ml|kg|l|g)\b/)?.[0] || null;

const extrairDiluicao = (nome) =>
  normalizarComparacao(nome).match(/\d+\s*:\s*\d+/)?.[0]?.replace(/\s/g, "") || null;

const tokensNomeBase = (nomeBase) =>
  normalizarComparacao(nomeBase)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);

const tokensIdentidadeProduto = (nome) =>
  normalizarComparacao(nome)
    .replace(/\d+\s*:\s*\d+/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?(?:ml|kg|l|g)\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);

const produtoCompativelFraco = (produto, registro) => {
  const nomeProduto = normalizarComparacao(produto.nome);
  const embalagemProduto = extrairEmbalagem(produto.nome);
  const diluicaoProduto = extrairDiluicao(produto.nome);
  const embalagemEsperada = normalizarComparacao(registro.embalagem);
  const diluicaoEsperada = registro.diluicao
    ? normalizarComparacao(registro.diluicao).replace(/\s/g, "")
    : null;

  if (embalagemProduto && embalagemProduto !== embalagemEsperada) {
    return false;
  }

  if (diluicaoProduto && diluicaoProduto !== diluicaoEsperada) {
    return false;
  }

  if (!diluicaoEsperada && diluicaoProduto) {
    return false;
  }

  const tokensEsperados = new Set(tokensNomeBase(registro.nomeBase));
  const tokensCandidatos = tokensIdentidadeProduto(nomeProduto).filter(
    (token) =>
      registro.linhaOrigem !== LINHA_THE_LUXE ||
      !["the", "luxe"].includes(token)
  );

  return (
    [...tokensEsperados].every((token) => tokensCandidatos.includes(token)) &&
    tokensCandidatos.every((token) => tokensEsperados.has(token))
  );
};

const produtoAliasZoomPreLavagem = (produto, registro) => {
  if (
    registro.linhaOrigem !== "ZOOM" ||
    normalizarComparacao(registro.nomeBase) !==
      normalizarComparacao("SHAMPOO ZOOM PRÉ-LAVAGEM") ||
    normalizarComparacao(registro.diluicao) !== "1:4" ||
    normalizarComparacao(registro.embalagem) !== "5l"
  ) {
    return false;
  }

  return (
    normalizarLinhaLogica(produto.linha) === "zoom" &&
    tokensIdentidadeProduto(produto.nome).join(" ") ===
      tokensIdentidadeProduto("SHAMPOO ZOOM PRÉ-LAVAGEM 5L").join(" ") &&
    extrairEmbalagem(produto.nome) === "5l" &&
    extrairDiluicao(produto.nome) === null
  );
};

const pontuarCorrespondencia = (produto, registro) => {
  const diluicaoProduto = extrairDiluicao(produto.nome);
  const embalagemProduto = extrairEmbalagem(produto.nome);
  const diluicaoEsperada = registro.diluicao
    ? normalizarComparacao(registro.diluicao).replace(/\s/g, "")
    : null;
  const embalagemEsperada = normalizarComparacao(registro.embalagem);
  const esperados = new Set(tokensNomeBase(registro.nomeBase));
  const candidatos = new Set(
    tokensIdentidadeProduto(produto.nome).filter(
      (token) =>
        registro.linhaOrigem !== LINHA_THE_LUXE ||
        !["the", "luxe"].includes(token)
    )
  );
  const intersecao = [...esperados].filter((token) => candidatos.has(token)).length;
  const uniao = new Set([...esperados, ...candidatos]).size || 1;

  return {
    diluicao: diluicaoProduto === diluicaoEsperada ? 1 : 0,
    embalagem: embalagemProduto === embalagemEsperada ? 1 : 0,
    similaridade: intersecao / uniao,
  };
};

const compararPontuacao = (a, b) =>
  b.pontuacao.diluicao - a.pontuacao.diluicao ||
  b.pontuacao.embalagem - a.pontuacao.embalagem ||
  b.pontuacao.similaridade - a.pontuacao.similaridade;

const mesmaPontuacao = (a, b) =>
  a.diluicao === b.diluicao &&
  a.embalagem === b.embalagem &&
  a.similaridade === b.similaridade;

const desempatarCorrespondencias = (candidatas, registro) => {
  const ordenadas = candidatas
    .map((produto) => ({
      produto,
      pontuacao: pontuarCorrespondencia(produto, registro),
    }))
    .sort(compararPontuacao);

  if (
    ordenadas.length === 0 ||
    (ordenadas.length > 1 &&
      mesmaPontuacao(ordenadas[0].pontuacao, ordenadas[1].pontuacao))
  ) {
    return null;
  }

  return {
    produto: ordenadas[0].produto,
    candidatas: ordenadas.map(({ produto }) => produto.nome),
    criterio: "diluicao explicita, embalagem e similaridade normalizada",
  };
};

export const localizarCorrespondencias = (produtos, registro, linha) => {
  const naLinha = produtos.filter(
    (produto) =>
      normalizarLinhaLogica(produto.linha) === normalizarLinhaLogica(linha)
  );
  const nomesEsperados = new Set([
    normalizarComparacao(montarNomeProduto(registro)),
    normalizarComparacao(
      [registro.nomeBase, registro.embalagem, registro.diluicao]
        .filter(Boolean)
        .join(" ")
    ),
  ]);
  const exatas = naLinha.filter((produto) =>
    nomesEsperados.has(normalizarComparacao(produto.nome))
  );

  const aliases = naLinha.filter((produto) =>
    produtoAliasZoomPreLavagem(produto, registro)
  );

  if (exatas.length > 0 || aliases.length > 0) {
    return { exatas: [...new Set([...exatas, ...aliases])], possiveis: [] };
  }

  const exatasEmOutraLinha = produtos.filter(
    (produto) =>
      normalizarLinhaLogica(produto.linha) !== normalizarLinhaLogica(linha) &&
      nomesEsperados.has(normalizarComparacao(produto.nome))
  );
  const compativeisNaLinha = naLinha.filter((produto) =>
    produtoCompativelFraco(produto, registro)
  );

  if (
    registro.linhaOrigem === LINHA_THE_LUXE &&
    exatasEmOutraLinha.length === 0 &&
    compativeisNaLinha.length > 0
  ) {
    const resolucao = desempatarCorrespondencias(compativeisNaLinha, registro);

    if (resolucao) {
      return {
        exatas: [resolucao.produto],
        possiveis: [],
        resolucaoAutomatica:
          compativeisNaLinha.length > 1 ? resolucao : null,
      };
    }
  }

  return {
    exatas: [],
    possiveis: [
      ...exatasEmOutraLinha,
      ...compativeisNaLinha,
    ],
  };
};

const classificarCategoria = (nome) => {
  const valor = normalizarComparacao(nome);
  const regras = [
    ["display_perfume", /^display perfume\b/],
    ["shampoo", /^shampoo\b/],
    ["condicionador", /^condicionador\b/],
    ["perfume", /^perfume\b/],
    ["colonia", /^colonia\b/],
    ["mascara", /^mascara\b/],
    ["aromatizador", /^aromatizador\b/],
    ["spray", /^spray\b/],
    ["banho_seco", /^banho a seco\b/],
    ["tira_nos", /^tira nos\b/],
    ["leave_in", /^leave in\b/],
    ["limpa_orelha", /^limpa orelha\b/],
    ["hidratante", /^hidratante\b/],
    ["fluido", /^fluido\b/],
  ];

  return regras.find(([, expressao]) => expressao.test(valor))?.[0] || null;
};

const mapearCategorias = (produtos) => {
  const porClassificacao = new Map();

  for (const produto of produtos) {
    const classificacao = classificarCategoria(produto.nome);

    if (!classificacao || !produto.categoria) {
      continue;
    }

    if (!porClassificacao.has(classificacao)) {
      porClassificacao.set(classificacao, new Set());
    }

    porClassificacao.get(classificacao).add(produto.categoria);
  }

  return porClassificacao;
};

const valorUnico = (valores) => {
  const unicos = [...new Set(valores.filter(Boolean))];
  return unicos.length === 1 ? unicos[0] : null;
};

const resolverCategoriaPerfume = (produtos) => {
  const prioridades = ["perfume", "perfumes", "colonia", "colonias"];
  const categorias = [...new Set(produtos.map((produto) => produto.categoria).filter(Boolean))];

  for (const prioridade of prioridades) {
    const candidatas = categorias.filter(
      (categoria) => normalizarComparacao(categoria) === prioridade
    );

    if (candidatas.length > 0) {
      const grafiaExata = candidatas.find(
        (categoria) => categoria === "Perfume" || categoria === "Colônia"
      );
      return grafiaExata || valorUnico(candidatas);
    }
  }

  return null;
};

export const resolverCategoriaProdutoNovo = (
  registro,
  produtos,
  categoriasMapeadas = mapearCategorias(produtos)
) => {
  const classificacao = classificarCategoria(registro.nomeBase);

  if (["perfume", "display_perfume"].includes(classificacao)) {
    const categoria = resolverCategoriaPerfume(produtos);

    return {
      classificacao,
      categoria,
      candidatas: categoria ? [categoria] : [],
      mensagem: categoria
        ? null
        : "Categoria adequada para Perfume não encontrada no banco.",
    };
  }

  if (["aromatizador", "spray"].includes(classificacao)) {
    const candidatas = [
      ...new Set(
        produtos
          .map((produto) => produto.categoria)
          .filter(
            (categoria) =>
              normalizarComparacao(categoria) === "cuidados especiais"
          )
      ),
    ];
    const exata = candidatas.find(
      (categoria) => categoria === "Cuidados Especiais"
    );

    return {
      classificacao,
      categoria: exata || valorUnico(candidatas),
      candidatas,
    };
  }

  const candidatas = classificacao
    ? [...(categoriasMapeadas.get(classificacao) || [])]
    : [];

  return {
    classificacao,
    categoria: valorUnico(candidatas),
    candidatas,
  };
};

export const resolverLinhas = (produtos) => {
  const linhas = [...new Set(produtos.map((produto) => produto.linha).filter(Boolean))];
  const linhaDreamColor = valorUnico(
    linhas.filter((linha) => normalizarComparacao(linha) === "dream color")
  );
  const linhaZoom = valorUnico(
    linhas.filter((linha) => normalizarComparacao(linha) === "zoom")
  );
  const possuiTheLuxe = produtos.some(
    (produto) => normalizarLinhaLogica(produto.linha) === "the luxe"
  );

  return {
    "DREAM COLOR LINE - SUPER PREMIUM": linhaDreamColor,
    "DREAM COLOR LINE CARE": linhaDreamColor,
    "VANITY PET": "Vanity Pet",
    ZOOM: linhaZoom,
    [LINHA_THE_LUXE]: possuiTheLuxe ? "The Luxe" : null,
  };
};

export const validarDadosImportacao = (
  registros = produtosDistribuidorEspecializadoJunho2026
) => {
  const erros = [];
  const identidades = new Set();

  registros.forEach((registro, indice) => {
    if (registro.linhaOrigem === LINHA_THE_LUXE) {
      return;
    }

    const nome = montarNomeProduto(registro);
    const identidade = normalizarComparacao(
      `${registro.linhaOrigem} ${nome}`
    );

    if (identidades.has(identidade)) {
      erros.push(`Registro ${indice + 1}: produto duplicado no arquivo (${nome})`);
    }
    identidades.add(identidade);

    if (!registro.nomeBase || !registro.embalagem || !registro.linhaOrigem) {
      erros.push(`Registro ${indice + 1}: identificacao incompleta`);
    }

    for (const campo of [
      "distribuidor",
      "clienteFinalLoja",
      "clienteFinalInternet",
    ]) {
      const valor = registro[campo];

      if (typeof valor !== "number" || !Number.isFinite(valor) || valor < 0) {
        erros.push(`Registro ${indice + 1}: ${campo} invalido em ${nome}`);
      }
    }

    if (registro.distribuidor > registro.clienteFinalLoja) {
      erros.push(
        `Registro ${indice + 1}: distribuidor supera loja fisica; revisar colunas em ${nome}`
      );
    }

    if (registro.clienteFinalLoja > registro.clienteFinalInternet) {
      erros.push(
        `Registro ${indice + 1}: loja fisica supera internet; revisar colunas em ${nome}`
      );
    }
  });

  if (registros.length !== origemDistribuidorEspecializado.registrosImportaveis) {
    erros.push(
      `Quantidade esperada ${origemDistribuidorEspecializado.registrosImportaveis}, ` +
        `recebida ${registros.length}`
    );
  }

  return erros;
};

const validarFlags = () => {
  const argumentos = new Set(process.argv.slice(2));
  const permitidos = new Set(["--confirmar", "--permitir-producao"]);
  const desconhecidos = [...argumentos].filter((item) => !permitidos.has(item));

  if (desconhecidos.length > 0) {
    throw new Error(`Argumentos desconhecidos: ${desconhecidos.join(", ")}`);
  }

  const gravar = argumentos.has("--confirmar");
  const permitirProducao = argumentos.has("--permitir-producao");
  const ambiente = (process.env.NODE_ENV || "").trim().toLowerCase();

  if (permitirProducao && !gravar) {
    throw new Error("--permitir-producao exige tambem --confirmar");
  }

  if (
    gravar &&
    !AMBIENTES_GRAVACAO_DIRETA.has(ambiente) &&
    !permitirProducao
  ) {
    throw new Error(
      "Gravacao fora de development/test/staging exige --permitir-producao"
    );
  }

  return { gravar, ambiente: ambiente || "nao definido" };
};

const localizarTabelas = async () => {
  const encontradas = await TabelaPreco.find({
    tipo: { $in: TIPOS_TABELA },
    ativa: true,
  })
    .select("_id nome tipo ativa")
    .lean();
  const porTipo = {};
  const erros = [];

  for (const tipo of TIPOS_TABELA) {
    const tabelas = encontradas.filter((tabela) => tabela.tipo === tipo);

    if (tabelas.length !== 1) {
      erros.push(
        `${tipo}: esperada exatamente 1 tabela ativa, encontradas ${tabelas.length}`
      );
    } else {
      porTipo[tipo] = tabelas[0];
    }
  }

  if (erros.length > 0) {
    throw new Error(`Tabelas de preco invalidas:\n- ${erros.join("\n- ")}`);
  }

  return porTipo;
};

const chavePreco = (tabelaId, produtoId) =>
  `${String(tabelaId)}:${String(produtoId)}`;

export const criarRelatorioImportacao = (
  modo,
  registros = produtosDistribuidorEspecializadoJunho2026
) => ({
  modo,
  tabelas: [],
  produtosAnalisados: registros.length,
  produtosEfetivamenteProcessados: 0,
  produtosTheLuxeIgnorados: [],
  produtosExistentesReutilizados: 0,
  produtosNovosPlanejados: 0,
  produtosCriados: 0,
  produtosNaoEncontrados: [],
  correspondenciasAmbiguas: [],
  ambiguidadesResolvidasAutomaticamente: [],
  categoriasExistentes: [],
  categoriasNaoIdentificadas: [],
  categoriaPerfumeEscolhida: null,
  alertas: [],
  linhasExistentes: [],
  linhasNaoIdentificadas: [],
  promocionaisIgnorados: produtosPromocionaisIgnorados.map(
    (item) => `${item.nomeBase} ${item.embalagem}`
  ),
  precos: {
    distribuidor: { criar: 0, atualizar: 0, inalterado: 0, efetivadosCriar: 0, efetivadosAtualizar: 0 },
    cliente_final_loja: { criar: 0, atualizar: 0, inalterado: 0, efetivadosCriar: 0, efetivadosAtualizar: 0 },
    cliente_final_internet: { criar: 0, atualizar: 0, inalterado: 0, efetivadosCriar: 0, efetivadosAtualizar: 0 },
  },
  erros: [],
});

const planejarPreco = ({
  itemPlano,
  tipo,
  valor,
  tabela,
  precoExistente,
  relatorio,
}) => {
  let acao = "criar";

  if (precoExistente) {
    acao = Number(precoExistente.valor) === valor ? "inalterado" : "atualizar";
  }

  relatorio.precos[tipo][acao] += 1;
  itemPlano.precos.push({ tipo, valor, tabela, acao });
};

export const planejarImportacao = ({
  produtos,
  precos,
  tabelas,
  relatorio,
  registros = produtosDistribuidorEspecializadoJunho2026,
}) => {
  const plano = [];
  const registrosProcessaveis = [];

  for (const registro of registros) {
    if (registro.linhaOrigem === LINHA_THE_LUXE) {
      relatorio.produtosTheLuxeIgnorados.push(montarNomeProduto(registro));
      continue;
    }

    registrosProcessaveis.push(registro);
  }

  relatorio.produtosEfetivamenteProcessados += registrosProcessaveis.length;

  if (registrosProcessaveis.length === 0) {
    return plano;
  }

  const linhasResolvidas = resolverLinhas(produtos);
  const categoriasMapeadas = mapearCategorias(produtos);
  const precosPorChave = new Map(
    precos.map((preco) => [
      chavePreco(preco.tabelaPrecoId, preco.produtoId),
      preco,
    ])
  );
  relatorio.linhasExistentes = [...new Set(produtos.map((p) => p.linha).filter(Boolean))].sort();
  relatorio.categoriasExistentes = [
    ...new Set(produtos.map((p) => p.categoria).filter(Boolean)),
  ].sort();
  relatorio.categoriaPerfumeEscolhida = resolverCategoriaPerfume(produtos);

  for (const registro of registrosProcessaveis) {
    const nomePlanejado = montarNomeProduto(registro);
    const linha = linhasResolvidas[registro.linhaOrigem];

    if (!linha) {
      relatorio.linhasNaoIdentificadas.push(nomePlanejado);
      relatorio.produtosNaoEncontrados.push(nomePlanejado);
      continue;
    }

    const correspondencias = localizarCorrespondencias(produtos, registro, linha);

    if (correspondencias.resolucaoAutomatica) {
      relatorio.ambiguidadesResolvidasAutomaticamente.push({
        item: nomePlanejado,
        escolhida: correspondencias.resolucaoAutomatica.produto.nome,
        candidatas: correspondencias.resolucaoAutomatica.candidatas,
        criterio: correspondencias.resolucaoAutomatica.criterio,
      });
    }

    if (correspondencias.exatas.length > 1 || correspondencias.possiveis.length > 0) {
      const candidatas = [
        ...correspondencias.exatas,
        ...correspondencias.possiveis,
      ].map((produto) => produto.nome);
      relatorio.correspondenciasAmbiguas.push({ item: nomePlanejado, candidatas });
      relatorio.produtosNaoEncontrados.push(nomePlanejado);

      continue;
    }

    let produto = correspondencias.exatas[0] || null;
    let produtoNovo = null;

    if (!produto) {
      const categoriaResolvida = resolverCategoriaProdutoNovo(
        registro,
        produtos,
        categoriasMapeadas
      );

      if (!categoriaResolvida.categoria) {
        const isPerfume = ["perfume", "display_perfume"].includes(
          categoriaResolvida.classificacao
        );

        if (categoriaResolvida.mensagem) {
          relatorio.alertas = [
            ...new Set([...relatorio.alertas, categoriaResolvida.mensagem]),
          ];
        }

        if (
          !isPerfume ||
          !relatorio.categoriasNaoIdentificadas.some(
            (item) => item.classificacao === "perfume"
          )
        ) {
          relatorio.categoriasNaoIdentificadas.push({
            item: isPerfume ? "PERFUMES VANITY E DISPLAY" : nomePlanejado,
            classificacao: isPerfume
              ? "perfume"
              : categoriaResolvida.classificacao,
            candidatas: categoriaResolvida.candidatas,
          });
        }
        relatorio.produtosNaoEncontrados.push(nomePlanejado);
        continue;
      }

      produtoNovo = {
        nome: nomePlanejado,
        linha,
        categoria: categoriaResolvida.categoria,
      };
      relatorio.produtosNovosPlanejados += 1;
    } else {
      relatorio.produtosExistentesReutilizados += 1;

    }

    const itemPlano = { registro, produto, produtoNovo, precos: [] };

    planejarPreco({
      itemPlano,
      tipo: "distribuidor",
      valor: registro.distribuidor,
      tabela: tabelas.distribuidor,
      precoExistente: produto
        ? precosPorChave.get(chavePreco(tabelas.distribuidor._id, produto._id))
        : null,
      relatorio,
    });

    for (const [tipo, campo] of [
      ["cliente_final_loja", "clienteFinalLoja"],
      ["cliente_final_internet", "clienteFinalInternet"],
    ]) {
      planejarPreco({
        itemPlano,
        tipo,
        valor: registro[campo],
        tabela: tabelas[tipo],
        precoExistente: produto
          ? precosPorChave.get(chavePreco(tabelas[tipo]._id, produto._id))
          : null,
        relatorio,
      });
    }

    plano.push(itemPlano);
  }

  return plano;
};

const aplicarItem = async (item, relatorio, session) => {
  let produtoId = item.produto?._id;

  if (!produtoId) {
    const [produtoCriado] = await Produto.create([item.produtoNovo], { session });
    produtoId = produtoCriado._id;
    relatorio.produtosCriados += 1;
  }

  for (const preco of item.precos) {
    if (preco.acao === "inalterado") {
      continue;
    }

    await PrecoProduto.findOneAndUpdate(
      {
        produtoId,
        tabelaPrecoId: preco.tabela._id,
      },
      { $set: { valor: preco.valor } },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        runValidators: true,
        session,
      }
    );
    relatorio.precos[preco.tipo][
      preco.acao === "criar" ? "efetivadosCriar" : "efetivadosAtualizar"
    ] += 1;
  }
};

const aplicarPlano = async (plano, relatorio, { session = null, continuarEmErro = false } = {}) => {
  for (const item of plano) {
    try {
      await aplicarItem(item, relatorio, session);
    } catch (error) {
      const detalhe = `${montarNomeProduto(item.registro)}: ${error.message}`;
      relatorio.erros.push(detalhe);

      if (!continuarEmErro) {
        throw error;
      }
    }
  }
};

const suportaTransacoes = async () => {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  return Boolean(hello.setName || hello.msg === "isdbgrid");
};

const imprimirLista = (titulo, itens) => {
  if (itens.length === 0) {
    return;
  }

  console.log(`\n${titulo}:`);
  itens.forEach((item) => console.log(`- ${typeof item === "string" ? item : JSON.stringify(item)}`));
};

const imprimirRelatorio = (relatorio) => {
  console.log("\n=== IMPORTACAO DISTRIBUIDOR ESPECIALIZADO 06/2026 ===");
  console.log(`Modo executado: ${relatorio.modo}`);
  console.log(`Tabelas encontradas: ${relatorio.tabelas.join(" | ")}`);
  console.log(`Produtos analisados: ${relatorio.produtosAnalisados}`);
  console.log(
    `Produtos efetivamente processados: ${relatorio.produtosEfetivamenteProcessados}`
  );
  console.log(
    `Produtos The Luxe ignorados: ${relatorio.produtosTheLuxeIgnorados.length}`
  );
  console.log(`Produtos existentes reutilizados: ${relatorio.produtosExistentesReutilizados}`);
  console.log(`Produtos novos planejados: ${relatorio.produtosNovosPlanejados}`);
  console.log(`Produtos criados: ${relatorio.produtosCriados}`);
  console.log(`Produtos nao encontrados: ${relatorio.produtosNaoEncontrados.length}`);
  console.log(`Correspondencias ambiguas: ${relatorio.correspondenciasAmbiguas.length}`);
  console.log(
    `Ambiguidades resolvidas automaticamente: ${relatorio.ambiguidadesResolvidasAutomaticamente.length}`
  );
  console.log(`Categorias existentes encontradas: ${relatorio.categoriasExistentes.length}`);
  console.log(`Categorias nao identificadas: ${relatorio.categoriasNaoIdentificadas.length}`);
  console.log(
    `Categoria escolhida para Perfume: ${
      relatorio.categoriaPerfumeEscolhida || "nao encontrada"
    }`
  );
  console.log(`Linhas existentes encontradas: ${relatorio.linhasExistentes.length}`);
  console.log(`Linhas nao identificadas: ${relatorio.linhasNaoIdentificadas.length}`);
  console.log(
    `Produtos promocionais ignorados (fora dos 149 importaveis): ${relatorio.promocionaisIgnorados.length}`
  );
  console.log(
    `Fechamento dos produtos importaveis: ${relatorio.produtosEfetivamenteProcessados} processados + ` +
      `${relatorio.produtosTheLuxeIgnorados.length} The Luxe ignorados = ` +
      `${relatorio.produtosAnalisados} analisados`
  );

  for (const [tipo, rotulo] of [
    ["distribuidor", "Distribuidor"],
    ["cliente_final_loja", "Loja"],
    ["cliente_final_internet", "Internet"],
  ]) {
    const preco = relatorio.precos[tipo];
    console.log(`Precos de ${rotulo} criados: ${preco.efetivadosCriar} (planejados: ${preco.criar})`);
    console.log(`Precos de ${rotulo} atualizados: ${preco.efetivadosAtualizar} (planejados: ${preco.atualizar})`);
    console.log(`Precos de ${rotulo} inalterados: ${preco.inalterado}`);
  }

  console.log(`Erros: ${relatorio.erros.length}`);

  imprimirLista("Produtos nao encontrados", relatorio.produtosNaoEncontrados);
  imprimirLista("Correspondencias ambiguas", relatorio.correspondenciasAmbiguas);
  imprimirLista("Ambiguidades resolvidas automaticamente", relatorio.ambiguidadesResolvidasAutomaticamente);
  imprimirLista("Categorias existentes no banco", relatorio.categoriasExistentes);
  imprimirLista("Categorias nao identificadas", relatorio.categoriasNaoIdentificadas);
  imprimirLista("Alertas de categoria", relatorio.alertas);
  imprimirLista("Linhas existentes encontradas", relatorio.linhasExistentes);
  imprimirLista("Linhas nao identificadas", relatorio.linhasNaoIdentificadas);
  imprimirLista("Produtos promocionais ignorados", relatorio.promocionaisIgnorados);
  imprimirLista("Produtos The Luxe ignorados", relatorio.produtosTheLuxeIgnorados);
  imprimirLista("Erros", relatorio.erros);
};

export const executarImportacao = async () => {
  const { gravar } = validarFlags();
  const relatorio = criarRelatorioImportacao(
    gravar ? "GRAVACAO" : "SIMULACAO"
  );
  const errosDados = validarDadosImportacao();

  if (errosDados.length > 0) {
    throw new Error(`Dados do PDF invalidos:\n- ${errosDados.join("\n- ")}`);
  }

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI nao configurada");
  }

  await mongoose.connect(process.env.MONGO_URI, {
    autoIndex: false,
    maxPoolSize: 3,
    serverSelectionTimeoutMS: 10000,
  });

  const tabelas = await localizarTabelas();
  relatorio.tabelas = TIPOS_TABELA.map(
    (tipo) => `${tipo}: ${tabelas[tipo].nome}`
  );

  const produtos = await Produto.find({})
    .select("_id nome linha categoria descricao fotoUrl ativo")
    .lean();
  const produtoIdsForaTheLuxe = produtos
    .filter((produto) => normalizarLinhaLogica(produto.linha) !== "the luxe")
    .map((produto) => produto._id);
  const precos = await PrecoProduto.find({
    tabelaPrecoId: { $in: TIPOS_TABELA.map((tipo) => tabelas[tipo]._id) },
    produtoId: { $in: produtoIdsForaTheLuxe },
  })
    .select("produtoId tabelaPrecoId valor")
    .lean();
  const plano = planejarImportacao({ produtos, precos, tabelas, relatorio });

  imprimirRelatorio(relatorio);

  if (!gravar) {
    console.log("\nSimulacao concluida. Nenhum dado foi gravado.");
    return relatorio;
  }

  if (await suportaTransacoes()) {
    const session = await mongoose.startSession();

    try {
      let resultadoTentativa;
      await session.withTransaction(async () => {
        resultadoTentativa = criarRelatorioImportacao("GRAVACAO");
        Object.assign(resultadoTentativa, {
          ...relatorio,
          modo: "GRAVACAO",
          produtosCriados: 0,
          erros: [],
          precos: JSON.parse(JSON.stringify(relatorio.precos)),
        });
        for (const tipo of TIPOS_TABELA) {
          resultadoTentativa.precos[tipo].efetivadosCriar = 0;
          resultadoTentativa.precos[tipo].efetivadosAtualizar = 0;
        }
        await aplicarPlano(plano, resultadoTentativa, { session });
      });
      Object.assign(relatorio, resultadoTentativa);
    } finally {
      await session.endSession();
    }
  } else {
    console.warn(
      "MongoDB sem suporte a transacao. Aplicando plano idempotente item por item."
    );
    await aplicarPlano(plano, relatorio, { continuarEmErro: true });
  }

  imprimirRelatorio(relatorio);
  return relatorio;
};

const executadoDiretamente =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executadoDiretamente) {
  executarImportacao()
    .catch((error) => {
      console.error(`Importacao interrompida: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
