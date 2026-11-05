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
import NatalCompraExterna from "../src/models/NatalCompraExterna.js";
import NatalConta from "../src/models/NatalConta.js";
import NatalCupom from "../src/models/NatalCupom.js";
import NatalLote from "../src/models/NatalLote.js";
import NatalMigracaoExecucao from "../src/models/NatalMigracaoExecucao.js";
import NatalMovimentoCupom from "../src/models/NatalMovimentoCupom.js";
import NatalParticipacao from "../src/models/NatalParticipacao.js";
import NatalSubstituicaoCompra from "../src/models/NatalSubstituicaoCompra.js";
import natalRoutes, { natalPublicRoutes } from "../src/routes/natalRoutes.js";
import { aprovarPedidoAdmin, atualizarPedidoAdmin, atualizarStatusPedido } from "../src/controllers/pedidoController.js";
import { gerarCodigoPublico, resetIndicesNatalParaTestes } from "../src/services/natalBaseService.js";
import { ajustarCuponsConta } from "../src/services/natalContaService.js";
import { registrarCompraExterna } from "../src/services/natalCompraExternaService.js";
import { criarStorageMemoria, setComprovanteStorage, validarArquivoComprovante } from "../src/services/natalComprovanteService.js";
import { sincronizarPedidoNatal } from "../src/services/natalLoteService.js";
import {
  analisarMigracao,
  ativarCumulativo,
  concederBeneficios,
  executarMigracao,
  fotografarDadosOriginais,
  liberarTrava,
  reverterModo,
  validarIntegridade,
} from "../src/services/natalMigracaoService.js";
import {
  aprovarParticipacao,
  cancelarParticipacao,
  obterLotePublico,
  registrarParticipacaoPublica,
} from "../src/services/natalParticipacaoService.js";
import { aplicarSubstituicao, previaSubstituicao } from "../src/services/natalSubstituicaoService.js";

process.env.JWT_SECRET ||= "segredo-de-teste-com-mais-de-32-caracteres!!";

const NOME_BANCO = "natal-ativacao";
const DENTRO = new Date("2026-11-20T15:00:00.000Z");
const CRIADO_EM = new Date("2026-11-10T13:00:00.000Z");
const COMANDOS_DE_ESCRITA = new Set(["insert", "update", "delete", "findAndModify", "findandmodify", "create", "createIndexes", "drop", "dropIndexes", "bulkWrite"]);
const storage = criarStorageMemoria();
let replSet;
const escritas = [];

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: NOME_BANCO, monitorCommands: true, autoIndex: false, autoCreate: false });
  mongoose.connection.getClient().on("commandStarted", (evento) => {
    if (COMANDOS_DE_ESCRITA.has(evento.commandName)) escritas.push(`${evento.commandName}:${evento.command[evento.commandName]}`);
  });
  setComprovanteStorage(storage);
});

after(async () => {
  setComprovanteStorage(null);
  await mongoose.disconnect();
  await replSet?.stop();
});

beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  resetIndicesNatalParaTestes();
  storage.arquivos.clear();
  delete process.env.NATAL2026_SUBSTITUICAO_HABILITADA;
});

let sequencia = 0;
const usuario = (tipo, extra = {}) => {
  sequencia += 1;
  return Usuario.create({
    nomeResponsavel: `${tipo} ${sequencia}`,
    nomeFantasia: tipo === "cliente" ? `Distribuidora ${sequencia}` : undefined,
    razaoSocial: tipo === "cliente" ? `Distribuidora ${sequencia} LTDA` : undefined,
    email: `${tipo}${sequencia}@ativacao.local`,
    senha: "hash",
    tipo,
    statusCadastro: "aprovado",
    ...extra,
  });
};

const contexto = async () => {
  const [admin, comercial, distribuidor] = await Promise.all([usuario("admin"), usuario("comercial"), usuario("cliente")]);
  return { admin, comercial, distribuidor };
};

