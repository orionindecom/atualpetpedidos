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
import NatalLote from "../src/models/NatalLote.js";
import NatalMigracaoExecucao from "../src/models/NatalMigracaoExecucao.js";
import NatalMovimentoCupom from "../src/models/NatalMovimentoCupom.js";
import natalRoutes from "../src/routes/natalRoutes.js";
import { aprovarPedidoAdmin, atualizarStatusPedido } from "../src/controllers/pedidoController.js";
import { gerarCodigoPublico, resetIndicesNatalParaTestes } from "../src/services/natalBaseService.js";
import { detalharDistribuidor } from "../src/services/natalDistribuidorService.js";
import { ativarCumulativo, concederBeneficios, executarMigracao } from "../src/services/natalMigracaoService.js";
import { calcularEstadoCumulativo, paraCentavos } from "../src/utils/natalCumulativo.js";

// Pedidos aprovados durante a ativação e falhas de sincronização: nada pode se
// perder nem ser concedido duas vezes, em nenhuma das janelas.

process.env.JWT_SECRET ||= "segredo-de-teste-com-mais-de-32-caracteres!!";

const CRIADO_EM = new Date("2026-11-10T13:00:00.000Z");
const DENTRO = new Date("2026-11-20T15:00:00.000Z");
const operador = "Teste";
let replSet;
let server;
let base;

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: "natal-transicao", autoIndex: false, autoCreate: false });
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
});

let sequencia = 0;
const usuario = (tipo) => {
  sequencia += 1;
  return Usuario.create({
    nomeResponsavel: `${tipo} ${sequencia}`,
    nomeFantasia: tipo === "cliente" ? `Distribuidora ${sequencia}` : undefined,
    razaoSocial: tipo === "cliente" ? `Distribuidora ${sequencia} LTDA` : undefined,
    email: `${tipo}${sequencia}@transicao.local`,
    senha: "hash",
    tipo,
    statusCadastro: "aprovado",
  });
};

const criarPedido = async (cliente, valorTotal, status = "aguardando_aprovacao") => {
  sequencia += 1;
  return Pedido.create({
    numeroPedido: `TRN-${sequencia}`,
    clienteId: cliente._id,
    nomeFantasiaCliente: cliente.nomeFantasia,
    razaoSocialCliente: cliente.razaoSocial,
    tabelaPrecoId: new mongoose.Types.ObjectId(),
    dia: 10, mes: 11, ano: 2026,
    itens: [{ produtoId: new mongoose.Types.ObjectId(), nomeProduto: "Shampoo", quantidade: 1, valorUnitario: valorTotal, subtotal: valorTotal }],
    valorTotal,
    status,
    createdAt: CRIADO_EM,
  });
};

const aprovar = async (admin, cliente, valor) => {
  const pedido = await criarPedido(cliente, valor);
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await aprovarPedidoAdmin({ usuario: admin, params: { id: String(pedido._id) } }, res);
  assert.equal(res.statusCode, 200, res.body?.message);
  return pedido;
};

const criarLote = (cliente, pedido, cupons) => NatalLote.create({
  pedidoId: pedido._id,
  numeroPedido: pedido.numeroPedido,
  clienteId: cliente._id,
  distribuidorNome: cliente.nomeFantasia,
  codigoPublico: gerarCodigoPublico(),
  pedidoAprovadoEm: DENTRO,
  valorAprovadoInicial: pedido.valorTotal,
  valorAtual: pedido.valorTotal,
  faixaMaxima: { nivel: 1, valorMinimo: 12000, cupons, marketingPercentual: 3, produtosPercentual: 5 },
  cuponsConcedidos: cupons,
  criadoPor: { usuarioTipo: "sistema" },
});

const token = (u) => ({ Authorization: `Bearer ${jwt.sign({ id: u._id, tipo: u.tipo, tokenVersion: 0 }, process.env.JWT_SECRET, { algorithm: "HS256" })}` });

const reconciliar = async (admin) => {
  const resposta = await fetch(`${base}/gestao/reconciliar`, { method: "POST", headers: token(admin) });
  return { status: resposta.status, corpo: await resposta.json() };
};

const contaDe = (cliente) => NatalConta.findOne({ clienteId: cliente._id });
const conquistas = async (cliente) => (await NatalMovimentoCupom.find({ clienteId: cliente._id, tipo: "conquista" }).sort({ _id: 1 })).map((item) => item.quantidade);

