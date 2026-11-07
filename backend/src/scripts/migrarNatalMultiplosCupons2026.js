// Migração para múltiplos cupons por cadastro no Natal Premiado 2026.
// Passo a passo completo em NATAL_MULTIPLOS_CUPONS_2026.md. Execute a partir de backend/.
//
// Somente leitura (padrão):
//   node src/scripts/migrarNatalMultiplosCupons2026.js
//       Relatório: o que será feito, duplicidades, invariantes e se a migração é possível.
//   node src/scripts/migrarNatalMultiplosCupons2026.js --conferir
//       Só as invariantes (cupons, saldos, numeração, vínculos).
//   node src/scripts/migrarNatalMultiplosCupons2026.js --backup=<pasta>
//       Exporta as coleções da campanha (leitura em snapshot), com índices e manifesto.
//   node src/scripts/migrarNatalMultiplosCupons2026.js --verificar-backup=<pasta>
//       Restaura o backup num MongoDB em memória e confere documentos e índices.
//   node src/scripts/migrarNatalMultiplosCupons2026.js --simular-em-copia
//       Copia os dados para um MongoDB em memória e executa todas as etapas lá, duas vezes.
//
// Com gravação: exigem --operador=<nome> e --confirmar=<nome-do-banco>. Não execute
// em produção sem autorização.
//   --migrar                  Etapa 1: lotes históricos, chaves de documento, índices.
//   --ativar                  Etapa 2: libera vários cupons por envio e a adição de cupons.
//   --desativar --motivo=<t>  Reversão: volta a 1 cupom por envio, sem apagar nada.
//
// Opção: --relatorio=<arquivo.json> grava o resultado em arquivo.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const argumentos = process.argv.slice(2);
const opcao = (nome) => {
  const encontrado = argumentos.find((item) => item === `--${nome}` || item.startsWith(`--${nome}=`));
  if (!encontrado) return undefined;
  return encontrado.includes("=") ? encontrado.slice(encontrado.indexOf("=") + 1) : true;
};

const COLECOES_CAMPANHA = [
  "natallotes", "natalparticipacaos", "natalcupoms", "natalauditorias", "natalcampanhaestados", "natalexportacaos",
  "natalcontas", "natalmovimentocupoms", "natalbonificacaos", "natalcompraexternas", "natalmigracaoexecucaos",
  "natalsubstituicaocompras", "nataldistribuicaos",
];
const COMANDOS_DE_ESCRITA = new Set([
  "insert", "update", "delete", "findAndModify", "findandmodify", "create", "createIndexes",
  "drop", "dropDatabase", "dropIndexes", "renameCollection", "bulkWrite",
]);

const travarEscrita = (client) => {
  client.on("commandStarted", (evento) => {
    if (COMANDOS_DE_ESCRITA.has(evento.commandName)) {
      console.error(`Bloqueado: comando de escrita "${evento.commandName}" em modo somente leitura.`);
      process.exit(2);
    }
  });
};

const uriDeOrigem = () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI não definido.");
  return process.env.MONGO_URI;
};

const conectarSomenteLeitura = async () => {
  await mongoose.connect(uriDeOrigem(), { autoIndex: false, autoCreate: false, monitorCommands: true, readPreference: "secondaryPreferred" });
  travarEscrita(mongoose.connection.getClient());
};

const gravarRelatorio = (relatorio) => {
  const destino = opcao("relatorio");
  const texto = JSON.stringify(relatorio, null, 2);
  if (typeof destino === "string") {
    fs.writeFileSync(destino, texto);
    console.log(`Relatório gravado em ${destino}`);
  } else {
    console.log(texto);
  }
};

const sha256 = (texto) => crypto.createHash("sha256").update(texto).digest("hex");

