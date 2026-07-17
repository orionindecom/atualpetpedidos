import dotenv from "dotenv";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import { connectDB } from "../config/db.js";
import TabelaPreco from "../models/TabelaPreco.js";

dotenv.config({ quiet: true });

const DISTRIBUIDOR_ID = "6a30776bb1e48bd024a5db13";
const DISTRIBUIDOR_NOME = "Distribuidor 2026";
const ATACADO_NOME = "Atacado 2026";
const CLIENTE_FINAL_LOJA = {
  nome: "Cliente Final - Loja Física",
  descricao:
    "Tabela de preços sugeridos para venda ao cliente final em loja física",
  tipo: "cliente_final_loja",
  ativa: true,
};
const NOMES_CLIENTE_FINAL_LOJA = new Set([
  "cliente final loja",
  "cliente final loja fisica",
  "loja fisica",
]);
const AMBIENTES_GRAVACAO_DIRETA = new Set([
  "development",
  "test",
  "staging",
]);

const normalizarNome = (valor = "") =>
  String(valor)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const possuiTipo = (tabela) =>
  Object.prototype.hasOwnProperty.call(tabela, "tipo") &&
  tabela.tipo !== null &&
  tabela.tipo !== "";

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

const descricaoTabela = (tabela) =>
  `${tabela.nome} (${String(tabela._id)}, tipo: ${tabela.tipo ?? "ausente"}, ` +
  `ativa: ${tabela.ativa ?? "ausente"})`;

export const planejarPreparacaoTabelas = (tabelas) => {
  const erros = [];
  const acoes = [];
  const distribuidor = tabelas.find(
    (tabela) => String(tabela._id) === DISTRIBUIDOR_ID
  );

  if (!distribuidor) {
    erros.push(`Tabela Distribuidor nao encontrada pelo _id ${DISTRIBUIDOR_ID}`);
  } else {
    if (distribuidor.nome !== DISTRIBUIDOR_NOME) {
      erros.push(
        `Nome incompatível no _id do Distribuidor: esperado "${DISTRIBUIDOR_NOME}", ` +
          `encontrado "${distribuidor.nome}"`
      );
    }

    if (possuiTipo(distribuidor) && distribuidor.tipo !== "distribuidor") {
      erros.push(
        `Tabela ${DISTRIBUIDOR_NOME} possui tipo conflitante: ${distribuidor.tipo}`
      );
    }
  }

  const outrosDistribuidores = tabelas.filter(
    (tabela) =>
      String(tabela._id) !== DISTRIBUIDOR_ID &&
      tabela.tipo === "distribuidor"
  );

  if (outrosDistribuidores.length > 0) {
    erros.push(
      `Ja existe outra tabela com tipo distribuidor: ${outrosDistribuidores
        .map(descricaoTabela)
        .join(" | ")}`
    );
  }

  if (
    distribuidor &&
    distribuidor.nome === DISTRIBUIDOR_NOME &&
    !possuiTipo(distribuidor)
  ) {
    acoes.push({
      acao: "definir_tipo",
      tabelaId: String(distribuidor._id),
      nome: distribuidor.nome,
      tipo: "distribuidor",
    });
  }

  const candidatasLoja = tabelas.filter(
    (tabela) =>
      tabela.tipo === "cliente_final_loja" ||
      NOMES_CLIENTE_FINAL_LOJA.has(normalizarNome(tabela.nome))
  );

  if (candidatasLoja.length > 1) {
    erros.push(
      `Mais de uma candidata a Cliente Final Loja: ${candidatasLoja
        .map(descricaoTabela)
        .join(" | ")}`
    );
  }

  const clienteFinalLoja = candidatasLoja[0] || null;

  if (clienteFinalLoja) {
    if (normalizarNome(clienteFinalLoja.nome) === normalizarNome(ATACADO_NOME)) {
      erros.push(
        `A tabela ${ATACADO_NOME} nao pode ser reutilizada como Cliente Final Loja`
      );
    }

    if (
      possuiTipo(clienteFinalLoja) &&
      clienteFinalLoja.tipo !== "cliente_final_loja"
    ) {
      erros.push(
        `Candidata ${clienteFinalLoja.nome} possui tipo conflitante: ` +
          clienteFinalLoja.tipo
      );
    }

    if (clienteFinalLoja.ativa !== true) {
      erros.push(
        `Candidata ${clienteFinalLoja.nome} nao esta ativa e o campo ativa nao sera alterado`
      );
    }

    if (!possuiTipo(clienteFinalLoja)) {
      acoes.push({
        acao: "definir_tipo",
        tabelaId: String(clienteFinalLoja._id),
        nome: clienteFinalLoja.nome,
        tipo: "cliente_final_loja",
      });
    }
  } else {
    acoes.push({
      acao: "criar_cliente_final_loja",
      dados: { ...CLIENTE_FINAL_LOJA },
    });
  }

  const tabelasInternetAtivas = tabelas.filter(
    (tabela) =>
      tabela.tipo === "cliente_final_internet" && tabela.ativa === true
  );

  if (tabelasInternetAtivas.length !== 1) {
    erros.push(
      "Esperada exatamente 1 tabela ativa com tipo cliente_final_internet, " +
        `encontradas ${tabelasInternetAtivas.length}`
    );
  }

  const tabelasAtacado = tabelas.filter(
    (tabela) => normalizarNome(tabela.nome) === normalizarNome(ATACADO_NOME)
  );

  if (tabelasAtacado.length !== 1) {
    erros.push(
      `Esperada exatamente 1 tabela "${ATACADO_NOME}" para preservacao, ` +
        `encontradas ${tabelasAtacado.length}`
    );
  }

  if (erros.length > 0) {
    throw new Error(`Conflitos encontrados:\n- ${erros.join("\n- ")}`);
  }

  return {
    distribuidor,
    clienteFinalLoja,
    clienteFinalInternet: tabelasInternetAtivas[0],
    atacado: tabelasAtacado[0],
    acoes,
  };
};