// Confere saldo, extrato e bonificações contra o cálculo do total comprado.
const conferir = async (cliente, total) => {
  const estado = calcularEstadoCumulativo(paraCentavos(total));
  const conta = await contaDe(cliente);
  assert.ok(conta, "conta deve existir");
  assert.equal(conta.acumulado.totalCompras, total);
  assert.equal(conta.cupons.total, estado.cuponsDevidos, "cupons iguais ao direito");
  const movimentos = await NatalMovimentoCupom.find({ clienteId: cliente._id });
  assert.equal(movimentos.reduce((soma, item) => soma + item.quantidade, 0), estado.cuponsDevidos, "extrato sem perda nem duplicidade");
  assert.equal(new Set(movimentos.map((item) => item.chave)).size, movimentos.length);

  const docs = await NatalBonificacao.find({ clienteId: cliente._id });
  const esperadas = estado.ciclos.flatMap((ciclo) => ["produtos", "marketing"].map((tipo) => ({ ciclo: ciclo.numero, tipo, centavos: ciclo[tipo].devidoCentavos })));
  for (const { ciclo, tipo, centavos } of esperadas) {
    const doc = docs.find((item) => item.ciclo === ciclo && item.tipo === tipo);
    assert.equal(paraCentavos(doc?.valorConcedido), centavos, `ciclo ${ciclo} ${tipo}`);
    const complementos = doc.historico.reduce((soma, evento) => soma + paraCentavos(evento.complemento), 0);
    assert.equal(complementos, centavos, `complementos do ciclo ${ciclo} ${tipo}`);
    assert.equal(doc.valorEntregue, 0);
  }
  assert.equal(docs.length, esperadas.length, "sem bonificação além do devido");
  assert.equal(conta.revisaoPendente, undefined);
};

// ---------- Janelas da ativação ----------

test("pedidos aprovados em cada janela da ativação entram uma única vez", async () => {
  const admin = await usuario("admin");
  const distribuidor = await usuario("cliente");
  await criarLote(distribuidor, await criarPedido(distribuidor, 12000, "aprovado"), 100);

  // Publicado, ainda em legado.
  await aprovar(admin, distribuidor, 8000);
  assert.equal(await NatalConta.countDocuments(), 0);

  await executarMigracao({ operador, now: DENTRO });
  assert.equal((await contaDe(distribuidor)).cupons.total, 100);

  // Depois da migração, antes da concessão.
  await aprovar(admin, distribuidor, 20000);
  assert.equal((await contaDe(distribuidor)).cupons.total, 100, "aprovação não concede em migração");

  await concederBeneficios({ operador, now: DENTRO });
  await conferir(distribuidor, 40000);

  // Depois da concessão, antes da ativação.
  await aprovar(admin, distribuidor, 12000);
  assert.equal((await contaDe(distribuidor)).cupons.total, 400);

  await ativarCumulativo({ operador, now: DENTRO });
  await conferir(distribuidor, 52000);

  // Ativo.
  await aprovar(admin, distribuidor, 8000);
  await conferir(distribuidor, 60000);
  assert.deepEqual(await conquistas(distribuidor), [300, 100, 100]);

  // Reconciliar e repetir a concessão de nada alteram.
  assert.equal((await reconciliar(admin)).status, 200);
  await conferir(distribuidor, 60000);
  assert.deepEqual(await conquistas(distribuidor), [300, 100, 100]);
});

test("distribuidores novos em cada janela recebem conta, cupons e bonificações completos", async () => {
  const admin = await usuario("admin");
  const [legado, aposMigrar, aposConceder] = [await usuario("cliente"), await usuario("cliente"), await usuario("cliente")];
  await aprovar(admin, legado, 52000);
  await executarMigracao({ operador, now: DENTRO });
  await aprovar(admin, aposMigrar, 12000);
  await concederBeneficios({ operador, now: DENTRO });
  assert.equal((await contaDe(aposMigrar)).cupons.total, 100);
  await aprovar(admin, aposConceder, 80000);
  assert.equal(await contaDe(aposConceder), null, "só a ativação processa esta janela");
  await ativarCumulativo({ operador, now: DENTRO });
  await conferir(legado, 52000);
  await conferir(aposMigrar, 12000);
  await conferir(aposConceder, 80000);
  assert.ok((await contaDe(aposConceder)).codigoPublico, "distribuidor novo recebe link próprio");
});

test("aprovações simultâneas às etapas da ativação não perdem nem duplicam", async () => {
  const admin = await usuario("admin");
  const clientes = [];
  for (let i = 0; i < 5; i += 1) clientes.push(await usuario("cliente"));
  const valores = [12000, 8000, 20000, 12000, 8000];
  const espera = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

  await Promise.all([
    ...clientes.flatMap((cliente) => valores.map(async (valor, indice) => {
      await espera(indice * 60);
      await aprovar(admin, cliente, valor);
    })),
    (async () => {
      await espera(30);
      await executarMigracao({ operador, now: DENTRO });
      await espera(60);
      await concederBeneficios({ operador, now: DENTRO });
      await espera(60);
      await ativarCumulativo({ operador, now: DENTRO });
    })(),
  ]);

  for (const cliente of clientes) await conferir(cliente, 60000);
  assert.equal(await NatalMigracaoExecucao.countDocuments({ status: "falhou" }), 0);
});