const criarPedido = async (cliente, valorTotal, extra = {}) => {
  sequencia += 1;
  return Pedido.create({
    numeroPedido: `ATV-${sequencia}`,
    clienteId: cliente._id,
    nomeFantasiaCliente: cliente.nomeFantasia,
    razaoSocialCliente: cliente.razaoSocial,
    tabelaPrecoId: new mongoose.Types.ObjectId(),
    dia: 10, mes: 11, ano: 2026,
    itens: [{ produtoId: new mongoose.Types.ObjectId(), nomeProduto: "Shampoo", quantidade: 1, valorUnitario: valorTotal, subtotal: valorTotal }],
    valorTotal,
    status: "aprovado",
    createdAt: CRIADO_EM,
    ...extra,
  });
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

let cnpjSeq = 0;
const gerarCnpj = () => {
  cnpjSeq += 1;
  const base = `${String(30000000 + cnpjSeq).slice(-8)}0001`;
  const calc = (digits, weights) => {
    const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = calc(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(`${base}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${d1}${d2}`;
};

const cadastrar = async (codigo) => {
  const buffer = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, String(Math.random()))]);
  const meta = validarArquivoComprovante({ buffer, mimetype: "image/png", originalname: "nota.png" });
  return registrarParticipacaoPublica({
    codigo,
    dados: {
      vendedorNome: "Carlos", nomeFantasia: "Pet Feliz", razaoSocial: "Pet Feliz LTDA", documento: gerarCnpj(), tipoDocumento: "cnpj",
      responsavel: "Ana", whatsapp: "11987654321", instagram: "petfeliz", dataCompra: "2026-11-15", valorCompra: 350.5,
    },
    arquivo: { buffer, meta },
    ip: "10.0.0.1",
    userAgent: "teste",
    now: DENTRO,
  });
};

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const operador = "Teste";
const contaDe = (cliente) => NatalConta.findOne({ clienteId: cliente._id });
const ativarModo = () => NatalCampanhaEstado.create({ _id: "natal-2026", modoCumulativo: "ativo" });
const ativarModelo = async () => {
  await executarMigracao({ operador, now: DENTRO });
  await concederBeneficios({ operador, now: DENTRO });
  await ativarCumulativo({ operador, now: DENTRO });
};

const montarApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/public/natal-2026", natalPublicRoutes);
  app.use("/api/natal-2026", natalRoutes);
  return new Promise((resolve) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
};

const token = (u) => ({ Authorization: `Bearer ${jwt.sign({ id: u._id, tipo: u.tipo, tokenVersion: 0 }, process.env.JWT_SECRET, { algorithm: "HS256" })}` });

const AGORA = new Date("2026-11-25T12:00:00.000Z");
const COMPRA = { valor: 12000, data: "2026-11-10", referencia: "NF 900" };

// Abre as rotas de consulta e devolve os comandos de escrita observados no banco.
const escritasEm = async (operacao) => {
  await new Promise((resolve) => { setTimeout(resolve, 30); });
  escritas.length = 0;
  await operacao();
  await new Promise((resolve) => { setTimeout(resolve, 30); });
  return [...escritas];
};

// ---------- Consultas não gravam ----------

test("controle: o monitor detecta gravações no banco", async () => {
  const gravacoes = await escritasEm(() => usuario("comercial"));
  assert.ok(gravacoes.some((item) => item.startsWith("insert:")));
});

test("acessar e recarregar um link antigo não gera gravação nem altera saldo, antes da migração", async (t) => {
  const { distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 12000);
  const lote = await criarLote(distribuidor, pedido, 100);
  const server = await montarApp();
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/public/natal-2026`;

  const gravacoes = await escritasEm(async () => {
    for (let i = 0; i < 5; i += 1) {
      const resposta = await fetch(`${base}/lotes/${lote.codigoPublico}`);
      assert.equal(resposta.status, 200);
      assert.equal((await resposta.json()).distribuidorNome, distribuidor.nomeFantasia);
    }
  });
  assert.deepEqual(gravacoes, []);
  assert.equal(await NatalConta.countDocuments(), 0);
  assert.equal(await NatalMovimentoCupom.countDocuments(), 0);
});

test("consultas da gestão e do distribuidor não migram, não criam conta nem concedem", async (t) => {
  const { admin, comercial, distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 57503);
  await criarLote(distribuidor, pedido, 400);
  const server = await montarApp();
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/natal-2026`;
  const rotasGestao = [
    "gestao/painel", "gestao/distribuidores", `gestao/distribuidores/${distribuidor._id}`, "gestao/lotes",
    "gestao/participacoes", "gestao/auditoria", "gestao/compras-externas", `pedidos/${pedido._id}/beneficios`,
  ];

  const gravacoes = await escritasEm(async () => {
    for (const rota of rotasGestao) {
      for (const pessoa of [admin, comercial]) {
        const resposta = await fetch(`${base}/${rota}`, { headers: token(pessoa) });
        assert.equal(resposta.status, 200, rota);
      }
    }
    for (const rota of ["distribuidor/resumo", "distribuidor/participacoes", "distribuidor/pedidos-beneficios"]) {
      assert.equal((await fetch(`${base}/${rota}`, { headers: token(distribuidor) })).status, 200, rota);
    }
  });
  assert.deepEqual(gravacoes, []);
  assert.equal(await NatalConta.countDocuments(), 0);
  assert.equal(await NatalBonificacao.countDocuments(), 0);
});

test("painel mostra prévia somente leitura e consultas seguem sem gravar depois da ativação", async (t) => {
  const { admin, distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 57503);
  const lote = await criarLote(distribuidor, pedido, 400);
  const server = await montarApp();
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api`;

  const previa = await fetch(`${base}/natal-2026/gestao/distribuidores`, { headers: token(admin) }).then((r) => r.json());
  assert.equal(previa[0].migrada, false);
  assert.equal(previa[0].compras.total, 57503);
  assert.equal(previa[0].cupons.total, 400);

  await ativarModelo();
  const gravacoes = await escritasEm(async () => {
    assert.equal((await fetch(`${base}/public/natal-2026/lotes/${lote.codigoPublico}`)).status, 200);
    assert.equal((await fetch(`${base}/natal-2026/gestao/painel`, { headers: token(admin) })).status, 200);
    assert.equal((await fetch(`${base}/natal-2026/gestao/distribuidores/${distribuidor._id}`, { headers: token(admin) })).status, 200);
  });
  assert.deepEqual(gravacoes, []);
});

// ---------- Migração controlada ----------

test("dry-run não grava dados e relata o que será feito", async () => {
  const { distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 57503);
  await criarLote(distribuidor, pedido, 400);
  let relatorio;
  const gravacoes = await escritasEm(async () => { relatorio = await analisarMigracao(); });
  assert.deepEqual(gravacoes, []);
  assert.ok(relatorio.simulacaoId);
  assert.equal(relatorio.modoAtual, "legado");
  assert.equal(relatorio.distribuidores[0].depois.cuponsLiberadosNaMigracao, 100);
  assert.equal(await NatalConta.countDocuments(), 0);
});

test("migração não concede: os 100 cupons adicionais só saem no processamento autorizado", async () => {
  const { distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 57503);
  const lote = await criarLote(distribuidor, pedido, 400);

  const migracao = await executarMigracao({ operador, now: DENTRO });
  assert.equal(migracao.movimentosCriados, 1);
  assert.equal(migracao.dadosOriginaisInalterados, true);
  assert.equal(migracao.integridade.ok, true);
  let conta = await contaDe(distribuidor);
  assert.equal(conta.cupons.total, 400);
  assert.equal(conta.cupons.conquistados, 0);
  assert.equal(conta.acumulado.totalCompras, 57503);
  assert.equal(await NatalBonificacao.countDocuments(), 0);

  const concessao = await concederBeneficios({ operador, now: DENTRO });
  assert.equal(concessao.cuponsLiberados, 100);
  conta = await contaDe(distribuidor);
  assert.equal(conta.cupons.total, 500);
  const movimento = await NatalMovimentoCupom.findOne({ tipo: "conquista" });
  assert.equal(movimento.origem.referencia, concessao.execucaoId);
  assert.equal((await concederBeneficios({ operador, now: DENTRO })).cuponsLiberados, 0);

  await ativarCumulativo({ operador, now: DENTRO });
  assert.equal((await contaDe(distribuidor)).cupons.total, 500);
  assert.equal((await NatalLote.findById(lote._id)).codigoPublico, lote.codigoPublico);
  const etapas = await NatalMigracaoExecucao.find({ status: "concluida" }).sort({ iniciadaEm: 1, _id: 1 });
  assert.deepEqual(etapas.map((item) => item.etapa), ["migracao", "concessao", "concessao", "ativacao"]);
  assert.ok(etapas.every((item) => item.operador === operador && item.execucaoId));
  assert.equal(await NatalAuditoria.countDocuments({ acao: "migracao_cumulativa" }), 4);
});

test("pedidos e aprovações antes da ativação não concedem nem criam conta", async () => {
  const { admin, distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 12000, { status: "aguardando_aprovacao" });
  const res = response();
  await aprovarPedidoAdmin({ usuario: admin, params: { id: String(pedido._id) } }, res);
  assert.equal(res.statusCode, 200, res.body?.message);
  assert.equal(await NatalConta.countDocuments(), 0);
  assert.equal(await NatalLote.countDocuments(), 0, "o modelo antigo também não concede");
  await ativarModelo();
  assert.equal((await contaDe(distribuidor)).cupons.total, 100);
});

test("sem troca de modo, gravações administrativas do modelo novo ficam bloqueadas", async () => {
  const { comercial, distribuidor } = await contexto();
  await assert.rejects(ajustarCuponsConta({ clienteId: distribuidor._id, quantidade: 5, motivo: "Tentativa antes da ativação", usuario: comercial }), { code: "cumulativo_inativo" });
  await assert.rejects(registrarCompraExterna({ clienteId: distribuidor._id, dados: COMPRA, arquivo: null, usuario: comercial, now: AGORA }), { code: "cumulativo_inativo" });
  await assert.rejects(concederBeneficios({ operador }), { code: "modo_invalido" });
  await assert.rejects(ativarCumulativo({ operador }), { code: "modo_invalido" });
});

test("links antigos usam o próprio lote antes e o saldo único depois, sem dobrar nem trocar identificadores", async () => {
  const { comercial, distribuidor } = await contexto();
  const pedidoA = await criarPedido(distribuidor, 100);
  const pedidoB = await criarPedido(distribuidor, 100);
  const loteA = await criarLote(distribuidor, pedidoA, 2);
  const loteB = await criarLote(distribuidor, pedidoB, 1);

  // Antes da migração: cadastros e aprovações funcionam no saldo de cada lote.
  const a1 = await cadastrar(loteA.codigoPublico);
  await aprovarParticipacao({ id: a1._id, usuario: comercial, now: DENTRO });
  const b1 = await cadastrar(loteB.codigoPublico);
  await aprovarParticipacao({ id: b1._id, usuario: comercial, now: DENTRO });
  assert.equal((await obterLotePublico(loteB.codigoPublico, { now: DENTRO })).motivo, "esgotado");
  assert.equal((await obterLotePublico(loteA.codigoPublico, { now: DENTRO })).aceitandoCadastros, true);

  const numeros = (await NatalCupom.find({}).sort({ numero: 1 })).map((item) => item.numero);
  await ativarModelo();
  assert.equal(await NatalConta.countDocuments(), 1);
  const conta = await contaDe(distribuidor);
  assert.equal(conta.cupons.total, 3);
  assert.equal(conta.contadores.aprovados, 2);
  assert.equal(conta.codigoPublico, undefined);

  // Depois: os dois links veem o mesmo saldo, e o lote B volta a aceitar pelo saldo único.
  assert.equal((await obterLotePublico(loteB.codigoPublico, { now: DENTRO })).aceitandoCadastros, true);
  const final = await cadastrar(loteB.codigoPublico);
  await aprovarParticipacao({ id: final._id, usuario: comercial, now: DENTRO });
  assert.equal((await obterLotePublico(loteA.codigoPublico, { now: DENTRO })).motivo, "esgotado");
  assert.equal((await obterLotePublico(loteB.codigoPublico, { now: DENTRO })).motivo, "esgotado");
  assert.deepEqual((await NatalCupom.find({ numero: { $in: numeros } }).sort({ numero: 1 })).map((item) => item.numero), numeros);
  assert.equal(await NatalCupom.countDocuments({ status: "valido" }), 3);
  assert.equal((await NatalLote.findById(loteA._id)).codigoPublico, loteA.codigoPublico);
});

test("durante a migração o link abre, mas cadastro e aprovação aguardam", async () => {
  const { comercial, distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 12000);
  const lote = await criarLote(distribuidor, pedido, 100);
  const pendente = await cadastrar(lote.codigoPublico);
  await executarMigracao({ operador, now: DENTRO });

  const publico = await obterLotePublico(lote.codigoPublico, { now: DENTRO });
  assert.equal(publico.distribuidorNome, distribuidor.nomeFantasia);
  assert.equal(publico.motivo, "manutencao");
  await assert.rejects(cadastrar(lote.codigoPublico), { statusCode: 503, code: "manutencao" });
  await assert.rejects(aprovarParticipacao({ id: pendente._id, usuario: comercial, now: DENTRO }), { statusCode: 503, code: "manutencao" });

  await concederBeneficios({ operador, now: DENTRO });
  await ativarCumulativo({ operador, now: DENTRO });
  assert.equal((await aprovarParticipacao({ id: pendente._id, usuario: comercial, now: DENTRO })).status, "aprovado");
});

test("execuções simultâneas: a trava admite uma só e nada duplica", async () => {
  const { distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 57503);
  await criarLote(distribuidor, pedido, 400);

  const resultados = await Promise.allSettled([1, 2, 3, 4].map(() => executarMigracao({ operador, now: DENTRO })));
  const recusadas = resultados.filter((item) => item.status === "rejected");
  assert.ok(resultados.some((item) => item.status === "fulfilled"));
  assert.ok(recusadas.every((item) => ["migracao_em_andamento", "modo_invalido"].includes(item.reason.code)), JSON.stringify(recusadas.map((item) => item.reason.message)));
  assert.equal(await NatalConta.countDocuments(), 1);
  assert.equal(await NatalMovimentoCupom.countDocuments(), 1);

  await Promise.allSettled([1, 2, 3, 4].map(() => concederBeneficios({ operador, now: DENTRO })));
  await concederBeneficios({ operador, now: DENTRO });
  assert.equal((await contaDe(distribuidor)).cupons.total, 500);
  assert.equal(await NatalMovimentoCupom.countDocuments({ tipo: "conquista" }), 1);
  assert.equal(await NatalMigracaoExecucao.countDocuments({ emAndamento: true }), 0);
});

test("trava presa recusa nova execução até a liberação do operador", async () => {
  await NatalMigracaoExecucao.createIndexes();
  await NatalMigracaoExecucao.create({ execucaoId: "presa", etapa: "migracao", operador, emAndamento: true, iniciadaEm: DENTRO });
  await assert.rejects(executarMigracao({ operador, now: DENTRO }), { code: "migracao_em_andamento" });
  await liberarTrava();
  assert.ok((await executarMigracao({ operador, now: DENTRO })).execucaoId);
});

test("ativação é recusada com integridade inválida e fica no histórico como falha", async () => {
  const { distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 12000);
  await criarLote(distribuidor, pedido, 100);
  await executarMigracao({ operador, now: DENTRO });
  await NatalConta.updateOne({ clienteId: distribuidor._id }, { $inc: { "cupons.total": 7 } });
  assert.equal((await validarIntegridade()).ok, false);
  await assert.rejects(ativarCumulativo({ operador, now: DENTRO }), { code: "integridade_invalida" });
  assert.equal((await NatalCampanhaEstado.findById("natal-2026")).modoCumulativo, "migrando");
  assert.equal((await NatalMigracaoExecucao.findOne({ etapa: "ativacao" })).status, "falhou");
});

test("reversão volta ao legado sem apagar cupons nem cadastros criados depois da ativação", async () => {
  const { comercial, distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 12000);
  const lote = await criarLote(distribuidor, pedido, 100);
  await ativarModelo();
  const aprovada = await cadastrar(lote.codigoPublico);
  const { cupom } = await aprovarParticipacao({ id: aprovada._id, usuario: comercial, now: DENTRO });

  await assert.rejects(reverterModo({ operador, motivo: "curto" }), { code: "motivo_invalido" });
  const reversao = await reverterModo({ operador, motivo: "Teste de reversão controlada", now: DENTRO });
  assert.equal(reversao.modoAnterior, "ativo");
  assert.equal(reversao.contasPreservadas, 1);
  assert.equal((await NatalCampanhaEstado.findById("natal-2026")).modoCumulativo, "legado");
  assert.equal(await NatalConta.countDocuments(), 1);
  assert.equal((await NatalCupom.findOne({ numero: cupom.numero })).status, "valido");
  assert.equal((await NatalParticipacao.findById(aprovada._id)).status, "aprovado");
  assert.equal((await obterLotePublico(lote.codigoPublico, { now: DENTRO })).aceitandoCadastros, true);

  // Reativar é idempotente.
  await ativarModelo();
  const conta = await contaDe(distribuidor);
  assert.equal(conta.cupons.total, 100);
  assert.equal(conta.contadores.aprovados, 1);
});

test("cadastros, cupons, comprovantes e distribuidores ficam idênticos em todos os estados", async () => {
  const { comercial, distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 20000);
  const lote = await criarLote(distribuidor, pedido, 200);
  const [aprovada, pendente, cancelada] = [await cadastrar(lote.codigoPublico), await cadastrar(lote.codigoPublico), await cadastrar(lote.codigoPublico)];
  await aprovarParticipacao({ id: aprovada._id, usuario: comercial, now: DENTRO });
  await aprovarParticipacao({ id: cancelada._id, usuario: comercial, now: DENTRO });
  await cancelarParticipacao({ id: cancelada._id, usuario: comercial, motivo: "Venda desfeita" });
  const detalhar = async () => JSON.stringify(await NatalParticipacao.find({}).sort({ _id: 1 }).select("-__v").lean());
  const participacoes = await detalhar();
  const foto = await fotografarDadosOriginais();
  await ativarModelo();
  assert.equal(await detalhar(), participacoes);
  assert.equal(await fotografarDadosOriginais(), foto);
  assert.equal((await NatalParticipacao.findById(pendente._id)).status, "pendente");
  assert.equal(String((await NatalParticipacao.findById(aprovada._id)).clienteId), String(distribuidor._id));
});

test("os sete distribuidores simulados acumulam, e abaixo de R$ 12 mil não recebem cupons", async () => {
  await usuario("admin");
  const cenarios = [
    [[57503], 400, 500], [[30507.52], 300, 300], [[12000, 3850.28], 100, 100],
    [[7815.16], 0, 0], [[5541.77], 0, 0], [[3006.5], 0, 0], [[2586.18], 0, 0],
  ];
  const clientes = [];
  for (const [valores, legado] of cenarios) {
    const cliente = await usuario("cliente");
    const pedidos = [];
    for (const valor of valores) pedidos.push(await criarPedido(cliente, valor));
    if (legado > 0) await criarLote(cliente, pedidos[0], legado);
    clientes.push(cliente);
  }
  await ativarModelo();
  assert.equal(await NatalConta.countDocuments(), 7);
  for (const [indice, [valores, , cupons]] of cenarios.entries()) {
    const conta = await contaDe(clientes[indice]);
    assert.equal(conta.cupons.total, cupons);
    assert.equal(conta.acumulado.totalCompras, Math.round(valores.reduce((soma, valor) => soma + valor, 0) * 100) / 100);
  }
  assert.equal(await NatalMovimentoCupom.countDocuments({ tipo: "conquista" }), 1);
});

// ---------- Aprovação ----------

test("aprovar libera, reprocessar não duplica, e faturar, enviar ou entregar não concede", async () => {
  await ativarModo();
  const { admin, distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 20000, { status: "aguardando_aprovacao" });
  const req = { usuario: admin, params: { id: String(pedido._id) } };
  const res = response();
  await aprovarPedidoAdmin(req, res);
  assert.equal(res.statusCode, 200, res.body?.message);
  assert.equal((await contaDe(distribuidor)).cupons.total, 200);

  await aprovarPedidoAdmin(req, response());
  const aprovado = await Pedido.findById(pedido._id);
  await Promise.all([1, 2, 3].map(() => sincronizarPedidoNatal({ pedido: aprovado, usuario: admin, origem: "aprovacao" })));
  for (const status of ["separando", "separado", "faturado", "enviado", "entregue"]) {
    await Pedido.updateOne({ _id: pedido._id }, { $set: { status } });
    await sincronizarPedidoNatal({ pedido: await Pedido.findById(pedido._id), usuario: admin, origem: "status" });
  }
  assert.equal((await contaDe(distribuidor)).cupons.total, 200);
  assert.equal(await NatalMovimentoCupom.countDocuments({ clienteId: distribuidor._id }), 1);
  assert.equal((await NatalBonificacao.findOne({ clienteId: distribuidor._id, tipo: "produtos" })).historico.length, 1);
});

test("alterações em pedidos aprovados seguem o recálculo cumulativo e a revisão", async () => {
  await ativarModo();
  const { admin, comercial, distribuidor } = await contexto();
  const Produto = (await import("../src/models/Produto.js")).default;
  const PrecoProduto = (await import("../src/models/PrecoProduto.js")).default;
  const tabelaPrecoId = new mongoose.Types.ObjectId();
  const produto = await Produto.create({ nome: "Shampoo", linha: "Banho", categoria: "Shampoo" });
  await PrecoProduto.create({ produtoId: produto._id, tabelaPrecoId, valor: 1000 });
  const pedido = await criarPedido(distribuidor, 12000, {
    tabelaPrecoId,
    status: "aguardando_aprovacao",
    itens: [{ produtoId: produto._id, nomeProduto: "Shampoo", quantidade: 12, valorUnitario: 1000, subtotal: 12000 }],
  });
  await aprovarPedidoAdmin({ usuario: admin, params: { id: String(pedido._id) } }, response());
  const editar = async (quantidade, revisaoBeneficios) => {
    const atual = await Pedido.findById(pedido._id);
    const res = response();
    await atualizarPedidoAdmin({
      usuario: comercial,
      params: { id: String(pedido._id) },
      body: { versaoPedido: atual.__v, itens: [{ produtoId: String(produto._id), quantidade }], ...(revisaoBeneficios ? { revisaoBeneficios } : {}) },
    }, res);
    return res;
  };
  assert.equal((await editar(20)).statusCode, 200);
  assert.equal((await contaDe(distribuidor)).cupons.total, 200);
  const semDecisao = await editar(12);
  assert.equal(semDecisao.statusCode, 409);
  assert.equal(semDecisao.body.codigo, "revisao_beneficios_obrigatoria");
  assert.equal((await editar(12, { decisao: "adequar", justificativa: "Pedido reduzido pelo distribuidor" })).statusCode, 200);
  assert.equal((await contaDe(distribuidor)).cupons.total, 100);
});

// ---------- Support Pet (dados fictícios) ----------

const cenarioSimbolico = async () => {
  const ctx = await contexto();
  const pedido = await criarPedido(ctx.distribuidor, 12000, {
    itens: [{ produtoId: new mongoose.Types.ObjectId(), nomeProduto: "cupom campanha", quantidade: 12000, valorUnitario: 1, subtotal: 12000 }],
  });
  await criarPedido(ctx.distribuidor, 3850.28, { status: "separado" });
  const lote = await criarLote(ctx.distribuidor, pedido, 100);
  return { ...ctx, pedido, lote };
};

test("simulação de substituição não altera dados nem cria compra externa", async () => {
  const { distribuidor, pedido } = await cenarioSimbolico();
  await ativarModelo();
  const antesPedido = JSON.stringify(await Pedido.findById(pedido._id).lean());
  let previa;
  const gravacoes = await escritasEm(async () => {
    previa = await previaSubstituicao({ pedidoId: pedido._id, dados: COMPRA, now: AGORA });
  });
  assert.deepEqual(gravacoes, []);
  assert.equal(previa.antes.acumulado, 15850.28);
  assert.equal(previa.depois.acumulado, 15850.28);
  assert.equal(previa.depois.cupons, 100);
  assert.equal(previa.cuponsNovos, 0);
  assert.equal(previa.exigeRevisao, false);
  assert.equal(previa.podeAplicar, true);
  assert.equal(previa.habilitada, false);
  assert.equal(await NatalCompraExterna.countDocuments(), 0);
  assert.equal(await NatalSubstituicaoCompra.countDocuments(), 0);
  assert.equal(JSON.stringify(await Pedido.findById(pedido._id).lean()), antesPedido);
  assert.equal((await contaDe(distribuidor)).cupons.total, 100);
});

test("prévia aponta diferença de valor, duplicidade e necessidade de revisão", async () => {
  const { comercial, distribuidor, pedido } = await cenarioSimbolico();
  await ativarModelo();
  const menor = await previaSubstituicao({ pedidoId: pedido._id, dados: { ...COMPRA, valor: 5000 }, now: AGORA });
  assert.equal(menor.diferenca, -7000);
  assert.equal(menor.depois.acumulado, 8850.28);
  assert.equal(menor.depois.cupons, 0);
  assert.equal(menor.exigeRevisao, true);
  assert.ok(menor.alertas.some((item) => item.codigo === "valor_diferente"));
  const maior = await previaSubstituicao({ pedidoId: pedido._id, dados: { ...COMPRA, valor: 20000 }, now: AGORA });
  assert.equal(maior.cuponsNovos, 100);
  await registrarCompraExterna({ clienteId: distribuidor._id, dados: COMPRA, arquivo: null, usuario: comercial, now: AGORA });
  const repetida = await previaSubstituicao({ pedidoId: pedido._id, dados: COMPRA, now: AGORA });
  assert.equal(repetida.podeAplicar, false);
  assert.ok(repetida.bloqueios.some((item) => item.codigo === "referencia_duplicada"));
});

test("substituição fica indisponível sem autorização específica", async () => {
  const { admin, comercial, pedido } = await cenarioSimbolico();
  await ativarModelo();
  const args = { pedidoId: pedido._id, dados: COMPRA, motivo: "Regularização autorizada", confirmacao: { acumuladoDepois: 15850.28 }, now: AGORA };
  await assert.rejects(aplicarSubstituicao({ ...args, usuario: admin }), { code: "substituicao_desabilitada" });
  process.env.NATAL2026_SUBSTITUICAO_HABILITADA = "true";
  await assert.rejects(aplicarSubstituicao({ ...args, usuario: comercial }), { statusCode: 403 });
  assert.equal(await NatalCompraExterna.countDocuments(), 0);
});

test("substituição troca a origem de forma atômica, sem somar duas vezes e preservando links e cupons", async () => {
  const { admin, comercial, distribuidor, pedido, lote } = await cenarioSimbolico();
  await ativarModelo();
  const participacao = await cadastrar(lote.codigoPublico);
  const { cupom } = await aprovarParticipacao({ id: participacao._id, usuario: comercial, now: DENTRO });
  const pedidoAntes = JSON.stringify(await Pedido.findById(pedido._id).lean());
  process.env.NATAL2026_SUBSTITUICAO_HABILITADA = "true";
  const args = { pedidoId: pedido._id, dados: COMPRA, motivo: "Regularização autorizada", usuario: admin, now: AGORA };

  await assert.rejects(aplicarSubstituicao({ ...args, confirmacao: { acumuladoDepois: 999 } }), { code: "previa_desatualizada" });
  const resultados = await Promise.allSettled([1, 2, 3].map(() => aplicarSubstituicao({ ...args, confirmacao: { acumuladoDepois: 15850.28 } })));
  assert.ok(resultados.some((item) => item.status === "fulfilled"));
  const repetida = await aplicarSubstituicao({ ...args, confirmacao: { acumuladoDepois: 15850.28 } });
  assert.equal(repetida.repetida, true);

  assert.equal(await NatalSubstituicaoCompra.countDocuments(), 1);
  assert.equal(await NatalCompraExterna.countDocuments({ status: "validada" }), 1);
  const conta = await contaDe(distribuidor);
  assert.equal(conta.acumulado.totalCompras, 15850.28, "pedido e compra não somam juntos");
  assert.equal(conta.cupons.total, 100);
  assert.equal(conta.cupons.conquistados, 0);
  assert.equal(conta.revisaoPendente, undefined);
  assert.equal(JSON.stringify(await Pedido.findById(pedido._id).lean()), pedidoAntes, "pedido original fica intacto para auditoria");
  assert.equal((await NatalCupom.findOne({ numero: cupom.numero })).status, "valido");
  assert.equal((await obterLotePublico(lote.codigoPublico, { now: DENTRO })).aceitandoCadastros, true);
  assert.equal(await NatalAuditoria.countDocuments({ acao: "compra_origem_substituida" }), 1);

  // Outra compra não pode substituir o mesmo pedido.
  await assert.rejects(
    aplicarSubstituicao({ ...args, dados: { ...COMPRA, referencia: "NF 901" }, confirmacao: { acumuladoDepois: 15850.28 } }),
    { code: "substituicao_existente" }
  );
});

test("falha intermediária não deixa substituição parcial", async (t) => {
  const { admin, distribuidor, pedido } = await cenarioSimbolico();
  await ativarModelo();
  process.env.NATAL2026_SUBSTITUICAO_HABILITADA = "true";
  const criar = NatalAuditoria.create.bind(NatalAuditoria);
  t.mock.method(NatalAuditoria, "create", async (docs, opcoes) => {
    if (docs?.[0]?.acao === "compra_origem_substituida") throw new Error("falha simulada");
    return criar(docs, opcoes);
  });
  await assert.rejects(aplicarSubstituicao({
    pedidoId: pedido._id, dados: COMPRA, motivo: "Regularização autorizada", confirmacao: { acumuladoDepois: 15850.28 }, usuario: admin, now: AGORA,
  }), /falha simulada/);
  t.mock.restoreAll();
  assert.equal(await NatalCompraExterna.countDocuments(), 0);
  assert.equal(await NatalSubstituicaoCompra.countDocuments(), 0);
  assert.equal((await contaDe(distribuidor)).acumulado.totalCompras, 15850.28);
});

test("compra menor na substituição abre revisão e não invalida participações", async () => {
  const { admin, comercial, distribuidor, pedido, lote } = await cenarioSimbolico();
  await ativarModelo();
  const participacao = await cadastrar(lote.codigoPublico);
  await aprovarParticipacao({ id: participacao._id, usuario: comercial, now: DENTRO });
  process.env.NATAL2026_SUBSTITUICAO_HABILITADA = "true";
  await aplicarSubstituicao({
    pedidoId: pedido._id, dados: { ...COMPRA, valor: 5000 }, motivo: "Regularização autorizada", confirmacao: { acumuladoDepois: 8850.28 }, usuario: admin, now: AGORA,
  });
  const conta = await contaDe(distribuidor);
  assert.equal(conta.cupons.total, 100);
  assert.ok(conta.revisaoPendente);
  assert.equal((await NatalParticipacao.findById(participacao._id)).status, "aprovado");
});

test("pedido do cenário Support Pet permanece intacto e nenhuma compra é criada na migração", async () => {
  const { pedido, lote } = await cenarioSimbolico();
  const pedidoAntes = JSON.stringify(await Pedido.findById(pedido._id).lean());
  const loteAntes = JSON.stringify(await NatalLote.findById(lote._id).lean());
  await ativarModelo();
  assert.equal(JSON.stringify(await Pedido.findById(pedido._id).lean()), pedidoAntes);
  assert.equal(JSON.stringify(await NatalLote.findById(lote._id).lean()), loteAntes);
  assert.equal(await NatalCompraExterna.countDocuments(), 0);
  assert.equal(await NatalBonificacao.countDocuments({ valorEntregue: { $gt: 0 } }), 0);
});

// ---------- Concorrência ----------

test("aprovações de pedidos simultâneas somam sem duplicar", async () => {
  await ativarModo();
  const { admin, distribuidor } = await contexto();
  const pedidos = [];
  for (const valor of [12000, 8000, 20000, 12000]) pedidos.push(await criarPedido(distribuidor, valor, { status: "aguardando_aprovacao" }));
  await Promise.all(pedidos.map((pedido) => aprovarPedidoAdmin({ usuario: admin, params: { id: String(pedido._id) } }, response())));
  const conta = await contaDe(distribuidor);
  assert.equal(conta.acumulado.totalCompras, 52000);
  assert.equal(conta.cupons.total, 500);
});

test("cadastros simultâneos respeitam a fila do saldo compartilhado", async () => {
  await ativarModo();
  const { distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 12000);
  await sincronizarPedidoNatal({ pedido, usuario: null, origem: "aprovacao" });
  const conta = await contaDe(distribuidor);
  await NatalConta.updateOne({ _id: conta._id }, { $set: { "cupons.total": 1 } });
  const resultados = await Promise.allSettled(Array.from({ length: 60 }, () => cadastrar(conta.codigoPublico)));
  const aceitos = resultados.filter((item) => item.status === "fulfilled").length;
  assert.equal(aceitos, 51, "1 vaga + folga de 50 na fila");
  assert.equal((await contaDe(distribuidor)).contadores.pendentes, aceitos);
  assert.equal(await NatalParticipacao.countDocuments({ status: "pendente" }), aceitos);
});

test("consumo simultâneo no modelo legado nunca ultrapassa o lote nem cruza a troca de modo", async () => {
  const { comercial, distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 100);
  const lote = await criarLote(distribuidor, pedido, 2);
  const participacoes = [];
  for (let i = 0; i < 5; i += 1) participacoes.push(await cadastrar(lote.codigoPublico));
  await Promise.allSettled([
    ...participacoes.map((item) => aprovarParticipacao({ id: item._id, usuario: comercial, now: DENTRO })),
    executarMigracao({ operador, now: DENTRO }),
  ]);
  const aprovadas = await NatalParticipacao.countDocuments({ status: "aprovado" });
  assert.ok(aprovadas <= 2);
  assert.equal((await NatalLote.findById(lote._id)).contadores.aprovados, aprovadas);
  assert.equal(await NatalCupom.countDocuments({ status: "valido" }), aprovadas);
  await concederBeneficios({ operador, now: DENTRO });
  await ativarCumulativo({ operador, now: DENTRO });
  const conta = await contaDe(distribuidor);
  assert.equal(conta.contadores.aprovados, aprovadas);
  assert.equal(conta.contadores.pendentes, 5 - aprovadas);
});

test("consumo simultâneo pelo cancelamento do pedido segue revisão, sem invalidar", async () => {
  await ativarModo();
  const { admin, comercial, distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 12000);
  await sincronizarPedidoNatal({ pedido, usuario: null, origem: "aprovacao" });
  const conta = await contaDe(distribuidor);
  const participacoes = [];
  for (let i = 0; i < 4; i += 1) participacoes.push(await cadastrar(conta.codigoPublico));
  const res = response();
  await Promise.allSettled([
    atualizarStatusPedido({ usuario: admin, params: { id: String(pedido._id) }, body: { status: "cancelado" } }, res),
    ...participacoes.map((item) => aprovarParticipacao({ id: item._id, usuario: comercial, now: DENTRO })),
  ]);
  const final = await contaDe(distribuidor);
  assert.ok(final.revisaoPendente);
  assert.equal(final.cupons.total, 100);
  assert.equal(await NatalParticipacao.countDocuments({ status: "aprovado" }), final.contadores.aprovados);
});