// Backup consistente (leitura em snapshot): documentos em EJSON canônico, índices e um
// manifesto com contagens e hashes, para conferência e restauração posterior.
const fazerBackup = async (pasta) => {
  const { EJSON } = mongoose.mongo.BSON;
  fs.mkdirSync(pasta, { recursive: true });
  const session = mongoose.connection.getClient().startSession({ snapshot: true });
  const manifesto = { geradoEm: new Date().toISOString(), banco: mongoose.connection.db.databaseName, leitura: "snapshot", colecoes: {} };
  try {
    for (const nome of COLECOES_CAMPANHA) {
      const colecao = mongoose.connection.db.collection(nome);
      const documentos = await colecao.find({}, { session }).sort({ _id: 1 }).toArray();
      const indices = await colecao.indexes().catch(() => []);
      const texto = EJSON.stringify(documentos, { relaxed: false });
      fs.writeFileSync(path.join(pasta, `${nome}.ejson`), texto);
      fs.writeFileSync(path.join(pasta, `${nome}.indexes.json`), JSON.stringify(indices, null, 2));
      manifesto.colecoes[nome] = { documentos: documentos.length, sha256: sha256(texto), indices: indices.map((item) => item.name) };
      console.log(`${nome}: ${documentos.length} documentos, ${indices.length} índices`);
    }
  } finally {
    await session.endSession();
  }
  fs.writeFileSync(path.join(pasta, "manifesto.json"), JSON.stringify(manifesto, null, 2));
  console.log(`Manifesto gravado em ${path.join(pasta, "manifesto.json")}`);
};

// Restaura o backup num MongoDB em memória e confere documento a documento, índices e
// contagens. Não toca no banco de origem.
const verificarBackup = async (pasta) => {
  const { EJSON } = mongoose.mongo.BSON;
  const { MongoMemoryReplSet } = await import("mongodb-memory-server");
  const manifesto = JSON.parse(fs.readFileSync(path.join(pasta, "manifesto.json"), "utf8"));
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const conexao = await mongoose.createConnection(replSet.getUri(), { dbName: "restauracao-natal" }).asPromise();
  const resultado = { pasta: path.basename(pasta), backupDe: manifesto.geradoEm, verificadoEm: new Date().toISOString(), colecoes: {}, ok: true };
  try {
    for (const [nome, esperado] of Object.entries(manifesto.colecoes)) {
      const texto = fs.readFileSync(path.join(pasta, `${nome}.ejson`), "utf8");
      const indices = JSON.parse(fs.readFileSync(path.join(pasta, `${nome}.indexes.json`), "utf8"));
      const documentos = EJSON.parse(texto, { relaxed: false });
      // Coleção vazia também existe na origem (com o índice _id_): cria antes de restaurar.
      if (indices.length > 0) await conexao.db.createCollection(nome).catch(() => {});
      const colecao = conexao.db.collection(nome);
      if (documentos.length > 0) await colecao.insertMany(documentos);
      for (const indice of indices.filter((item) => item.name !== "_id_")) {
        const { key, name, v, ns, ...opcoes } = indice;
        await colecao.createIndex(key, { name, ...opcoes });
      }
      const restaurados = await colecao.find({}).sort({ _id: 1 }).toArray();
      const nomesIndices = (await colecao.indexes().catch(() => [])).map((item) => item.name).sort();
      const linha = {
        documentos: restaurados.length,
        arquivoIntegro: sha256(texto) === esperado.sha256,
        conteudoIgual: sha256(EJSON.stringify(restaurados, { relaxed: false })) === esperado.sha256,
        indicesIguais: JSON.stringify(nomesIndices) === JSON.stringify([...esperado.indices].sort()) || (esperado.indices.length === 0 && nomesIndices.length <= 1),
      };
      linha.ok = linha.documentos === esperado.documentos && linha.arquivoIntegro && linha.conteudoIgual && linha.indicesIguais;
      if (!linha.ok) resultado.ok = false;
      resultado.colecoes[nome] = linha;
    }
  } finally {
    await conexao.close();
    await replSet.stop();
  }
  fs.writeFileSync(path.join(pasta, "verificacao.json"), JSON.stringify(resultado, null, 2));
  gravarRelatorio(resultado);
  if (!resultado.ok) process.exitCode = 1;
};