const carregarPlanejamento = async (session = null) => {
  const consulta = TabelaPreco.find({}).lean();

  if (session) {
    consulta.session(session);
  }

  return planejarPreparacaoTabelas(await consulta);
};

const imprimirPlanejamento = (planejamento, modo, ambiente) => {
  const acaoDistribuidor = planejamento.acoes.find(
    (acao) =>
      acao.acao === "definir_tipo" && acao.tabelaId === DISTRIBUIDOR_ID
  );
  const acaoLoja = planejamento.acoes.find(
    (acao) =>
      acao.tipo === "cliente_final_loja" ||
      acao.acao === "criar_cliente_final_loja"
  );

  console.log("=== PREPARACAO DE TABELAS DO DISTRIBUIDOR ===");
  console.log(`Modo: ${modo}`);
  console.log(`NODE_ENV: ${ambiente}`);
  console.log(
    `Tabela Distribuidor encontrada: ${descricaoTabela(planejamento.distribuidor)}`
  );
  console.log(
    `Alteracao planejada no tipo: ${
      acaoDistribuidor ? 'tipo -> "distribuidor"' : "nenhuma; tipo ja correto"
    }`
  );

  if (planejamento.clienteFinalLoja) {
    console.log(
      `Tabela Cliente Final Loja encontrada: ${descricaoTabela(
        planejamento.clienteFinalLoja
      )}`
    );
    console.log(
      `Alteracao planejada para Cliente Final Loja: ${
        acaoLoja ? 'tipo -> "cliente_final_loja"' : "nenhuma"
      }`
    );
  } else {
    console.log(
      `Tabela Cliente Final Loja planejada para criacao: ${JSON.stringify(
        CLIENTE_FINAL_LOJA
      )}`
    );
  }

  console.log(
    `Tabela Cliente Final Internet encontrada: ${descricaoTabela(
      planejamento.clienteFinalInternet
    )}`
  );
  console.log(`Tabela Atacado preservada: ${descricaoTabela(planejamento.atacado)}`);
};

const aplicarPlanejamento = async (planejamento, session = null) => {
  for (const acao of planejamento.acoes) {
    if (acao.acao === "definir_tipo") {
      const resultado = await TabelaPreco.updateOne(
        {
          _id: acao.tabelaId,
          nome: acao.nome,
          $or: [
            { tipo: { $exists: false } },
            { tipo: null },
            { tipo: "" },
          ],
        },
        { $set: { tipo: acao.tipo } },
        { runValidators: true, session }
      );

      if (resultado.matchedCount !== 1) {
        throw new Error(
          `Tabela ${acao.nome} mudou desde a simulacao; nenhuma alteracao aplicada`
        );
      }
    }

    if (acao.acao === "criar_cliente_final_loja") {
      await TabelaPreco.create([acao.dados], { session });
    }
  }
};

const suportaTransacoes = async () => {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  return Boolean(hello.setName || hello.msg === "isdbgrid");
};

export const executarPreparacao = async () => {
  const { gravar, ambiente } = validarFlags();

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI nao configurada");
  }

  await connectDB();
  const planejamento = await carregarPlanejamento();
  imprimirPlanejamento(
    planejamento,
    gravar ? "GRAVACAO" : "SIMULACAO",
    ambiente
  );

  if (!gravar) {
    console.log("Simulacao concluida. Nenhum dado foi alterado.");
    return;
  }

  if (await suportaTransacoes()) {
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const planejamentoAtual = await carregarPlanejamento(session);
        await aplicarPlanejamento(planejamentoAtual, session);
      });
    } finally {
      await session.endSession();
    }
  } else {
    const planejamentoAtual = await carregarPlanejamento();
    await aplicarPlanejamento(planejamentoAtual);
  }

  console.log("Preparacao concluida com sucesso.");
};

const executadoDiretamente =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executadoDiretamente) {
  executarPreparacao()
    .catch((error) => {
      const mensagem = String(error?.message || "Falha na preparacao").replace(
        process.env.MONGO_URI || "__MONGO_URI_AUSENTE__",
        "[MONGO_URI ocultada]"
      );
      console.error(`Preparacao interrompida: ${mensagem}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
