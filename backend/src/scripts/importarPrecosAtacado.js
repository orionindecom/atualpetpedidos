import dotenv from "dotenv";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import PrecoProduto from "../models/PrecoProduto.js";
import Produto from "../models/Produto.js";
import TabelaPreco from "../models/TabelaPreco.js";
import {
  origemPrecosAtacado,
  produtosAtacadoJunho2026,
  promocionaisAtacadoIgnorados,
} from "./data/precosAtacadoJunho2026.js";

dotenv.config({ quiet: true });

const AMBIENTES_GRAVACAO_DIRETA = new Set([
  "development",
  "test",
  "staging",
]);

export const ALIASES_EXPLICITOS_ATACADO = Object.freeze({
  "SHAMPOO DE VOLUME DREAM COLOR LINE CARE POWER PUFF 1L":
    "6a5aab4997e2675dd0e46f10",
  "SHAMPOO THE LUXE LIMPEZA PROFUNDA (COCO) - ELIMINADOR DE ODORES 1:5 5L":
    "6a512609328c36f3a611f348",
  "SHAMPOO THE LUXE LIMPEZA PROFUNDA (TALCO) - ELIMINADOR DE ODORES 1:5 5L":
    "6a512551328c36f3a611f347",
  "SHAMPOO THE LUXE BRANQUEADOR 1:5 5L": "6a51266c328c36f3a611f349",
  "SHAMPOO THE LUXE CEREJA & AVELÃ 1:5 5L":
    "6a512102328c36f3a611f344",
  "SHAMPOO THE LUXE MELANCIA 1:5 5L": "6a5124b3328c36f3a611f346",
  "SHAMPOO THE LUXE LICHIA & ROMÃ 1:5 5L":
    "6a34b3e48466d5fa94f135da",
  "SHAMPOO THE LUXE NEUTRO 1:5 5L": "6a51228a328c36f3a611f345",
  "SHAMPOO THE LUXE PELES SENSÍVEIS E FACE (FILHOTES) 1:5 1L":
    "6a5126f0328c36f3a611f34a",
  "CONDICIONADOR DREAM COLOR JASMIM C/ AMENDOAS 1:5 1L":
    "6a5e4a86011c103e77abdda2",
  "CONDICIONADOR THE LUXE NEUTRO - PRONTO USO 5L":
    "6a5127c7328c36f3a611f34b",
  "CONDICIONADOR CEREJA & AVELÃ 1:5 5L": "6a5129d8328c36f3a611f34c",
  "CONDICIONADOR LICHIA & ROMÃ 1:5 5L": "6a34b4b88466d5fa94f135dd",
  "CONDICIONADOR MELANCIA 1:5 5L": "6a512da7328c36f3a611f34d",
  "CONDICIONADOR NEUTRO 1:5 5L": "6a512e07328c36f3a611f34e",
  "MÁSCARA HIDRATAÇÃO CEREJA & AVELÃ 500G": "6a513299328c36f3a611f35c",
  "MÁSCARA HIDRATAÇÃO LICHIA & ROMÃ 500G": "6a34b4128466d5fa94f135db",
  "MÁSCARA HIDRATAÇÃO MELANCIA 500G": "6a513191328c36f3a611f35b",
  "MÁSCARA HIDRATAÇÃO NEUTRO 500G": "6a5133a1328c36f3a611f35d",
  "MÁSCARA HIDRATAÇÃO CEREJA & AVELÃ 1KG": "6a513440328c36f3a611f35e",
  "MÁSCARA HIDRATAÇÃO LICHIA & ROMÃ 1KG": "6a513576328c36f3a611f35f",
  "MÁSCARA HIDRATAÇÃO MELANCIA 1KG": "6a513622328c36f3a611f361",
  "MÁSCARA HIDRATAÇÃO NEUTRO 1KG": "6a5135db328c36f3a611f360",
  "LIMPA ORELHA THE LUXE 500ML": "6a5139aa328c36f3a611f369",
  "HIDRATANTE PATINHAS THE LUXE 120ML": "6a513b5c328c36f3a611f36c",
});

