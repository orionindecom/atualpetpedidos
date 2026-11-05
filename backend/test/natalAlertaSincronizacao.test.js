import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import Pedido from "../src/models/Pedido.js";
import Usuario from "../src/models/Usuario.js";
import NatalAuditoria from "../src/models/NatalAuditoria.js";
import NatalBonificacao from "../src/models/NatalBonificacao.js";
import { NatalCampanhaEstado } from "../src/models/NatalCampanhaEstado.js";
import NatalConta from "../src/models/NatalConta.js";
import NatalMovimentoCupom from "../src/models/NatalMovimentoCupom.js";
import natalRoutes from "../src/routes/natalRoutes.js";
import { aprovarPedidoAdmin, atualizarStatusPedido } from "../src/controllers/pedidoController.js";
import { resetIndicesNatalParaTestes } from "../src/services/natalBaseService.js";

process.env.JWT_SECRET ||= "segredo-de-teste-com-mais-de-32-caracteres!!";

const CRIADO_EM = new Date("2026-11-10T13:00:00.000Z");
const COMANDOS_DE_ESCRITA = new Set(["insert", "update", "delete", "findAndModify", "findandmodify", "create", "createIndexes", "drop", "dropIndexes"]);
const escritas = [];
let replSet;
let server;
let base;

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: "natal-alerta", autoIndex: false, autoCreate: false, monitorCommands: true });
  mongoose.connection.getClient().on("commandStarted", (evento) => {
    if (COMANDOS_DE_ESCRITA.has(evento.commandName)) escritas.push(evento.commandName);
  });
  const app = express();
  app.use(express.json());
  app.use("/api/natal-2026", natalRoutes);
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/natal-2026`;
});

after(async () => {
  server?.close();
  await mongoose.disconnect();
  await replSet?.stop();
});

beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  resetIndicesNatalParaTestes();
  await NatalCampanhaEstado.create({ _id: "natal-2026", modoCumulativo: "ativo" });
});

let sequencia = 0;
const usuario = (tipo) => {
  sequencia += 1;
  return Usuario.create({
    nomeResponsavel: `${tipo} ${sequencia}`,
    nomeFantasia: tipo === "cliente" ? `Distribuidora ${sequencia}` : undefined,
    razaoSocial: tipo === "cliente" ? `Distribuidora ${sequencia} LTDA` : undefined,
    email: `${tipo}${sequencia}@alerta.local`,
    senha: "hash",
    tipo,
    statusCadastro: "aprovado",
  });
};

const resposta = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

const aprovar = async (admin, cliente, valor) => {
  sequencia += 1;
  const pedido = await Pedido.create({
    numeroPedido: `ALR-${sequencia}`,
    clienteId: cliente._id,
    nomeFantasiaCliente: cliente.nomeFantasia,
    razaoSocialCliente: cliente.razaoSocial,
    tabelaPrecoId: new mongoose.Types.ObjectId(),
    dia: 10, mes: 11, ano: 2026,
    itens: [{ produtoId: new mongoose.Types.ObjectId(), nomeProduto: "Shampoo", quantidade: 1, valorUnitario: valor, subtotal: valor }],
    valorTotal: valor,
    status: "aguardando_aprovacao",
    createdAt: CRIADO_EM,
  });
  const res = resposta();
  await aprovarPedidoAdmin({ usuario: admin, params: { id: String(pedido._id) } }, res);
  assert.equal(res.statusCode, 200, res.body?.message);
  return pedido;
};

const token = (u) => ({ Authorization: `Bearer ${jwt.sign({ id: u._id, tipo: u.tipo, tokenVersion: 0 }, process.env.JWT_SECRET, { algorithm: "HS256" })}` });

const pendencias = async (pessoa) => {
  const corpo = await fetch(`${base}/gestao/painel`, { headers: token(pessoa) }).then((r) => r.json());
  return corpo.pendenciasSincronizacao;
};

const reconciliar = async (admin) => {
  const res = await fetch(`${base}/gestao/reconciliar`, { method: "POST", headers: token(admin) });
  return { status: res.status, corpo: await res.json() };
};

// Falha a transação da campanha do distribuidor indicado (ou de todos).
const falharSincronizacao = (t, cliente) => {
  const original = NatalAuditoria.create.bind(NatalAuditoria);
  return t.mock.method(NatalAuditoria, "create", async (docs, opcoes) => {
    const primeiro = Array.isArray(docs) ? docs[0] : docs;
    if (!cliente || String(primeiro?.clienteId) === String(cliente._id)) throw new Error("falha simulada");
    return original(docs, opcoes);
  });
};

test("1. distribuidor com saldo correto não gera alerta", async () => {
  const admin = await usuario("admin");
  await aprovar(admin, await usuario("cliente"), 52000);
  assert.deepEqual(await pendencias(admin), []);
});

test("1b. pedido abaixo da faixa mínima não é pendência", async () => {
  const admin = await usuario("admin");
  await aprovar(admin, await usuario("cliente"), 5000);
  assert.deepEqual(await pendencias(admin), []);
});

test("1c. antes da ativação o alerta não aparece", async () => {
  const admin = await usuario("admin");
  await aprovar(admin, await usuario("cliente"), 12000);
  await NatalCampanhaEstado.updateOne({ _id: "natal-2026" }, { $set: { modoCumulativo: "legado" } });
  await NatalConta.deleteMany({});
  assert.deepEqual(await pendencias(admin), []);
});

test("1d. revisão pendente segue o fluxo próprio e não vira alerta de reconciliação", async () => {
  const admin = await usuario("admin");
  const distribuidor = await usuario("cliente");
  const pedido = await aprovar(admin, distribuidor, 12000);
  const res = resposta();
  await atualizarStatusPedido({ usuario: admin, params: { id: String(pedido._id) }, body: { status: "cancelado" } }, res);
  assert.equal(res.statusCode, 200, res.body?.message);
  assert.ok((await NatalConta.findOne({ clienteId: distribuidor._id })).revisaoPendente);
  assert.deepEqual(await pendencias(admin), []);
});

test("2. falha de sincronização gera alerta com o pedido aprovado normalmente", async (t) => {
  const admin = await usuario("admin");
  const distribuidor = await usuario("cliente");
  t.mock.method(console, "error", () => {});
  const simulacao = falharSincronizacao(t);
  const pedido = await aprovar(admin, distribuidor, 12000);
  simulacao.mock.restore();

  assert.equal((await Pedido.findById(pedido._id)).status, "aprovado");
  const [pendencia, ...resto] = await pendencias(admin);
  assert.equal(resto.length, 0);
  assert.equal(pendencia.clienteId, String(distribuidor._id));
  assert.equal(pendencia.distribuidorNome, distribuidor.nomeFantasia);
  assert.deepEqual(pendencia.motivos, ["conta_ausente"]);
  assert.equal((await pendencias(await usuario("comercial"))).length, 1, "a equipe comercial também vê");
});

test("2b. falha abaixo da faixa também é real: acumulado desatualizado", async (t) => {
  const admin = await usuario("admin");
  const distribuidor = await usuario("cliente");
  t.mock.method(console, "error", () => {});
  await aprovar(admin, distribuidor, 3000);
  const simulacao = t.mock.method(NatalConta, "findOneAndUpdate", () => { throw new Error("falha simulada"); });
  await aprovar(admin, distribuidor, 2000);
  simulacao.mock.restore();
  const [pendencia] = await pendencias(admin);
  assert.deepEqual(pendencia.motivos, ["acumulado_defasado"]);
  assert.equal((await reconciliar(admin)).status, 200);
  assert.deepEqual(await pendencias(admin), []);
  assert.equal((await NatalConta.findOne({ clienteId: distribuidor._id })).acumulado.totalCompras, 5000);
});

test("2c. sincronização parcial é detectada pelos dados, sem depender de log", async () => {
  const admin = await usuario("admin");
  const distribuidor = await usuario("cliente");
  await aprovar(admin, distribuidor, 12000);
  await NatalBonificacao.deleteOne({ clienteId: distribuidor._id, tipo: "marketing" });
  await NatalConta.updateOne({ clienteId: distribuidor._id }, { $set: { "contadores.aprovados": 3 } });
  const [pendencia] = await pendencias(admin);
  assert.deepEqual(pendencia.motivos, ["bonificacao_pendente", "contadores_divergentes"]);

  assert.equal((await reconciliar(admin)).status, 200);
  assert.deepEqual(await pendencias(admin), []);
  assert.equal((await NatalBonificacao.findOne({ clienteId: distribuidor._id, tipo: "marketing" })).valorConcedido, 360);
  assert.equal((await NatalBonificacao.findOne({ clienteId: distribuidor._id, tipo: "produtos" })).valorConcedido, 600);
});

test("3. múltiplos distribuidores com pendências são listados um a um", async (t) => {
  const admin = await usuario("admin");
  const [a, b, certo] = [await usuario("cliente"), await usuario("cliente"), await usuario("cliente")];
  t.mock.method(console, "error", () => {});
  await aprovar(admin, certo, 12000);
  await aprovar(admin, b, 12000);
  const simulacao = falharSincronizacao(t);
  await aprovar(admin, a, 12000);
  await aprovar(admin, b, 8000);
  simulacao.mock.restore();

  const lista = await pendencias(admin);
  assert.deepEqual(lista.map((item) => item.clienteId).sort(), [String(a._id), String(b._id)].sort());
  assert.deepEqual(lista.find((item) => item.clienteId === String(b._id)).motivos, ["acumulado_defasado", "cupons_pendentes", "bonificacao_pendente"]);
});

test("4, 6 e 7. reconciliação remove o alerta, a nova consulta confirma e nada é concedido em dobro", async (t) => {
  const admin = await usuario("admin");
  const distribuidor = await usuario("cliente");
  t.mock.method(console, "error", () => {});
  await aprovar(admin, distribuidor, 12000);
  const simulacao = falharSincronizacao(t);
  await aprovar(admin, distribuidor, 40000);
  simulacao.mock.restore();
  assert.equal((await pendencias(admin)).length, 1);

  assert.equal((await reconciliar(admin)).status, 200);
  assert.deepEqual(await pendencias(admin), []);
  assert.equal((await reconciliar(admin)).status, 200);
  assert.deepEqual(await pendencias(admin), []);

  const conta = await NatalConta.findOne({ clienteId: distribuidor._id });
  assert.equal(conta.cupons.total, 500);
  const movimentos = await NatalMovimentoCupom.find({ clienteId: distribuidor._id }).sort({ _id: 1 });
  assert.deepEqual(movimentos.map((item) => item.quantidade), [100, 400]);
  const produtos = await NatalBonificacao.find({ clienteId: distribuidor._id, tipo: "produtos" }).sort({ ciclo: 1 });
  assert.deepEqual(produtos.map((item) => item.valorConcedido), [4000, 600]);
});

test("5. reconciliação parcial mantém o alerta só de quem não foi corrigido", async (t) => {
  const admin = await usuario("admin");
  const [persistente, corrigido] = [await usuario("cliente"), await usuario("cliente")];
  t.mock.method(console, "error", () => {});
  const simulacao = falharSincronizacao(t);
  await aprovar(admin, persistente, 12000);
  await aprovar(admin, corrigido, 12000);
  simulacao.mock.restore();
  assert.equal((await pendencias(admin)).length, 2);

  const parcial = falharSincronizacao(t, persistente);
  const resultado = await reconciliar(admin);
  parcial.mock.restore();
  assert.equal(resultado.status, 500);
  assert.equal(resultado.corpo.codigo, "reconciliacao_parcial");
  assert.match(resultado.corpo.message, /1 distribuidor/);
  assert.deepEqual((await pendencias(admin)).map((item) => item.clienteId), [String(persistente._id)]);

  assert.equal((await reconciliar(admin)).status, 200);
  assert.deepEqual(await pendencias(admin), []);
});

test("cancelamento com sincronização falha aparece no alerta e vira revisão ao reconciliar", async (t) => {
  const admin = await usuario("admin");
  const distribuidor = await usuario("cliente");
  t.mock.method(console, "error", () => {});
  const pedido = await aprovar(admin, distribuidor, 12000);
  const simulacao = falharSincronizacao(t);
  const res = resposta();
  await atualizarStatusPedido({ usuario: admin, params: { id: String(pedido._id) }, body: { status: "cancelado" } }, res);
  simulacao.mock.restore();
  assert.deepEqual((await pendencias(admin))[0].motivos, ["acumulado_defasado"]);
  assert.equal((await reconciliar(admin)).status, 200);
  assert.deepEqual(await pendencias(admin), []);
  assert.ok((await NatalConta.findOne({ clienteId: distribuidor._id })).revisaoPendente);
});

test("a detecção é somente leitura", async (t) => {
  const admin = await usuario("admin");
  t.mock.method(console, "error", () => {});
  const simulacao = falharSincronizacao(t);
  await aprovar(admin, await usuario("cliente"), 12000);
  simulacao.mock.restore();
  await new Promise((resolve) => { setTimeout(resolve, 30); });
  escritas.length = 0;
  assert.equal((await pendencias(admin)).length, 1);
  assert.equal((await pendencias(admin)).length, 1);
  assert.deepEqual(escritas, []);
});
