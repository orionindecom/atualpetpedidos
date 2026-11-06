import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import Pedido from "../src/models/Pedido.js";
import Usuario from "../src/models/Usuario.js";
import { NatalCampanhaEstado } from "../src/models/NatalCampanhaEstado.js";
import NatalConta from "../src/models/NatalConta.js";
import NatalLote from "../src/models/NatalLote.js";
import NatalMovimentoCupom from "../src/models/NatalMovimentoCupom.js";
import natalRoutes, { natalPublicRoutes } from "../src/routes/natalRoutes.js";
import { aprovarPedidoAdmin } from "../src/controllers/pedidoController.js";
import { gerarCodigoPublico, resetIndicesNatalParaTestes } from "../src/services/natalBaseService.js";
import { criarStorageMemoria, setComprovanteStorage, validarArquivoComprovante } from "../src/services/natalComprovanteService.js";
import { garantirConta } from "../src/services/natalContaService.js";
import { aprovarParticipacao, registrarParticipacaoPublica } from "../src/services/natalParticipacaoService.js";

// Link do distribuidor ao longo de novos pedidos e ciclos, sempre em banco isolado.

process.env.JWT_SECRET ||= "segredo-de-teste-com-mais-de-32-caracteres!!";

const CRIADO_EM = new Date("2026-11-10T13:00:00.000Z");
const DENTRO = new Date("2026-11-20T15:00:00.000Z");
const storage = criarStorageMemoria();
let replSet;
let server;
let base;

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: "natal-link", autoIndex: false, autoCreate: false });
  setComprovanteStorage(storage);
  const app = express();
  app.use(express.json());
  app.use("/api/public/natal-2026", natalPublicRoutes);
  app.use("/api/natal-2026", natalRoutes);
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server?.close();
  setComprovanteStorage(null);
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
    email: `${tipo}${sequencia}@link.local`,
    senha: "hash",
    tipo,
    statusCadastro: "aprovado",
  });
};

const novoPedido = (cliente, valor, status = "aguardando_aprovacao", criadoEm = CRIADO_EM) => {
  sequencia += 1;
  return Pedido.create({
    numeroPedido: `LNK-${sequencia}`,
    clienteId: cliente._id,
    nomeFantasiaCliente: cliente.nomeFantasia,
    tabelaPrecoId: new mongoose.Types.ObjectId(),
    dia: 10, mes: 11, ano: 2026,
    itens: [{ produtoId: new mongoose.Types.ObjectId(), nomeProduto: "Shampoo", quantidade: 1, valorUnitario: valor, subtotal: valor }],
    valorTotal: valor,
    status,
    createdAt: criadoEm,
  });
};

const aprovar = async (admin, cliente, valor) => {
  const pedido = await novoPedido(cliente, valor);
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await aprovarPedidoAdmin({ usuario: admin, params: { id: String(pedido._id) } }, res);
  assert.equal(res.statusCode, 200, res.body?.message);
  return pedido;
};

const criarLote = (cliente, pedido, cupons, criadoEm) => NatalLote.create({
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
  ...(criadoEm ? { createdAt: criadoEm } : {}),
});

const token = (u) => ({ Authorization: `Bearer ${jwt.sign({ id: u._id, tipo: u.tipo, tokenVersion: 0 }, process.env.JWT_SECRET, { algorithm: "HS256" })}` });
const resumo = (cliente) => fetch(`${base}/natal-2026/distribuidor/resumo`, { headers: token(cliente) }).then((r) => r.json());
const principalDe = (dados) => dados.conta.links.filter((link) => link.principal);
const linkPublico = (codigo) => fetch(`${base}/public/natal-2026/lotes/${codigo}`).then((r) => r.json());

const cadastrar = (codigo) => {
  const buffer = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, String(Math.random()))]);
  const meta = validarArquivoComprovante({ buffer, mimetype: "image/png", originalname: "nota.png" });
  return registrarParticipacaoPublica({
    codigo,
    dados: {
      vendedorNome: "Carlos", nomeFantasia: "Pet Feliz", razaoSocial: "Pet Feliz LTDA", documento: "11222333000181", tipoDocumento: "cnpj",
      responsavel: "Ana", whatsapp: "11987654321", instagram: "petfeliz", dataCompra: "2026-11-15", valorCompra: 350.5,
    },
    arquivo: { buffer, meta },
    ip: "10.0.0.1",
    userAgent: "teste",
    now: DENTRO,
  });
};

