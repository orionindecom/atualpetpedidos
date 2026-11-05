// Ativação controlada do modelo cumulativo do Natal Premiado 2026.
// Passo a passo completo em NATAL_CUMULATIVO_2026.md. Execute a partir de backend/.
//
// Somente leitura (padrão):
//   node src/scripts/migrarNatalCumulativo2026.js
//       Simulação (dry-run) com relatório, divergências e conferência.
//   node src/scripts/migrarNatalCumulativo2026.js --conferir
//       Valida a integridade das contas.
//   node src/scripts/migrarNatalCumulativo2026.js --historico
//       Lista as execuções registradas.
//   node src/scripts/migrarNatalCumulativo2026.js --backup=<pasta>
//       Exporta as coleções da campanha em EJSON.
//   node src/scripts/migrarNatalCumulativo2026.js --simular-em-copia
//       Copia os dados para um MongoDB em memória e executa todas as etapas lá.
//
// Com gravação: exigem --operador=<nome> e --confirmar=<nome-do-banco>. Não execute
// em produção sem autorização.
//   --migrar                  Etapa 1: cria contas, sem conceder benefícios.
//   --conceder                Etapa 2: libera diferenças e calcula bonificações.
//   --ativar                  Etapa 3: passa a usar o saldo por distribuidor.
//   --reverter --motivo=<t>   Volta ao modelo legado, sem apagar registros.
//   --liberar-trava           Encerra uma etapa presa após queda do processo.
//
// Opção: --relatorio=<arquivo.json> grava o resultado em arquivo.

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
  "natalcontas", "natalmovimentocupoms", "natalbonificacaos", "natalcompraexternas", "natalmigracaoexecucaos", "natalsubstituicaocompras",
];
const COMANDOS_DE_ESCRITA = new Set([
  "insert", "update", "delete", "findAndModify", "findandmodify", "create", "createIndexes",
  "drop", "dropDatabase", "dropIndexes", "renameCollection", "bulkWrite",
]);

// Trava de segurança: encerra o processo antes de qualquer comando de escrita.
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
  if (typeof destino === "string") {
    fs.writeFileSync(destino, JSON.stringify(relatorio, null, 2));
    console.log(`Relatório gravado em ${destino}`);
  } else {
    console.log(JSON.stringify(relatorio, null, 2));
  }
};

const fazerBackup = async (pasta) => {
  const { EJSON } = mongoose.mongo.BSON;
  fs.mkdirSync(pasta, { recursive: true });
  for (const nome of COLECOES_CAMPANHA) {
    const documentos = await mongoose.connection.db.collection(nome).find({}).toArray();
    fs.writeFileSync(path.join(pasta, `${nome}.ejson`), EJSON.stringify(documentos, { relaxed: false }));
    console.log(`${nome}: ${documentos.length} documentos`);
  }
};