const normalizarTexto = (valor = "") =>
  String(valor)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .normalize("NFC")
    .toLocaleLowerCase("pt-BR")
    .replace(/\bc\s*\//g, " com ")
    .replace(/&/g, " e ")
    .replace(/(\d)\s*:\s*(\d)/g, "$1:$2")
    .replace(/(\d)\s+(ml|kg|l|g)\b/g, "$1$2")
    .replace(/[^a-z0-9:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizarLinha = (valor = "") => {
  const linha = normalizarTexto(valor);

  if (["the luxe", "the luxe premium", "deluxe"].includes(linha)) {
    return "the luxe";
  }

  if (["vanity", "vanity pet"].includes(linha)) {
    return "vanity pet";
  }

  if (
    [
      "dream color",
      "dream color care",
      "dream color line",
      "dream color line care",
    ].includes(linha)
  ) {
    return "dream color";
  }

  return linha;
};

const linhaEsperada = (linhaOrigem) => {
  if (linhaOrigem.startsWith("DREAM COLOR")) {
    return "dream color";
  }

  return normalizarLinha(linhaOrigem);
};

const montarNome = ({ nomeBase, diluicao, embalagem }) =>
  [nomeBase, diluicao, embalagem]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const extrairEmbalagem = (valor) =>
  normalizarTexto(valor).match(/\b\d+(?:[.,]\d+)?(?:ml|kg|l|g)\b/)?.[0] ||
  null;

const extrairDiluicao = (valor) =>
  normalizarTexto(valor).match(/\b\d+:\d+\b/)?.[0] || null;

const removerMarcadoresDaLinha = (valor, linhaOrigem) => {
  let resultado = normalizarTexto(valor);

  if (linhaOrigem === "THE LUXE PREMIUM") {
    resultado = resultado.replace(/\bthe luxe\b/g, " ");
  }

  if (linhaOrigem === "DREAM COLOR LINE CARE") {
    resultado = resultado.replace(/\bdream color line care\b/g, " ");
  }

  return resultado.replace(/\s+/g, " ").trim();
};

const identidadeCompativel = (produto, registro) => {
  const nomeEsperado = montarNome(registro);
  const embalagemEsperada = normalizarTexto(registro.embalagem);
  const embalagemProduto = extrairEmbalagem(produto.nome);
  const diluicaoEsperada = registro.diluicao
    ? normalizarTexto(registro.diluicao)
    : null;
  const diluicaoProduto = extrairDiluicao(produto.nome);

  if (embalagemProduto !== embalagemEsperada) {
    return false;
  }

  const aliasZoomPreLavagem =
    registro.linhaOrigem === "ZOOM" &&
    normalizarTexto(registro.nomeBase) ===
      normalizarTexto("SHAMPOO ZOOM PRE-LAVAGEM") &&
    diluicaoEsperada === "1:4" &&
    diluicaoProduto === null;

  if (!aliasZoomPreLavagem && diluicaoProduto !== diluicaoEsperada) {
    return false;
  }

  const esperado = removerMarcadoresDaLinha(nomeEsperado, registro.linhaOrigem);
  let candidato = removerMarcadoresDaLinha(
    produto.nome,
    registro.linhaOrigem
  );

  if (aliasZoomPreLavagem) {
    candidato = candidato.replace(/\b1:4\b/g, " ").replace(/\s+/g, " ").trim();
    return candidato === esperado.replace(/\b1:4\b/g, " ").replace(/\s+/g, " ").trim();
  }

  return candidato === esperado;
};

const classificacaoCorrespondencia = (produto, registro) => {
  const esperado = montarNome(registro);
  const nomeProduto = String(produto.nome || "").replace(/\s+/g, " ").trim();

  if (nomeProduto.toLocaleLowerCase("pt-BR") === esperado.toLocaleLowerCase("pt-BR")) {
    return "exata";
  }

  return "normalizada";
};

export const localizarProdutoAtacado = (produtos, registro) => {
  const nomePdf = montarNome(registro);
  const aliasId = ALIASES_EXPLICITOS_ATACADO[nomePdf];

  if (aliasId) {
    const produtoAlias = produtos.find(
      (produto) => String(produto._id) === aliasId
    );

    if (!produtoAlias) {
      return {
        produto: null,
        tipo: null,
        candidatas: [],
        bloqueio: `Alias explicito aponta para produto ausente ou inativo: ${aliasId}`,
      };
    }

    if (
      normalizarLinha(produtoAlias.linha) !== linhaEsperada(registro.linhaOrigem) ||
      extrairEmbalagem(produtoAlias.nome) !== normalizarTexto(registro.embalagem)
    ) {
      return {
        produto: null,
        tipo: null,
        candidatas: [],
        bloqueio: `Alias explicito incompativel com linha ou embalagem: ${aliasId}`,
      };
    }

    return {
      produto: produtoAlias,
      tipo: "alias",
      candidatas: [],
      aliasId,
    };
  }

  const linha = linhaEsperada(registro.linhaOrigem);
  const candidatas = produtos.filter(
    (produto) =>
      normalizarLinha(produto.linha) === linha &&
      identidadeCompativel(produto, registro)
  );

  if (candidatas.length === 1) {
    return {
      produto: candidatas[0],
      tipo: classificacaoCorrespondencia(candidatas[0], registro),
      candidatas: [],
    };
  }

  if (candidatas.length > 1) {
    return { produto: null, tipo: null, candidatas };
  }

  const emOutraLinha = produtos.filter((produto) =>
    identidadeCompativel(produto, registro)
  );

  return { produto: null, tipo: null, candidatas: emOutraLinha };
};

const tabelaDescricao = (tabela) => ({
  _id: String(tabela._id),
  nome: tabela.nome,
  tipo: Object.hasOwn(tabela, "tipo") ? tabela.tipo : null,
  ativa: Object.hasOwn(tabela, "ativa") ? tabela.ativa : null,
});

export const identificarTabelaAtacado = (tabelas) => {
  const candidatas = tabelas.filter((tabela) => {
    const nome = normalizarTexto(tabela.nome);
    const tipo = normalizarTexto(tabela.tipo);
    return tipo === "atacado" || nome.split(" ").includes("atacado");
  });

  if (candidatas.length === 0) {
    throw new Error("Nenhuma tabela de preco Atacado foi encontrada");
  }

  if (candidatas.length > 1) {
    throw new Error(
      `Mais de uma tabela pode ser Atacado: ${candidatas
        .map((tabela) => `${tabela.nome} (${String(tabela._id)})`)
        .join(" | ")}`
    );
  }

  if (candidatas[0].ativa !== true) {
    throw new Error(
      `A tabela Atacado encontrada nao esta ativa: ${candidatas[0].nome}`
    );
  }

  return candidatas[0];
};

const chavePreco = (produtoId) => String(produtoId);

const mapearPrecosExistentes = (precos) => {
  const porProduto = new Map();
  const duplicados = [];

  for (const preco of precos) {
    const chave = chavePreco(preco.produtoId);

    if (porProduto.has(chave)) {
      duplicados.push({
        produtoId: chave,
        precoIds: [String(porProduto.get(chave)._id), String(preco._id)],
      });
      continue;
    }

    porProduto.set(chave, preco);
  }

  return { porProduto, duplicados };
};

const criarIdentidadePdf = (registro) =>
  `${linhaEsperada(registro.linhaOrigem)}:${normalizarTexto(montarNome(registro))}`;

export const validarDatasetAtacado = (
  registros = produtosAtacadoJunho2026,
  promocionais = promocionaisAtacadoIgnorados
) => {
  const erros = [];
  const identidades = new Set();

  for (const [indice, registro] of registros.entries()) {
    const identidade = criarIdentidadePdf(registro);

    if (identidades.has(identidade)) {
      erros.push(`Linha ${indice + 1}: produto duplicado (${montarNome(registro)})`);
    }
    identidades.add(identidade);

    if (
      !registro.nomeBase ||
      !registro.embalagem ||
      !registro.linhaOrigem ||
      typeof registro.valorAtacado !== "number" ||
      !Number.isFinite(registro.valorAtacado) ||
      registro.valorAtacado < 0
    ) {
      erros.push(`Linha ${indice + 1}: registro invalido`);
    }
  }

  if (registros.length !== origemPrecosAtacado.registrosImportaveis) {
    erros.push(
      `Esperadas ${origemPrecosAtacado.registrosImportaveis} linhas uteis, ` +
        `recebidas ${registros.length}`
    );
  }

  if (promocionais.length !== origemPrecosAtacado.promocionaisIgnorados) {
    erros.push(
      `Esperados ${origemPrecosAtacado.promocionaisIgnorados} promocionais, ` +
        `recebidos ${promocionais.length}`
    );
  }

  if (
    registros.length + promocionais.length !==
    origemPrecosAtacado.linhasPrecoExtraidas
  ) {
    erros.push("A soma de linhas uteis e promocionais nao fecha com o PDF");
  }

  const identidadesDataset = new Set(registros.map(montarNome));

  for (const [nome, produtoId] of Object.entries(ALIASES_EXPLICITOS_ATACADO)) {
    if (!identidadesDataset.has(nome)) {
      erros.push(`Alias explicito nao existe no dataset: ${nome}`);
    }

    if (!mongoose.isValidObjectId(produtoId)) {
      erros.push(`Alias explicito possui ObjectId invalido: ${nome}`);
    }
  }

  return erros;
};

const analisarPromocionais = (produtos, precosPorProduto) =>
  promocionaisAtacadoIgnorados.map((registro) => {
    const nome = montarNome(registro);
    const candidatas = produtos.filter((produto) =>
      identidadeCompativel(produto, {
        ...registro,
        linhaOrigem: normalizarLinha(produto.linha),
      })
    );

    if (candidatas.length === 0) {
      return { item: nome, situacao: "ignorado; nao encontrado no catalogo" };
    }

    if (candidatas.length > 1) {
      return {
        item: nome,
        situacao: "ignorado; correspondencia ambigua no catalogo",
        candidatas: candidatas.map((produto) => produto.nome),
      };
    }

    return {
      item: nome,
      situacao: "ignorado; produto encontrado no catalogo",
      produto: candidatas[0].nome,
      possuiPrecoAtacado: precosPorProduto.has(chavePreco(candidatas[0]._id)),
    };
  });

export const planejarImportacaoAtacado = ({
  tabela,
  produtos,
  precos,
  registros = produtosAtacadoJunho2026,
}) => {
  const { porProduto: precosPorProduto, duplicados } =
    mapearPrecosExistentes(precos);
  const relatorio = {
    modo: "SIMULACAO",
    origem: origemPrecosAtacado,
    tabela: {
      ...tabelaDescricao(tabela),
      precosVinculados: precos.length,
    },
    linhasPrecoExtraidas: origemPrecosAtacado.linhasPrecoExtraidas,
    linhasUteis: registros.length,
    encontradosExatamente: [],
    encontradosPorNormalizacao: [],
    encontradosPorAliasExplicito: [],
    naoEncontrados: [],
    ambiguos: [],
    produtosBloqueandoAplicacao: [],
    duplicadosNoPdf: [],
    precosDuplicadosNoBanco: duplicados,
    precos: {
      existentesEntreCorrespondencias: 0,
      criar: 0,
      atualizar: 0,
      inalterados: 0,
    },
    precosAtuaisVinculados: [],
    diferencasPreco: [],
    promocionais: [],
    produtosDasLinhasSemCorrespondencia: [],
  };
  const identidades = new Map();
  const produtosCorrespondidos = new Set();
  const plano = [];
  const produtosPorId = new Map(
    produtos.map((produto) => [String(produto._id), produto])
  );
  const produtosAtivos = produtos.filter((produto) => produto.ativo === true);

  relatorio.precosAtuaisVinculados = precos.map((preco) => {
    const produto = produtosPorId.get(String(preco.produtoId));

    return {
      precoId: String(preco._id),
      produtoId: String(preco.produtoId),
      produto: produto?.nome || "produto nao encontrado",
      valor: Number(preco.valor),
    };
  });

  for (const registro of registros) {
    const nome = montarNome(registro);
    const identidade = criarIdentidadePdf(registro);

    if (identidades.has(identidade)) {
      relatorio.duplicadosNoPdf.push({
        item: nome,
        primeiraOcorrencia: identidades.get(identidade),
      });
      continue;
    }
    identidades.set(identidade, nome);

    const correspondencia = localizarProdutoAtacado(produtosAtivos, registro);

    if (correspondencia.candidatas.length > 0) {
      const ambiguidade = {
        item: nome,
        candidatas: correspondencia.candidatas.map((produto) => ({
          _id: String(produto._id),
          nome: produto.nome,
          linha: produto.linha,
        })),
      };
      relatorio.ambiguos.push(ambiguidade);
      relatorio.produtosBloqueandoAplicacao.push({
        item: nome,
        motivo: "correspondencia ambigua",
      });
      continue;
    }

    if (!correspondencia.produto) {
      relatorio.naoEncontrados.push(nome);
      relatorio.produtosBloqueandoAplicacao.push({
        item: nome,
        motivo: correspondencia.bloqueio || "produto ativo nao encontrado",
      });
      continue;
    }

    const produto = correspondencia.produto;
    produtosCorrespondidos.add(String(produto._id));
    const campoRelatorio =
      correspondencia.tipo === "exata"
        ? "encontradosExatamente"
        : correspondencia.tipo === "alias"
          ? "encontradosPorAliasExplicito"
          : "encontradosPorNormalizacao";
    relatorio[campoRelatorio].push({
      _id: String(produto._id),
      pdf: nome,
      produto: produto.nome,
    });

    const precoExistente = precosPorProduto.get(chavePreco(produto._id));
    let acao = "criar";

    if (precoExistente) {
      relatorio.precos.existentesEntreCorrespondencias += 1;
      acao =
        Number(precoExistente.valor) === registro.valorAtacado
          ? "inalterado"
          : "atualizar";
    }

    if (acao === "inalterado") {
      relatorio.precos.inalterados += 1;
    } else {
      relatorio.precos[acao] += 1;
    }

    if (acao === "atualizar") {
      relatorio.diferencasPreco.push({
        produto: produto.nome,
        atual: Number(precoExistente.valor),
        pdf: registro.valorAtacado,
        diferenca: Number(
          (registro.valorAtacado - Number(precoExistente.valor)).toFixed(2)
        ),
      });
    }

    plano.push({
      produtoId: produto._id,
      produto: produto.nome,
      valor: registro.valorAtacado,
      acao,
    });
  }

  relatorio.promocionais = analisarPromocionais(
    produtosAtivos,
    precosPorProduto
  );

  const linhasDoPdf = new Set(registros.map((registro) => linhaEsperada(registro.linhaOrigem)));
  relatorio.produtosDasLinhasSemCorrespondencia = produtosAtivos
    .filter(
      (produto) =>
        linhasDoPdf.has(normalizarLinha(produto.linha)) &&
        !produtosCorrespondidos.has(String(produto._id))
    )
    .map((produto) => ({
      _id: String(produto._id),
      nome: produto.nome,
      linha: produto.linha,
    }));

  return { plano, relatorio };
};

const validarFlags = () => {
  const argumentos = new Set(process.argv.slice(2));
  const permitidos = new Set(["--apply", "--permitir-producao"]);
  const desconhecidos = [...argumentos].filter((item) => !permitidos.has(item));

  if (desconhecidos.length > 0) {
    throw new Error(`Argumentos desconhecidos: ${desconhecidos.join(", ")}`);
  }

  const aplicar = argumentos.has("--apply");
  const permitirProducao = argumentos.has("--permitir-producao");
  const ambiente = (process.env.NODE_ENV || "").trim().toLowerCase();

  if (permitirProducao && !aplicar) {
    throw new Error("--permitir-producao exige tambem --apply");
  }

  if (
    aplicar &&
    !AMBIENTES_GRAVACAO_DIRETA.has(ambiente) &&
    !permitirProducao
  ) {
    throw new Error(
      "Gravacao fora de development/test/staging exige --permitir-producao"
    );
  }

  return { aplicar, ambiente: ambiente || "nao definido" };
};

const carregarEstado = async (session = null) => {
  const consultaTabelas = TabelaPreco.find({})
    .select("_id nome tipo ativa")
    .lean();
  const consultaProdutos = Produto.find({})
    .select("_id nome linha categoria ativo")
    .lean();

  if (session) {
    consultaTabelas.session(session);
    consultaProdutos.session(session);
  }

  const [tabelas, produtos] = await Promise.all([
    consultaTabelas,
    consultaProdutos,
  ]);
  const tabela = identificarTabelaAtacado(tabelas);
  const consultaPrecos = PrecoProduto.find({ tabelaPrecoId: tabela._id })
    .select("_id produtoId tabelaPrecoId valor")
    .lean();

  if (session) {
    consultaPrecos.session(session);
  }

  const precos = await consultaPrecos;
  return { tabela, produtos, precos };
};

const imprimirLista = (titulo, itens) => {
  console.log(`\n${titulo}:`);

  if (itens.length === 0) {
    console.log("- nenhum");
    return;
  }

  for (const item of itens) {
    console.log(`- ${typeof item === "string" ? item : JSON.stringify(item)}`);
  }
};

const imprimirRelatorio = (relatorio, ambiente) => {
  console.log("=== IMPORTACAO DE PRECOS ATACADO 06/2026 ===");
  console.log(`Modo: ${relatorio.modo}`);
  console.log(`NODE_ENV: ${ambiente}`);
  console.log(`Fonte: ${relatorio.origem.arquivo}`);
  console.log(`Coluna utilizada: ${relatorio.origem.colunaPreco}`);
  console.log(`Tabela Atacado: ${relatorio.tabela.nome}`);
  console.log(`ID: ${relatorio.tabela._id}`);
  console.log(`Tipo: ${relatorio.tabela.tipo ?? "ausente"}`);
  console.log(`Ativa: ${relatorio.tabela.ativa}`);
  console.log(`Precos atualmente vinculados: ${relatorio.tabela.precosVinculados}`);
  console.log(`Total de linhas de preco extraidas: ${relatorio.linhasPrecoExtraidas}`);
  console.log(`Linhas uteis: ${relatorio.linhasUteis}`);
  console.log(`Produtos encontrados exatamente: ${relatorio.encontradosExatamente.length}`);
  console.log(
    `Produtos encontrados por normalizacao segura: ${relatorio.encontradosPorNormalizacao.length}`
  );
  console.log(
    `Produtos encontrados por alias explicito: ${relatorio.encontradosPorAliasExplicito.length}`
  );
  console.log(`Produtos nao encontrados: ${relatorio.naoEncontrados.length}`);
  console.log(`Produtos ambiguos: ${relatorio.ambiguos.length}`);
  console.log(`Produtos duplicados no PDF: ${relatorio.duplicadosNoPdf.length}`);
  console.log(
    `Precos existentes entre os produtos correspondidos: ${relatorio.precos.existentesEntreCorrespondencias}`
  );
  console.log(`Precos que seriam criados: ${relatorio.precos.criar}`);
  console.log(`Precos que seriam atualizados: ${relatorio.precos.atualizar}`);
  console.log(`Precos que permaneceriam iguais: ${relatorio.precos.inalterados}`);
  console.log(
    `Produtos bloqueando o --apply: ${relatorio.produtosBloqueandoAplicacao.length}`
  );

  imprimirLista("Produtos nao encontrados", relatorio.naoEncontrados);
  imprimirLista("Produtos ambiguos", relatorio.ambiguos);
  imprimirLista(
    "Produtos bloqueando o --apply",
    relatorio.produtosBloqueandoAplicacao
  );
  imprimirLista("Produtos duplicados no PDF", relatorio.duplicadosNoPdf);
  imprimirLista("Precos duplicados no banco", relatorio.precosDuplicadosNoBanco);
  imprimirLista("Precos atualmente vinculados", relatorio.precosAtuaisVinculados);
  imprimirLista("Diferencas de preco", relatorio.diferencasPreco);
  imprimirLista(
    "Produtos das linhas do PDF sem correspondencia",
    relatorio.produtosDasLinhasSemCorrespondencia
  );
  imprimirLista(
    "Produtos promocionais / bonificacoes (sempre ignorados)",
    relatorio.promocionais
  );
};

const validarPlanoParaAplicacao = (relatorio) => {
  if (relatorio.duplicadosNoPdf.length > 0) {
    throw new Error("Aplicacao bloqueada: existem produtos duplicados no PDF");
  }

  if (relatorio.precosDuplicadosNoBanco.length > 0) {
    throw new Error("Aplicacao bloqueada: existem precos duplicados no banco");
  }

  if (relatorio.ambiguos.length > 0) {
    throw new Error("Aplicacao bloqueada: existem correspondencias ambiguas");
  }

  if (relatorio.produtosBloqueandoAplicacao.length > 0) {
    throw new Error(
      "Aplicacao bloqueada: existem produtos sem correspondencia aprovada"
    );
  }
};

export const executarImportacaoPrecosAtacado = async () => {
  const { aplicar, ambiente } = validarFlags();
  const errosDataset = validarDatasetAtacado();

  if (errosDataset.length > 0) {
    throw new Error(`Dataset Atacado invalido:\n- ${errosDataset.join("\n- ")}`);
  }

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI nao configurada");
  }

  await mongoose.connect(process.env.MONGO_URI, {
    autoIndex: false,
    maxPoolSize: 3,
    serverSelectionTimeoutMS: 10000,
  });

  const estado = await carregarEstado();
  const inicial = planejarImportacaoAtacado(estado);
  inicial.relatorio.modo = aplicar ? "APLICACAO PENDENTE" : "SIMULACAO";
  imprimirRelatorio(inicial.relatorio, ambiente);

  if (!aplicar) {
    console.log("\nSimulacao concluida. Nenhum dado foi gravado.");
    return inicial.relatorio;
  }

  validarPlanoParaAplicacao(inicial.relatorio);
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });

  if (!hello.setName && hello.msg !== "isdbgrid") {
    throw new Error(
      "Aplicacao bloqueada: o MongoDB conectado nao oferece transacoes"
    );
  }

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const estadoAtual = await carregarEstado(session);

      if (String(estadoAtual.tabela._id) !== inicial.relatorio.tabela._id) {
        throw new Error("A tabela Atacado mudou desde a simulacao inicial");
      }

      const atual = planejarImportacaoAtacado(estadoAtual);
      validarPlanoParaAplicacao(atual.relatorio);
      const operacoes = atual.plano
        .filter((item) => item.acao !== "inalterado")
        .map((item) => ({
          updateOne: {
            filter: {
              tabelaPrecoId: estadoAtual.tabela._id,
              produtoId: item.produtoId,
            },
            update: { $set: { valor: item.valor } },
            upsert: true,
          },
        }));

      if (operacoes.length > 0) {
        await PrecoProduto.bulkWrite(operacoes, { ordered: true, session });
      }
    });
  } finally {
    await session.endSession();
  }

  console.log("Importacao de precos Atacado concluida com sucesso.");
  return inicial.relatorio;
};

const executadoDiretamente =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executadoDiretamente) {
  executarImportacaoPrecosAtacado()
    .catch((error) => {
      const mensagem = String(error?.message || "Falha na importacao").replace(
        process.env.MONGO_URI || "__MONGO_URI_AUSENTE__",
        "[MONGO_URI ocultada]"
      );
      console.error(`Importacao interrompida: ${mensagem}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