const simularEmCopia = async () => {
  const { MongoMemoryReplSet } = await import("mongodb-memory-server");
  const { MongoClient } = mongoose.mongo;
  const origem = new MongoClient(uriDeOrigem(), { monitorCommands: true, readPreference: "secondaryPreferred" });
  travarEscrita(origem);
  await origem.connect();
  const bancoOrigem = origem.db();
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: "simulacao-multiplos" });
  const destino = mongoose.connection.db;

  try {
    for (const nome of COLECOES_CAMPANHA) {
      const documentos = await bancoOrigem.collection(nome).find({}).toArray();
      if (documentos.length > 0) await destino.collection(nome).insertMany(documentos);
    }
    // Reproduz os índices de produção, inclusive o índice único antigo dos cupons.
    for (const nome of ["natalcupoms", "natalparticipacaos"]) {
      const indices = await bancoOrigem.collection(nome).indexes().catch(() => []);
      for (const indice of indices.filter((item) => item.name !== "_id_")) {
        const { key, name, v, ns, ...opcoes } = indice;
        await destino.collection(nome).createIndex(key, { name, ...opcoes });
      }
    }
    await origem.close();

    const servico = await import("../services/natalMultiplosCuponsService.js");
    const operador = "Simulação em cópia";
    const antes = await servico.analisarMultiplosCupons();
    const migracao = await servico.migrarMultiplosCupons({ operador });
    const repeticao = await servico.migrarMultiplosCupons({ operador });
    const ativacao = await servico.ativarMultiplosCupons({ operador });
    const depois = await servico.analisarMultiplosCupons();
    gravarRelatorio({
      antes,
      simulacao: {
        migracao,
        repeticaoSemEfeito: repeticao.lotesHistoricosCriados === 0 && repeticao.chavesDefinidas === 0 && repeticao.duplicidadesSinalizadas === 0,
        repeticao,
        ativacao,
        depois,
      },
    });
  } finally {
    await origem.close().catch(() => {});
    await mongoose.disconnect();
    await replSet.stop();
  }
};

const executarComGravacao = async (etapa) => {
  const operador = typeof opcao("operador") === "string" ? opcao("operador").trim() : "";
  if (operador.length < 3) throw new Error("Informe --operador=<nome do responsável>.");
  await mongoose.connect(uriDeOrigem(), { autoIndex: false });
  const banco = mongoose.connection.db.databaseName;
  if (opcao("confirmar") !== banco) {
    throw new Error(`Confirmação ausente. Informe --confirmar=${banco} para gravar neste banco.`);
  }
  const servico = await import("../services/natalMultiplosCuponsService.js");
  const etapas = {
    migrar: () => servico.migrarMultiplosCupons({ operador }),
    ativar: () => servico.ativarMultiplosCupons({ operador }),
    desativar: () => servico.desativarMultiplosCupons({ operador, motivo: opcao("motivo") }),
  };
  gravarRelatorio(await etapas[etapa]());
};

const principal = async () => {
  if (typeof opcao("verificar-backup") === "string") return verificarBackup(opcao("verificar-backup"));
  if (opcao("simular-em-copia")) return simularEmCopia();
  const etapa = ["migrar", "ativar", "desativar"].find((nome) => opcao(nome));
  if (etapa) return executarComGravacao(etapa);

  await conectarSomenteLeitura();
  const backup = opcao("backup");
  if (typeof backup === "string") return fazerBackup(backup);
  const servico = await import("../services/natalMultiplosCuponsService.js");
  if (opcao("conferir")) return gravarRelatorio(await servico.verificarInvariantes());
  return gravarRelatorio(await servico.analisarMultiplosCupons());
};

principal()
  .catch((error) => {
    console.error(error.message || "Falha na migração");
    if (error.problemas) console.error(JSON.stringify(error.problemas, null, 2));
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