const simularEmCopia = async () => {
  const { MongoMemoryReplSet } = await import("mongodb-memory-server");
  const { MongoClient } = mongoose.mongo;

  const origem = new MongoClient(uriDeOrigem(), { monitorCommands: true, readPreference: "secondaryPreferred" });
  travarEscrita(origem);
  await origem.connect();
  const bancoOrigem = origem.db();
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: "simulacao-natal" });
  const destino = mongoose.connection.db;

  try {
    for (const nome of COLECOES_CAMPANHA) {
      const documentos = await bancoOrigem.collection(nome).find({}).toArray();
      if (documentos.length > 0) await destino.collection(nome).insertMany(documentos);
    }
    const inicio = new Date(process.env.NATAL2026_INICIO || "2026-11-03T03:00:00.000Z");
    const pedidos = await bancoOrigem.collection("pedidos").find({ createdAt: { $gte: inicio } }).toArray();
    if (pedidos.length > 0) await destino.collection("pedidos").insertMany(pedidos);
    const ids = [...new Set(pedidos.map((pedido) => String(pedido.clienteId)))].map((id) => new mongoose.Types.ObjectId(id));
    const usuarios = await bancoOrigem.collection("usuarios").find({ _id: { $in: ids } })
      .project({ nomeFantasia: 1, razaoSocial: 1, nomeResponsavel: 1, tipo: 1 }).toArray();
    if (usuarios.length > 0) await destino.collection("usuarios").insertMany(usuarios);
    await origem.close();

    const {
      analisarMigracao, ativarCumulativo, concederBeneficios, executarMigracao, fotografarDadosOriginais, validarIntegridade,
    } = await import("../services/natalMigracaoService.js");
    const { obterLotePublico } = await import("../services/natalParticipacaoService.js");
    const { previaSubstituicao } = await import("../services/natalSubstituicaoService.js");
    const { default: NatalConta } = await import("../models/NatalConta.js");
    const { default: NatalLote } = await import("../models/NatalLote.js");
    const { default: NatalMovimentoCupom } = await import("../models/NatalMovimentoCupom.js");

    const operador = "Simulação em cópia";
    const consultarLinks = async () => {
      const lotes = await NatalLote.find({}).select("codigoPublico numeroPedido").lean();
      const links = [];
      for (const lote of lotes) {
        const publico = await obterLotePublico(lote.codigoPublico);
        links.push({ pedido: lote.numeroPedido, resolve: Boolean(publico), aceitandoCadastros: publico?.aceitandoCadastros, motivo: publico?.motivo });
      }
      return links;
    };
    const fotoContas = async () => JSON.stringify(await NatalConta.find({}).select("clienteId cupons contadores").sort({ clienteId: 1 }).lean());

    const fotoAntes = await fotografarDadosOriginais();
    const antes = await analisarMigracao();
    const linksAntes = await consultarLinks();
    const migracao = await executarMigracao({ operador });
    const repeticaoMigracao = await executarMigracao({ operador });
    const concessao = await concederBeneficios({ operador });
    const contasPrimeira = await fotoContas();
    const movimentosPrimeira = await NatalMovimentoCupom.countDocuments({});
    const repeticaoConcessao = await concederBeneficios({ operador });
    const contasSegunda = await fotoContas();
    const ativacao = await ativarCumulativo({ operador });
    const fotoDepois = await fotografarDadosOriginais();

    const simbolicos = [...new Set(antes.divergencias.filter((item) => item.codigo === "pedido_simbolico").map((item) => item.pedido))];
    const previasSubstituicao = [];
    for (const numeroPedido of simbolicos) {
      const pedido = await mongoose.connection.db.collection("pedidos").findOne({ numeroPedido });
      const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
      previasSubstituicao.push(await previaSubstituicao({
        pedidoId: pedido._id,
        dados: { valor: pedido.valorTotal, data: hoje, referencia: "SIMULACAO-SEM-EFEITO" },
      }));
    }
    const contas = await NatalConta.find({}).lean();

    gravarRelatorio({
      ...antes,
      simulacao: {
        dadosOriginaisInalterados: fotoAntes === fotoDepois,
        repeticoesSemEfeito: repeticaoMigracao.movimentosCriados === 0 && repeticaoConcessao.cuponsLiberados === 0 &&
          contasPrimeira === contasSegunda && movimentosPrimeira === await NatalMovimentoCupom.countDocuments({}),
        migracao: { distribuidores: migracao.distribuidores, contasCriadas: migracao.contasCriadas, movimentosCriados: migracao.movimentosCriados },
        concessao: { cuponsLiberados: concessao.cuponsLiberados, concessoes: concessao.concessoes },
        ativacao: { cuponsLiberadosNaAtivacao: ativacao.cuponsLiberadosNaAtivacao },
        integridade: await validarIntegridade(),
        contas: contas.map((conta) => ({
          distribuidor: conta.distribuidorNome,
          cupons: conta.cupons,
          contadores: conta.contadores,
          acumulado: conta.acumulado,
          revisaoPendente: conta.revisaoPendente || null,
          linkProprio: Boolean(conta.codigoPublico),
        })),
        linksAntes,
        linksDepois: await consultarLinks(),
        previasSubstituicao,
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
  const servico = await import("../services/natalMigracaoService.js");
  const etapas = {
    migrar: () => servico.executarMigracao({ operador }),
    conceder: () => servico.concederBeneficios({ operador }),
    ativar: () => servico.ativarCumulativo({ operador }),
    reverter: () => servico.reverterModo({ operador, motivo: opcao("motivo") }),
    "liberar-trava": () => servico.liberarTrava(),
  };
  gravarRelatorio(await etapas[etapa]());
};

const principal = async () => {
  if (opcao("simular-em-copia")) return simularEmCopia();
  const etapa = ["migrar", "conceder", "ativar", "reverter", "liberar-trava"].find((nome) => opcao(nome));
  if (etapa) return executarComGravacao(etapa);

  await conectarSomenteLeitura();
  const backup = opcao("backup");
  if (typeof backup === "string") return fazerBackup(backup);
  const servico = await import("../services/natalMigracaoService.js");
  if (opcao("conferir")) return gravarRelatorio(await servico.validarIntegridade());
  if (opcao("historico")) return gravarRelatorio(await servico.listarExecucoes());
  return gravarRelatorio(await servico.analisarMigracao());
};

principal()
  .catch((error) => {
    console.error(error.message || "Falha na migração");
    if (error.problemas) console.error(JSON.stringify(error.problemas, null, 2));
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