test("novo pedido aprovado soma no saldo do link antigo, sem outro link nem outro saldo", async () => {
  const [admin, comercial, distribuidor] = [await usuario("admin"), await usuario("comercial"), await usuario("cliente")];
  const pedidoAntigo = await novoPedido(distribuidor, 12000, "aprovado");
  const lote = await criarLote(distribuidor, pedidoAntigo, 100);
  await garantirConta({ clienteId: distribuidor._id });

  let dados = await resumo(distribuidor);
  assert.equal(dados.conta.cupons.total, 100);
  assert.equal(principalDe(dados)[0].codigoPublico, lote.codigoPublico);

  await aprovar(admin, distribuidor, 8000);

  dados = await resumo(distribuidor);
  assert.equal(dados.conta.compras.total, 20000);
  assert.equal(dados.conta.compras.acumuladoCiclo, 20000);
  assert.equal(dados.conta.compras.faixaAtual.cupons, 200);
  assert.equal(dados.conta.compras.proximaFaixa.cupons, 300);
  assert.equal(dados.conta.compras.restanteProximaFaixa, 10000);
  assert.equal(dados.conta.cupons.total, 200);
  assert.equal(dados.conta.cupons.disponiveis, 200);
  assert.equal(dados.conta.cupons.utilizados, 0);

  assert.equal(principalDe(dados).length, 1);
  assert.equal(principalDe(dados)[0].codigoPublico, lote.codigoPublico, "o link continua o mesmo");
  assert.equal(dados.conta.links.length, 1, "nenhum link novo");
  assert.equal(await NatalLote.countDocuments(), 1);
  assert.equal(await NatalConta.countDocuments(), 1);
  assert.equal((await NatalConta.findOne({ clienteId: distribuidor._id })).codigoPublico, undefined);

  // Os cupons adicionais ficam disponíveis para cadastro pelo mesmo link.
  await NatalConta.updateOne({ clienteId: distribuidor._id }, { $set: { "contadores.aprovados": 100, "cupons.total": 200 } });
  assert.equal((await linkPublico(lote.codigoPublico)).aceitandoCadastros, true);
  const participacao = await cadastrar(lote.codigoPublico);
  assert.equal((await aprovarParticipacao({ id: participacao._id, usuario: comercial, now: DENTRO })).status, "aprovado");
});

test("distribuidor sem link recebe um só, na primeira aprovação, e o mantém por pedidos e ciclos", async () => {
  const [admin, distribuidor] = [await usuario("admin"), await usuario("cliente")];
  let dados = await resumo(distribuidor);
  assert.equal(dados.conta.links.length, 0, "antes da primeira compra não há link");

  await aprovar(admin, distribuidor, 5000);
  dados = await resumo(distribuidor);
  assert.equal(dados.conta.cupons.total, 0);
  assert.equal(dados.conta.links.length, 1);
  const [{ codigoPublico }] = principalDe(dados);
  const publico = await linkPublico(codigoPublico);
  assert.equal(publico.aceitandoCadastros, false);
  assert.equal(publico.motivo, "sem_beneficios");

  await aprovar(admin, distribuidor, 7000);
  assert.equal((await linkPublico(codigoPublico)).aceitandoCadastros, true);
  await aprovar(admin, distribuidor, 40000);

  dados = await resumo(distribuidor);
  assert.equal(dados.conta.compras.ciclosConcluidos, 1);
  assert.equal(dados.conta.compras.cicloAtual, 2);
  assert.equal(dados.conta.cupons.total, 500);
  assert.equal(principalDe(dados)[0].codigoPublico, codigoPublico);
  assert.equal(dados.conta.links.length, 1);
  assert.equal(await NatalLote.countDocuments(), 0);
  const movimentos = await NatalMovimentoCupom.find({ clienteId: distribuidor._id }).sort({ _id: 1 });
  assert.deepEqual(movimentos.map((item) => item.quantidade), [100, 400]);
});

test("com vários links antigos, o principal é o mais antigo e os outros seguem válidos", async () => {
  const distribuidor = await usuario("cliente");
  const recente = await criarLote(distribuidor, await novoPedido(distribuidor, 100, "aprovado"), 1, new Date("2026-11-08T12:00:00Z"));
  const antigo = await criarLote(distribuidor, await novoPedido(distribuidor, 100, "aprovado"), 1, new Date("2026-11-04T12:00:00Z"));
  await garantirConta({ clienteId: distribuidor._id });

  const dados = await resumo(distribuidor);
  assert.equal(principalDe(dados).length, 1);
  assert.equal(principalDe(dados)[0].codigoPublico, antigo.codigoPublico);
  assert.deepEqual(dados.conta.links.map((link) => link.codigoPublico), [antigo.codigoPublico, recente.codigoPublico]);
  assert.equal((await linkPublico(recente.codigoPublico)).aceitandoCadastros, true);
});

test("link principal aparece na gestão e nos benefícios do pedido", async () => {
  const [admin, distribuidor] = [await usuario("admin"), await usuario("cliente")];
  const pedido = await aprovar(admin, distribuidor, 12000);
  const [linha] = await fetch(`${base}/natal-2026/gestao/distribuidores`, { headers: token(admin) }).then((r) => r.json());
  assert.equal(linha.links.filter((link) => link.principal).length, 1);
  const beneficios = await fetch(`${base}/natal-2026/pedidos/${pedido._id}/beneficios`, { headers: token(distribuidor) }).then((r) => r.json());
  assert.equal(beneficios.conta.links.find((link) => link.principal).codigoPublico, linha.links[0].codigoPublico);
});