test("pedido cancelado antes da migração não soma e os cupons antigos ficam preservados", async () => {
  const distribuidor = await usuario("cliente");
  const pedido = await criarPedido(distribuidor, 12000, "aprovado");
  await criarLote(distribuidor, pedido, 100);
  await Pedido.updateOne({ _id: pedido._id }, { $set: { status: "cancelado" } });
  await executarMigracao({ operador, now: DENTRO });
  await concederBeneficios({ operador, now: DENTRO });
  await ativarCumulativo({ operador, now: DENTRO });
  const conta = await contaDe(distribuidor);
  assert.equal(conta.acumulado.totalCompras, 0);
  assert.equal(conta.cupons.total, 100);
  assert.equal(conta.revisaoPendente, undefined, "divergência fica no relatório, sem pendência automática");
});

// ---------- Falha de sincronização ----------

const falharMovimento = (t, filtro = () => true) => {
  const original = NatalMovimentoCupom.create.bind(NatalMovimentoCupom);
  const simulacao = t.mock.method(NatalMovimentoCupom, "create", async (docs, opcoes) => {
    if (filtro(docs)) throw new Error("falha simulada");
    return original(docs, opcoes);
  });
  return simulacao;
};

test("falha na aprovação não trava o pedido, nada fica parcial e a reconciliação recupera uma vez", async (t) => {
  await NatalCampanhaEstado.create({ _id: "natal-2026", modoCumulativo: "ativo" });
  const admin = await usuario("admin");
  const distribuidor = await usuario("cliente");
  const erros = t.mock.method(console, "error", () => {});

  const simulacao = falharMovimento(t);
  const pedido = await aprovar(admin, distribuidor, 52000);
  simulacao.mock.restore();

  assert.equal((await Pedido.findById(pedido._id)).status, "aprovado", "o pedido segue aprovado");
  assert.equal(await contaDe(distribuidor), null, "transação desfeita por inteiro");
  assert.equal(await NatalBonificacao.countDocuments(), 0);
  assert.equal(await NatalMovimentoCupom.countDocuments(), 0);
  assert.equal(await NatalAuditoria.countDocuments({ acao: "cupons_liberados" }), 0);
  assert.ok(erros.mock.calls.some((chamada) => /Falha ao sincronizar pedido/.test(String(chamada.arguments[0]))), "falha fica registrada em log");

  const detalhe = await detalharDistribuidor({ clienteId: distribuidor._id });
  assert.equal(detalhe.comprasParticipantes.length, 1, "o pedido aparece como participante");
  assert.equal(detalhe.cupons.total, 0, "o saldo ainda não reflete a compra");

  assert.equal((await reconciliar(admin)).status, 200);
  await conferir(distribuidor, 52000);
  assert.equal((await reconciliar(admin)).status, 200);
  await conferir(distribuidor, 52000);
  assert.deepEqual(await conquistas(distribuidor), [500]);
});

test("falha com conta existente preserva o anterior e a recuperação aplica só a diferença", async (t) => {
  await NatalCampanhaEstado.create({ _id: "natal-2026", modoCumulativo: "ativo" });
  const admin = await usuario("admin");
  const distribuidor = await usuario("cliente");
  t.mock.method(console, "error", () => {});
  await aprovar(admin, distribuidor, 12000);

  const simulacao = falharMovimento(t);
  await aprovar(admin, distribuidor, 8000);
  simulacao.mock.restore();
  const conta = await contaDe(distribuidor);
  assert.equal(conta.cupons.total, 100);
  assert.equal(conta.acumulado.totalCompras, 12000);
  assert.equal((await NatalBonificacao.findOne({ clienteId: distribuidor._id, tipo: "produtos" })).valorConcedido, 600, "bonificação não fica à frente do saldo");

  // O próximo evento do distribuidor também recupera o que faltou.
  await aprovar(admin, distribuidor, 20000);
  await conferir(distribuidor, 40000);
  assert.deepEqual(await conquistas(distribuidor), [100, 300]);
  const doc = await NatalBonificacao.findOne({ clienteId: distribuidor._id, tipo: "produtos" });
  assert.equal(doc.historico.at(-1).valorAnterior, 600);
  assert.equal(doc.historico.at(-1).complemento, 3400);
});

test("falha no cancelamento mantém benefícios e a reconciliação abre a revisão pendente", async (t) => {
  await NatalCampanhaEstado.create({ _id: "natal-2026", modoCumulativo: "ativo" });
  const admin = await usuario("admin");
  const distribuidor = await usuario("cliente");
  t.mock.method(console, "error", () => {});
  const pedido = await aprovar(admin, distribuidor, 12000);

  const falhar = t.mock.method(NatalAuditoria, "create", async () => { throw new Error("falha simulada"); });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await atualizarStatusPedido({ usuario: admin, params: { id: String(pedido._id) }, body: { status: "cancelado" } }, res);
  falhar.mock.restore();

  assert.equal(res.statusCode, 200, res.body?.message);
  assert.equal((await Pedido.findById(pedido._id)).status, "cancelado");
  let conta = await contaDe(distribuidor);
  assert.equal(conta.acumulado.totalCompras, 12000, "falha desfez o recálculo");
  assert.equal(conta.revisaoPendente, undefined);

  assert.equal((await reconciliar(admin)).status, 200);
  conta = await contaDe(distribuidor);
  assert.equal(conta.acumulado.totalCompras, 0);
  assert.equal(conta.cupons.total, 100, "reconciliação não retira benefícios");
  assert.ok(conta.revisaoPendente);
  assert.equal(await NatalAuditoria.countDocuments({ acao: "revisao_pendente", clienteId: distribuidor._id }), 1);
});

test("falha em um distribuidor na reconciliação não esconde o erro nem bloqueia os demais", async (t) => {
  await NatalCampanhaEstado.create({ _id: "natal-2026", modoCumulativo: "ativo" });
  const admin = await usuario("admin");
  const [afetado, normal] = [await usuario("cliente"), await usuario("cliente")];
  t.mock.method(console, "error", () => {});

  const simulacao = falharMovimento(t);
  await aprovar(admin, afetado, 12000);
  await aprovar(admin, normal, 12000);
  simulacao.mock.restore();
  assert.equal(await NatalConta.countDocuments(), 0);

  const parcial = falharMovimento(t, (docs) => String(docs[0].clienteId) === String(afetado._id));
  const resposta = await reconciliar(admin);
  parcial.mock.restore();
  assert.equal(resposta.status, 500);
  assert.equal(resposta.corpo.codigo, "reconciliacao_parcial");
  assert.deepEqual(resposta.corpo.falhas, [String(afetado._id)]);
  await conferir(normal, 12000);
  assert.equal(await contaDe(afetado), null);

  assert.equal((await reconciliar(admin)).status, 200);
  await conferir(afetado, 12000);
  await conferir(normal, 12000);
});

test("falha no meio da concessão libera a trava e a repetição conclui sem duplicar", async (t) => {
  const admin = await usuario("admin");
  const [primeiro, segundo] = [await usuario("cliente"), await usuario("cliente")];
  await aprovar(admin, primeiro, 52000);
  await aprovar(admin, segundo, 52000);
  await executarMigracao({ operador, now: DENTRO });

  let chamadas = 0;
  const simulacao = falharMovimento(t, (docs) => docs[0].tipo === "conquista" && (chamadas += 1) === 2);
  await assert.rejects(concederBeneficios({ operador, now: DENTRO }), /falha simulada/);
  simulacao.mock.restore();

  assert.equal((await NatalMigracaoExecucao.findOne({ etapa: "concessao" })).status, "falhou");
  assert.equal(await NatalMigracaoExecucao.countDocuments({ emAndamento: true }), 0);
  assert.equal((await NatalCampanhaEstado.findById("natal-2026")).modoCumulativo, "migrando");
  assert.equal(await NatalMovimentoCupom.countDocuments({ tipo: "conquista" }), 1);

  await concederBeneficios({ operador, now: DENTRO });
  await ativarCumulativo({ operador, now: DENTRO });
  await conferir(primeiro, 52000);
  await conferir(segundo, 52000);
});

test("falha na passada final da ativação fica registrada e a reconciliação completa", async (t) => {
  const admin = await usuario("admin");
  const distribuidor = await usuario("cliente");
  await executarMigracao({ operador, now: DENTRO });
  await concederBeneficios({ operador, now: DENTRO });
  await aprovar(admin, distribuidor, 40000);

  const simulacao = falharMovimento(t, (docs) => docs[0].tipo === "conquista");
  await assert.rejects(ativarCumulativo({ operador, now: DENTRO }), /falha simulada/);
  simulacao.mock.restore();

  assert.equal((await NatalCampanhaEstado.findById("natal-2026")).modoCumulativo, "ativo");
  assert.equal((await NatalMigracaoExecucao.findOne({ etapa: "ativacao" })).status, "falhou");
  await assert.rejects(ativarCumulativo({ operador, now: DENTRO }), { code: "modo_invalido" });

  assert.equal((await reconciliar(admin)).status, 200);
  await conferir(distribuidor, 40000);
  assert.deepEqual(await conquistas(distribuidor), [400]);
});
