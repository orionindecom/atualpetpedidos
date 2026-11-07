import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { buildNatalConfig } from "../src/config/natalPremiado2026.js";
import Pedido from "../src/models/Pedido.js";
import Usuario from "../src/models/Usuario.js";
import NatalConta from "../src/models/NatalConta.js";
import NatalCupom from "../src/models/NatalCupom.js";
import NatalDistribuicao from "../src/models/NatalDistribuicao.js";
import NatalParticipacao from "../src/models/NatalParticipacao.js";
import { NatalCampanhaEstado } from "../src/models/NatalCampanhaEstado.js";
import natalRoutes, { natalPublicRoutes } from "../src/routes/natalRoutes.js";
import { aprovarPedidoAdmin, atualizarStatusPedido } from "../src/controllers/pedidoController.js";
import { resetIndicesNatalParaTestes } from "../src/services/natalBaseService.js";
import { criarStorageMemoria, setComprovanteStorage, validarArquivoComprovante } from "../src/services/natalComprovanteService.js";
import { LIMITE_CUPONS_POR_LOTE, validarQuantidadeCupons } from "../src/services/natalDistribuicaoService.js";
import {
  gerarExportacao,
  gerarResultadoSorteio,
  listarCuponsAuditoria,
  listarCuponsValidosParaSorteio,
  mascararDocumento,
  resumirListaSorteio,
} from "../src/services/natalExportacaoService.js";
import { listarParticipacoes } from "../src/services/natalGestaoService.js";
import { ativarMultiplosCupons, migrarMultiplosCupons, verificarInvariantes } from "../src/services/natalMultiplosCuponsService.js";
import {
  adicionarCuponsCadastro,
  aprovarDistribuicao,
  aprovarParticipacao,
  cancelarDistribuicao,
  cancelarParticipacao,
  obterLotePublico,
  registrarEnvioPublico,
  rejeitarDistribuicao,
  rejeitarParticipacao,
} from "../src/services/natalParticipacaoService.js";
import { resolverRevisaoPendente } from "../src/services/natalRevisaoService.js";

process.env.JWT_SECRET ||= "segredo-de-teste-com-mais-de-32-caracteres!!";

let replSet;
const storage = criarStorageMemoria();
const DENTRO = new Date("2026-11-20T15:00:00.000Z");
const DEPOIS_DO_PRAZO = new Date("2026-12-11T15:00:00.000Z");
const CRIADO_EM = new Date("2026-11-10T13:00:00.000Z");

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: "natal-multiplos" });
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
  await NatalCampanhaEstado.create({ _id: "natal-2026", modoCumulativo: "ativo", multiplosCupons: true });
  storage.arquivos.clear();
});

let sequencia = 0;
const criarUsuario = (tipo) => {
  sequencia += 1;
  return Usuario.create({
    nomeResponsavel: `${tipo} ${sequencia}`,
    nomeFantasia: tipo === "cliente" ? `Distribuidora ${sequencia}` : undefined,
    razaoSocial: tipo === "cliente" ? `Distribuidora ${sequencia} LTDA` : undefined,
    email: `${tipo}${sequencia}@multiplos.local`,
    senha: "hash",
    tipo,
    statusCadastro: "aprovado",
  });
};

const criarPedido = async (cliente, valorTotal) => {
  sequencia += 1;
  return Pedido.create({
    numeroPedido: `PED-M${sequencia}`,
    clienteId: cliente._id,
    nomeFantasiaCliente: cliente.nomeFantasia,
    razaoSocialCliente: cliente.razaoSocial,
    tabelaPrecoId: new mongoose.Types.ObjectId(),
    dia: 10, mes: 11, ano: 2026,
    itens: [{ produtoId: new mongoose.Types.ObjectId(), nomeProduto: "Shampoo", quantidade: 1, valorUnitario: valorTotal, subtotal: valorTotal }],
    valorTotal,
    status: "aguardando_aprovacao",
    createdAt: CRIADO_EM,
  });
};

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const liberar = async (cliente, admin, valor) => {
  const pedido = await criarPedido(cliente, valor);
  const res = response();
  await aprovarPedidoAdmin({ usuario: admin, params: { id: String(pedido._id) } }, res);
  assert.equal(res.statusCode, 200, res.body?.message);
  return { pedido, conta: await NatalConta.findOne({ clienteId: cliente._id }) };
};

const contexto = async () => {
  const [admin, comercial, distribuidor, outroDistribuidor] = await Promise.all([
    criarUsuario("admin"), criarUsuario("comercial"), criarUsuario("cliente"), criarUsuario("cliente"),
  ]);
  return { admin, comercial, distribuidor, outroDistribuidor };
};

let cnpjSeq = 500;
const gerarCnpj = () => {
  cnpjSeq += 1;
  const base = `${String(20000000 + cnpjSeq).slice(-8)}0001`;
  const calc = (digits, weights) => {
    const rest = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = calc(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(`${base}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${d1}${d2}`;
};

let marcaSeq = 0;
const arquivo = () => {
  marcaSeq += 1;
  const buffer = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`marca-${marcaSeq}-`), Buffer.alloc(400, 7)]);
  return { buffer, meta: validarArquivoComprovante({ buffer, mimetype: "image/png", originalname: "nota.png" }) };
};

const dados = (extra = {}) => ({
  vendedorNome: "Carlos Vendedor",
  nomeFantasia: "Pet Amigo Fiel",
  razaoSocial: "Pet Amigo Fiel LTDA",
  documento: gerarCnpj(),
  tipoDocumento: "cnpj",
  responsavel: "Ana Souza",
  whatsapp: "11987654321",
  instagram: "amigofiel",
  dataCompra: "2026-11-15",
  valorCompra: 1200,
  ...extra,
});

const chave = () => `chave-${new mongoose.Types.ObjectId()}`;

const enviar = (conta, { quantidade = 1, dadosEnvio = dados(), chaveIdempotencia, now = DENTRO, config } = {}) => registrarEnvioPublico({
  codigo: conta.codigoPublico,
  dados: dadosEnvio,
  arquivo: arquivo(),
  quantidade,
  chaveIdempotencia,
  ip: "10.0.0.9",
  userAgent: "teste",
  now,
  ...(config ? { config } : {}),
});

const adicionar = (participacaoId, usuario, { quantidade, chaveIdempotencia = chave(), now = DENTRO } = {}) => adicionarCuponsCadastro({
  participacaoId,
  usuario,
  dados: { vendedorNome: "Rafa Vendedora", dataCompra: "2026-11-18", valorCompra: 900 },
  arquivo: arquivo(),
  quantidade,
  chaveIdempotencia,
  ip: "10.0.0.9",
  userAgent: "teste",
  now,
});

const saldo = async (cliente) => {
  const conta = await NatalConta.findOne({ clienteId: cliente._id }).lean();
  return {
    total: conta.cupons.total,
    aprovados: conta.contadores.aprovados,
    pendentes: conta.contadores.pendentes,
    disponivel: conta.cupons.total - conta.contadores.aprovados - conta.contadores.pendentes,
  };
};

// ---------- 1 a 8: quantidade e saldo ----------

test("1. cadastro com 1 cupom gera um cadastro, um lote e um número aguardando validação", async () => {
  const { admin, distribuidor } = await contexto();
  const { conta } = await liberar(distribuidor, admin, 12000);
  const resultado = await enviar(conta, { quantidade: 1 });
  assert.equal(resultado.repetida, false);
  assert.equal(resultado.cupons.length, 1);
  assert.equal(resultado.cupons[0].status, "pendente");
  assert.equal(await NatalParticipacao.countDocuments(), 1);
  assert.equal(await NatalDistribuicao.countDocuments(), 1);
  assert.deepEqual(await saldo(distribuidor), { total: 100, aprovados: 0, pendentes: 1, disponivel: 99 });
});

test("2. cadastro com 25 cupons gera 25 cupons individuais em um único cadastro e o saldo cai 25", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const { conta } = await liberar(distribuidor, admin, 12000);
  const resultado = await enviar(conta, { quantidade: 25 });
  assert.equal(resultado.distribuicao.quantidade, 25);
  assert.equal(resultado.cupons.length, 25);
  assert.equal(new Set(resultado.cupons.map((cupom) => cupom.numero)).size, 25, "números únicos");
  assert.equal(await NatalParticipacao.countDocuments(), 1, "um cadastro, não 25");
  assert.equal((await saldo(distribuidor)).disponivel, 75);
  // Aguardando validação: fora do sorteio.
  assert.equal((await listarCuponsValidosParaSorteio()).length, 0);
  const aprovada = await aprovarParticipacao({ id: resultado.distribuicao.participacaoId, usuario: comercial, now: DENTRO });
  assert.equal(aprovada.cupons.validos, 25);
  assert.equal(aprovada.cupom, undefined, "cadastro de vários cupons não usa o campo antigo");
  assert.deepEqual(await saldo(distribuidor), { total: 100, aprovados: 25, pendentes: 0, disponivel: 75 });
  assert.equal((await listarCuponsValidosParaSorteio()).length, 25);
  const publico = await obterLotePublico(conta.codigoPublico, { now: DENTRO });
  assert.equal(publico.saldo.disponiveis, 75);
  assert.equal(publico.saldo.distribuidos, 25);
  assert.equal(publico.maximoPorEnvio, 75);
});

test("3 e 4. usar todo o saldo é permitido; ultrapassar é recusado sem gravar nada", async () => {
  const { admin, distribuidor } = await contexto();
  const { conta } = await liberar(distribuidor, admin, 12000);
  await assert.rejects(enviar(conta, { quantidade: 101 }), { code: "saldo_insuficiente" });
  assert.equal(await NatalParticipacao.countDocuments(), 0);
  assert.equal(storage.arquivos.size, 0, "nenhum comprovante guardado");
  await enviar(conta, { quantidade: 100 });
  assert.equal((await saldo(distribuidor)).disponivel, 0);
  await assert.rejects(enviar(conta, { quantidade: 1 }), { code: "fila_cheia" });
  assert.equal((await obterLotePublico(conta.codigoPublico, { now: DENTRO })).aceitandoCadastros, false);
  assert.equal(await NatalCupom.countDocuments(), 100);
});

test("5 a 8. quantidade zero, negativa, decimal, inválida e extremamente alta são recusadas", async () => {
  for (const valor of [0, "0", -1, "-5", 1.5, "2.5", "1,5", "", " ", null, "abc", "1e3", "10a", Number.NaN, Infinity, "99999999"]) {
    assert.equal(validarQuantidadeCupons(valor).valid, false, `aceitou ${String(valor)}`);
  }
  assert.equal(validarQuantidadeCupons(LIMITE_CUPONS_POR_LOTE + 1).valid, false);
  assert.equal(validarQuantidadeCupons("7").quantidade, 7);
  assert.equal(validarQuantidadeCupons(7, { maximo: 6 }).valid, false);

  const { admin, distribuidor } = await contexto();
  const { conta } = await liberar(distribuidor, admin, 40000);
  for (const valor of [0, -3, 2.5, "x", 5000]) {
    await assert.rejects(enviar(conta, { quantidade: valor }), { code: "quantidade_invalida" });
  }
  assert.equal(await NatalCupom.countDocuments(), 0);
  assert.equal((await saldo(distribuidor)).pendentes, 0);
});

// ---------- 9 a 12: concorrência, idempotência e atomicidade ----------

test("9. dois vendedores ao mesmo tempo: 15 + 10 com saldo 20 aprova só um", async () => {
  const { admin, distribuidor } = await contexto();
  const { conta } = await liberar(distribuidor, admin, 12000);
  await NatalConta.updateOne({ _id: conta._id }, { $set: { "cupons.total": 20 } });
  const resultados = await Promise.allSettled([enviar(conta, { quantidade: 15 }), enviar(conta, { quantidade: 10 })]);
  const aceitos = resultados.filter((item) => item.status === "fulfilled");
  assert.equal(aceitos.length, 1);
  const quantidade = aceitos[0].value.distribuicao.quantidade;
  const atual = await saldo(distribuidor);
  assert.equal(atual.pendentes, quantidade);
  assert.ok(atual.disponivel >= 0, "saldo nunca negativo");
  assert.equal(await NatalCupom.countDocuments(), quantidade);
  assert.equal(await NatalParticipacao.countDocuments(), 1);
  assert.equal(storage.arquivos.size, 1, "comprovante do envio recusado removido");
});

test("9b. muitos envios simultâneos nunca passam do saldo", async () => {
  const { admin, distribuidor } = await contexto();
  const { conta } = await liberar(distribuidor, admin, 12000);
  await NatalConta.updateOne({ _id: conta._id }, { $set: { "cupons.total": 30 } });
  await Promise.allSettled(Array.from({ length: 12 }, () => enviar(conta, { quantidade: 7 })));
  const atual = await saldo(distribuidor);
  assert.ok(atual.pendentes <= 30);
  assert.equal(atual.pendentes % 7, 0);
  assert.equal(await NatalCupom.countDocuments(), atual.pendentes);
  assert.equal(await NatalDistribuicao.countDocuments(), atual.pendentes / 7);
});

test("10 e 11. requisição repetida e retry após timeout devolvem o resultado original sem novo consumo", async () => {
  const { admin, distribuidor } = await contexto();
  const { conta } = await liberar(distribuidor, admin, 12000);
  const id = chave();
  const dadosEnvio = dados();
  const primeiro = await enviar(conta, { quantidade: 12, chaveIdempotencia: id, dadosEnvio });
  const repetido = await enviar(conta, { quantidade: 12, chaveIdempotencia: id, dadosEnvio });
  assert.equal(repetido.repetida, true);
  assert.equal(repetido.distribuicao.protocolo, primeiro.distribuicao.protocolo);
  assert.deepEqual(repetido.cupons.map((item) => item.numero), primeiro.cupons.map((item) => item.numero));
  // Timeout: o cliente reenvia enquanto a primeira ainda está gravando.
  const outra = chave();
  const simultaneos = await Promise.all([
    enviar(conta, { quantidade: 5, chaveIdempotencia: outra }),
    enviar(conta, { quantidade: 5, chaveIdempotencia: outra }),
    enviar(conta, { quantidade: 5, chaveIdempotencia: outra }),
  ]);
  assert.equal(new Set(simultaneos.map((item) => item.distribuicao.protocolo)).size, 1);
  assert.equal(simultaneos.filter((item) => !item.repetida).length, 1);
  assert.equal((await saldo(distribuidor)).pendentes, 17, "12 + 5, uma vez cada");
  assert.equal(await NatalCupom.countDocuments(), 17);
  assert.equal(storage.arquivos.size, 2, "comprovantes repetidos não ficam guardados");
});

test("12. falha na geração dos números desfaz tudo: saldo, cadastro, lote e comprovante", async () => {
  const { admin, distribuidor } = await contexto();
  const { conta } = await liberar(distribuidor, admin, 12000);
  const config = buildNatalConfig({ NATAL2026_CUPOM_MIN: "1", NATAL2026_CUPOM_MAX: "10", NATAL2026_CUPOM_DIGITOS: "4" });
  await enviar(conta, { quantidade: 6, config });
  // 4 números livres para 5 cupons: a falha ocorre depois da reserva e da criação do cadastro.
  await assert.rejects(enviar(conta, { quantidade: 5, config }), { statusCode: 503, code: "numeracao_esgotada" });
  assert.equal(await NatalParticipacao.countDocuments(), 1);
  assert.equal(await NatalDistribuicao.countDocuments(), 1);
  assert.equal(await NatalCupom.countDocuments(), 6);
  assert.equal((await saldo(distribuidor)).pendentes, 6);
  assert.equal(storage.arquivos.size, 1);
});

// ---------- 13 a 16: adição de cupons e aprovação ----------

test("13. adicionar 10 cupons a um cadastro de 25: mesmo cadastro, total 35, saldo -10", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const { conta } = await liberar(distribuidor, admin, 12000);
  const inicial = await enviar(conta, { quantidade: 25 });
  const participacaoId = inicial.distribuicao.participacaoId;
  await aprovarParticipacao({ id: participacaoId, usuario: comercial, now: DENTRO });
  const adicao = await adicionar(participacaoId, distribuidor, { quantidade: 10 });
  assert.equal(String(adicao.distribuicao.participacaoId), String(participacaoId));
  assert.equal(adicao.participacao.cupons.total, 35);
  assert.equal(await NatalParticipacao.countDocuments(), 1, "sem duplicar o cadastro");
  assert.equal((await saldo(distribuidor)).disponivel, 65);
  // Lote adicional aguarda a Letícia: os 25 continuam válidos, os 10 ainda não.
  assert.equal((await listarCuponsValidosParaSorteio()).length, 25);
  await aprovarDistribuicao({ id: adicao.distribuicao._id, usuario: comercial, now: DENTRO });
  assert.equal((await listarCuponsValidosParaSorteio()).length, 35);
  const cadastro = await NatalParticipacao.findById(participacaoId);
  assert.equal(cadastro.cupons.validos, 35);
  assert.equal(cadastro.status, "aprovado");
  assert.equal(await NatalDistribuicao.countDocuments({ participacaoId }), 2, "histórico das duas distribuições");
});

test("13b. link público com CNPJ já cadastrado vira novo lote do mesmo cadastro, sem revelar nada", async () => {
  const { admin, distribuidor } = await contexto();
  const { conta } = await liberar(distribuidor, admin, 12000);
  const documento = gerarCnpj();
  const primeiro = await enviar(conta, { quantidade: 5, dadosEnvio: dados({ documento }) });
  const segundo = await enviar(conta, { quantidade: 3, dadosEnvio: dados({ documento, whatsapp: "11911112222" }) });
  assert.equal(String(segundo.distribuicao.participacaoId), String(primeiro.distribuicao.participacaoId));
  assert.notEqual(segundo.distribuicao.protocolo, primeiro.distribuicao.protocolo);
  assert.equal(await NatalParticipacao.countDocuments(), 1);
  const lote = await NatalDistribuicao.findById(segundo.distribuicao._id);
  assert.equal(lote.tipo, "adicional");
  assert.equal(lote.dadosInformados.divergente, true, "dados diferentes ficam para a gestão comparar");
  assert.equal((await NatalParticipacao.findById(primeiro.distribuicao.participacaoId)).petshop.whatsapp, "11987654321", "cadastro não é sobrescrito");
  // Envios simultâneos do mesmo CNPJ não criam dois cadastros.
  const outro = gerarCnpj();
  await Promise.all([1, 2, 3, 4].map(() => enviar(conta, { quantidade: 2, dadosEnvio: dados({ documento: outro }) })));
  assert.equal(await NatalParticipacao.countDocuments({ "petshop.documento": outro }), 1);
  assert.equal((await NatalParticipacao.findOne({ "petshop.documento": outro })).cupons.total, 8);
});

test("14. distribuidor não adiciona cupons ao cadastro de outro; gestão também não emite", async () => {
  const { admin, comercial, distribuidor, outroDistribuidor } = await contexto();
  const { conta } = await liberar(distribuidor, admin, 12000);
  await liberar(outroDistribuidor, admin, 12000);
  const inicial = await enviar(conta, { quantidade: 4 });
  const antes = await saldo(outroDistribuidor);
  await assert.rejects(adicionar(inicial.distribuicao.participacaoId, outroDistribuidor, { quantidade: 2 }), { statusCode: 404 });
  await assert.rejects(adicionar(inicial.distribuicao.participacaoId, comercial, { quantidade: 2 }), { statusCode: 403 });
  assert.deepEqual(await saldo(outroDistribuidor), antes);
  assert.equal(await NatalCupom.countDocuments(), 4);
  // O mesmo CNPJ por outro distribuidor é outro cadastro, com saldo próprio.
  const contaOutro = await NatalConta.findOne({ clienteId: outroDistribuidor._id });
  const documento = (await NatalParticipacao.findById(inicial.distribuicao.participacaoId)).petshop.documento;
  const noOutro = await enviar(contaOutro, { quantidade: 3, dadosEnvio: dados({ documento }) });
  assert.notEqual(String(noOutro.distribuicao.participacaoId), String(inicial.distribuicao.participacaoId));
  assert.equal((await saldo(distribuidor)).pendentes, 4);
  assert.equal((await saldo(outroDistribuidor)).pendentes, 3);
});

test("15. cadastro pendente: lote extra também aguarda e só vale com a aprovação do cadastro", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const { conta } = await liberar(distribuidor, admin, 12000);
  const inicial = await enviar(conta, { quantidade: 5 });
  const id = inicial.distribuicao.participacaoId;
  const extra = await adicionar(id, distribuidor, { quantidade: 3 });
  await assert.rejects(aprovarDistribuicao({ id: extra.distribuicao._id, usuario: comercial, now: DENTRO }), { code: "cadastro_nao_aprovado" });
  assert.equal((await NatalParticipacao.findById(id)).status, "pendente", "adição não aprova o cadastro");
  const aprovada = await aprovarParticipacao({ id, usuario: comercial, now: DENTRO });
  assert.equal(aprovada.cupons.validos, 8);
  assert.equal(await NatalDistribuicao.countDocuments({ participacaoId: id, status: "aprovado" }), 2);
  assert.deepEqual(await saldo(distribuidor), { total: 100, aprovados: 8, pendentes: 0, disponivel: 92 });
});

test("16. cadastro rejeitado: saldo volta, não recebe cupons e não é reativado por novo envio", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const { conta } = await liberar(distribuidor, admin, 12000);
  const documento = gerarCnpj();
  const inicial = await enviar(conta, { quantidade: 6, dadosEnvio: dados({ documento }) });
  const id = inicial.distribuicao.participacaoId;
  await rejeitarParticipacao({ id, usuario: comercial, motivo: "Não segue o @atualpet" });
  assert.equal((await saldo(distribuidor)).pendentes, 0);
  assert.equal(await NatalCupom.countDocuments({ participacaoId: id, status: "rejeitado" }), 6);
  await assert.rejects(adicionar(id, distribuidor, { quantidade: 2 }), { code: "cadastro_inativo" });
  const novo = await enviar(conta, { quantidade: 2, dadosEnvio: dados({ documento }) });
  assert.notEqual(String(novo.distribuicao.participacaoId), String(id), "novo cadastro, pendente");
  assert.equal((await NatalParticipacao.findById(id)).status, "rejeitado");
  assert.equal((await NatalParticipacao.findById(novo.distribuicao.participacaoId)).status, "pendente");
});

// ---------- 17 a 20: cancelamentos ----------

test("17. cancelar o segundo lote mantém os 25 do primeiro e devolve 10 ao saldo", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const { conta } = await liberar(distribuidor, admin, 12000);
  const inicial = await enviar(conta, { quantidade: 25 });
  const id = inicial.distribuicao.participacaoId;
  await aprovarParticipacao({ id, usuario: comercial, now: DENTRO });
  const segundo = await adicionar(id, distribuidor, { quantidade: 10 });
  await aprovarDistribuicao({ id: segundo.distribuicao._id, usuario: comercial, now: DENTRO });
  const cancelado = await cancelarDistribuicao({ id: segundo.distribuicao._id, usuario: comercial, motivo: "Venda desfeita pelo pet shop" });
  assert.equal(cancelado.devolvidos, 10);
  assert.equal(await NatalCupom.countDocuments({ distribuicaoId: segundo.distribuicao._id, status: "cancelado" }), 10);
  assert.equal(await NatalCupom.countDocuments({ distribuicaoId: inicial.distribuicao._id, status: "valido" }), 25);
  assert.equal((await NatalParticipacao.findById(id)).status, "aprovado");
  assert.deepEqual(await saldo(distribuidor), { total: 100, aprovados: 25, pendentes: 0, disponivel: 75 });
  await assert.rejects(cancelarDistribuicao({ id: segundo.distribuicao._id, usuario: comercial, motivo: "De novo" }), { code: "status_invalido" });
  await assert.rejects(cancelarDistribuicao({ id: inicial.distribuicao._id, usuario: distribuidor, motivo: "Distribuidor" }), { statusCode: 403 });
});

test("18. cancelar o cadastro cancela todos os cupons e devolve o saldo uma vez", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const { conta } = await liberar(distribuidor, admin, 12000);
  const inicial = await enviar(conta, { quantidade: 20 });
  const id = inicial.distribuicao.participacaoId;
  await aprovarParticipacao({ id, usuario: comercial, now: DENTRO });
  await adicionar(id, distribuidor, { quantidade: 5 });
  const cancelada = await cancelarParticipacao({ id, usuario: distribuidor, motivo: "Pet shop desistiu" });
  assert.equal(cancelada.status, "cancelado");
  assert.equal(cancelada.chaveCadastro, undefined);
  assert.equal(cancelada.cancelamento.autor.usuarioTipo, "cliente");
  assert.equal(await NatalCupom.countDocuments({ participacaoId: id, status: "cancelado" }), 25);
  assert.deepEqual(await saldo(distribuidor), { total: 100, aprovados: 0, pendentes: 0, disponivel: 100 });
  await assert.rejects(cancelarParticipacao({ id, usuario: comercial, motivo: "Repetido" }), { code: "status_invalido" });
  assert.equal((await saldo(distribuidor)).disponivel, 100);
});

test("19. cancelamento do pedido de origem segue a revisão: adequação invalida os cupons mais recentes um a um", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const { conta } = await liberar(distribuidor, admin, 12000);
  const { pedido: segundoPedido } = await liberar(distribuidor, admin, 12000);
  assert.equal((await saldo(distribuidor)).total, 200);
  const a = await enviar(conta, { quantidade: 150, now: new Date("2026-11-16T10:00:00Z") });
  const b = await enviar(conta, { quantidade: 30, now: new Date("2026-11-17T10:00:00Z") });
  await aprovarParticipacao({ id: a.distribuicao.participacaoId, usuario: comercial, now: DENTRO });
  await aprovarParticipacao({ id: b.distribuicao.participacaoId, usuario: comercial, now: DENTRO });
  // Origem calculada: os primeiros 100 vêm do primeiro pedido, os seguintes do segundo.
  const origens = await NatalCupom.find({ participacaoId: b.distribuicao.participacaoId }).select("origemSaldo").lean();
  assert.ok(origens.every((item) => item.origemSaldo?.numeroPedido === segundoPedido.numeroPedido));

  const res = response();
  await atualizarStatusPedido({ usuario: admin, params: { id: String(segundoPedido._id) }, body: { status: "cancelado" } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok((await NatalConta.findOne({ clienteId: distribuidor._id })).revisaoPendente);
  assert.equal(await NatalCupom.countDocuments({ status: "valido" }), 180, "nada invalidado sem decisão");

  await resolverRevisaoPendente({ clienteId: distribuidor._id, entrada: { decisao: "adequar", justificativa: "Pedido cancelado por falta de estoque" }, usuario: comercial });
  assert.equal(await NatalCupom.countDocuments({ participacaoId: a.distribuicao.participacaoId, status: "valido" }), 100);
  assert.equal(await NatalCupom.countDocuments({ participacaoId: a.distribuicao.participacaoId, status: "invalidado" }), 50);
  assert.equal(await NatalCupom.countDocuments({ participacaoId: b.distribuicao.participacaoId, status: "invalidado" }), 30);
  assert.equal((await NatalParticipacao.findById(a.distribuicao.participacaoId)).status, "aprovado", "cadastro segue com os cupons restantes");
  assert.equal((await NatalParticipacao.findById(b.distribuicao.participacaoId)).status, "invalidado_revisao");
  const atual = await saldo(distribuidor);
  assert.equal(atual.total, 100);
  assert.equal(atual.aprovados, 100);
  assert.equal(atual.disponivel, 0, "cupons invalidados não voltam ao saldo que deixou de existir");
});

test("20. cancelamentos simultâneos do mesmo lote devolvem o saldo uma única vez", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const { conta } = await liberar(distribuidor, admin, 12000);
  const inicial = await enviar(conta, { quantidade: 9 });
  await aprovarParticipacao({ id: inicial.distribuicao.participacaoId, usuario: comercial, now: DENTRO });
  const extra = await adicionar(inicial.distribuicao.participacaoId, distribuidor, { quantidade: 7 });
  const tentativas = await Promise.allSettled([
    cancelarDistribuicao({ id: extra.distribuicao._id, usuario: comercial, motivo: "Duplicado A" }),
    cancelarDistribuicao({ id: extra.distribuicao._id, usuario: admin, motivo: "Duplicado B" }),
    rejeitarDistribuicao({ id: extra.distribuicao._id, usuario: comercial, motivo: "Duplicado C" }),
  ]);
  assert.equal(tentativas.filter((item) => item.status === "fulfilled").length, 1);
  assert.deepEqual(await saldo(distribuidor), { total: 100, aprovados: 9, pendentes: 0, disponivel: 91 });
});

// ---------- 21 e 22: sorteio ----------

const cenarioSorteio = async () => {
  const ctx = await contexto();
  const { conta } = await liberar(ctx.distribuidor, ctx.admin, 12000);
  const ids = {};
  for (const [nome, quantidade] of [["A", 25], ["B", 10], ["C", 5]]) {
    const envio = await enviar(conta, { quantidade, dadosEnvio: dados({ nomeFantasia: `Pet Shop ${nome}` }) });
    ids[nome] = envio.distribuicao.participacaoId;
    await aprovarParticipacao({ id: ids[nome], usuario: ctx.comercial, now: DENTRO });
  }
  return { ...ctx, conta, ids };
};

test("21. sorteio: A=25, B=10, C=5 dão exatamente 40 chances, e cada um dos 40 números identifica seu participante", async () => {
  const { comercial, ids } = await cenarioSorteio();
  const linhas = await listarCuponsValidosParaSorteio();
  assert.equal(linhas.length, 40, "40 cupons, não 3 pet shops");
  assert.equal(new Set(linhas.map((linha) => linha.numero)).size, 40);
  const porCadastro = (id) => linhas.filter((linha) => linha.participacaoId === String(id)).length;
  assert.equal(porCadastro(ids.A), 25);
  assert.equal(porCadastro(ids.B), 10);
  assert.equal(porCadastro(ids.C), 5);
  const resumo = await resumirListaSorteio(linhas);
  assert.equal(resumo.cuponsElegiveis, 40);
  assert.equal(resumo.petshopsParticipantes, 3);
  // Prova determinística: todo número elegível pode ser o sorteado e aponta o dono correto.
  for (const linha of linhas) {
    const resultado = await gerarResultadoSorteio({ numero: linha.codigo, usuario: comercial });
    assert.equal(resultado.sorteado.codigo, linha.codigo);
    assert.equal(resultado.sorteado.petshop, linha.petshop);
    assert.equal(resultado.buffer.subarray(0, 5).toString(), "%PDF-");
  }
});

test("22. cupons pendentes, rejeitados, cancelados e invalidados ficam fora do sorteio", async () => {
  const { admin, comercial, distribuidor, conta, ids } = await cenarioSorteio();
  const pendente = await adicionar(ids.A, distribuidor, { quantidade: 4 });
  const rejeitado = await adicionar(ids.B, distribuidor, { quantidade: 3 });
  await rejeitarDistribuicao({ id: rejeitado.distribuicao._id, usuario: comercial, motivo: "Comprovante ilegível" });
  await cancelarDistribuicao({ id: (await NatalDistribuicao.findOne({ participacaoId: ids.C })).id, usuario: admin, motivo: "Cancelado a pedido" });
  const semAprovacao = await enviar(conta, { quantidade: 2 });
  const linhas = await listarCuponsValidosParaSorteio();
  assert.equal(linhas.length, 35, "25 de A + 10 de B");
  const fora = await NatalCupom.find({ status: { $ne: "valido" } }).select("codigo").lean();
  assert.equal(fora.length, 4 + 3 + 5 + 2);
  for (const cupom of fora.slice(0, 5)) {
    await assert.rejects(gerarResultadoSorteio({ numero: cupom.codigo, usuario: comercial }), { code: "cupom_nao_elegivel" });
  }
  assert.ok(pendente && semAprovacao);
  // Cadastro aprovado, mas cupom válido com lote não aprovado (inconsistência forçada) não entra.
  await NatalCupom.updateOne({ distribuicaoId: pendente.distribuicao._id }, { $set: { status: "valido" } });
  assert.equal((await listarCuponsValidosParaSorteio()).length, 35);
});

// ---------- 23 e 24: migração e compatibilidade ----------

const criarLegado = async ({ distribuidor, status, numero }) => {
  const _id = new mongoose.Types.ObjectId();
  const recebidoEm = new Date(DENTRO.getTime() - numero * 60000);
  await NatalParticipacao.collection.insertOne({
    _id,
    campanha: "natal-2026",
    clienteId: distribuidor._id,
    distribuidorNome: distribuidor.nomeFantasia,
    protocolo: `NP26-LEG${numero}`,
    vendedorNome: "Antigo",
    petshop: { nomeFantasia: `Legado ${numero}`, razaoSocial: "Legado LTDA", documento: gerarCnpj(), tipoDocumento: "cnpj", responsavel: "Ana", whatsapp: "11987654321", instagram: "legado" },
    compra: { data: "2026-11-05", valor: 100 },
    comprovante: { provider: "memoria", chave: `leg-${numero}`, mimetype: "image/png", bytes: 500, sha256: `leg${numero}` },
    status,
    recebidoEm,
    ...(status === "aprovado" ? { cupom: { numero, codigo: String(numero).padStart(5, "0"), emitidoEm: recebidoEm } } : {}),
    alertas: [],
    historico: [],
  });
  if (status === "aprovado") {
    await NatalCupom.collection.insertOne({
      campanha: "natal-2026", numero, codigo: String(numero).padStart(5, "0"), participacaoId: _id, clienteId: distribuidor._id,
      status: "valido", emitidoEm: recebidoEm, emitidoPor: { usuarioTipo: "comercial", usuarioNome: "Letícia" },
    });
  }
  return _id;
};

test("23 e 24. migração preserva números antigos, cria lotes históricos e cadastros antigos seguem funcionando", async () => {
  await NatalCampanhaEstado.updateOne({ _id: "natal-2026" }, { $set: { multiplosCupons: false } });
  const { admin, comercial, distribuidor } = await contexto();
  await liberar(distribuidor, admin, 12000);
  // Índice antigo de produção: 1 cupom por cadastro.
  await NatalCupom.collection.createIndex({ participacaoId: 1 }, { unique: true, name: "participacaoId_1" });
  const aprovados = [];
  for (const numero of [101, 202, 303, 404]) aprovados.push(await criarLegado({ distribuidor, status: "aprovado", numero }));
  const pendente = await criarLegado({ distribuidor, status: "pendente", numero: 505 });
  await NatalConta.updateOne({ clienteId: distribuidor._id }, { $set: { "contadores.aprovados": 4, "contadores.pendentes": 1 } });
  const numerosAntes = (await NatalCupom.find({}).sort({ numero: 1 }).lean()).map((item) => [item.numero, item.codigo, String(item.participacaoId)]);

  // Com os múltiplos cupons desligados, só 1 cupom por envio.
  const contaAntes = await NatalConta.findOne({ clienteId: distribuidor._id });
  await assert.rejects(enviar(contaAntes, { quantidade: 2 }), { code: "multiplos_indisponivel" });

  const migracao = await migrarMultiplosCupons({ operador: "Teste" });
  assert.equal(migracao.lotesHistoricosCriados, 5);
  assert.equal(migracao.dadosOriginaisInalterados, true);
  assert.equal(migracao.invariantesIguais, true);
  assert.equal(migracao.indiceRemovido, "participacaoId_1");
  const repeticao = await migrarMultiplosCupons({ operador: "Teste" });
  assert.equal(repeticao.lotesHistoricosCriados, 0);
  assert.equal(repeticao.chavesDefinidas, 0);
  await ativarMultiplosCupons({ operador: "Teste" });

  const numerosDepois = (await NatalCupom.find({}).sort({ numero: 1 }).lean()).map((item) => [item.numero, item.codigo, String(item.participacaoId)]);
  assert.deepEqual(numerosDepois, numerosAntes, "números, códigos e vínculos intactos");
  assert.equal(await NatalDistribuicao.countDocuments({ tipo: "legado" }), 5);
  assert.equal((await verificarInvariantes()).ok, true);

  // Cadastro antigo pendente: a aprovação emite o número dele, como antes.
  const aprovado = await aprovarParticipacao({ id: pendente, usuario: comercial, now: DENTRO });
  assert.equal(aprovado.cupons.validos, 1);
  assert.ok(aprovado.cupom?.numero);
  // Cadastro antigo aprovado recebe um novo lote.
  const adicao = await adicionar(aprovados[0], distribuidor, { quantidade: 4 });
  assert.equal(adicao.participacao.cupons.total, 5);
  await aprovarDistribuicao({ id: adicao.distribuicao._id, usuario: comercial, now: DENTRO });
  assert.equal(await NatalCupom.countDocuments({ participacaoId: aprovados[0], status: "valido" }), 5);
  assert.equal((await listarCuponsValidosParaSorteio()).length, 9);
  assert.equal((await verificarInvariantes()).ok, true);
});

test("23b. migração interrompe sem gravar quando as invariantes falham", async () => {
  const { admin, distribuidor } = await contexto();
  await liberar(distribuidor, admin, 12000);
  await criarLegado({ distribuidor, status: "aprovado", numero: 111 });
  // Contador divergente: a conta diz 0 aprovados, mas há 1 cupom válido.
  await assert.rejects(migrarMultiplosCupons({ operador: "Teste" }), { code: "invariantes" });
  assert.equal(await NatalDistribuicao.countDocuments(), 0);
});

// ---------- 25: relatórios ----------

test("25. PDFs e CSV: urna, auditoria interna e pública e lista numérica", async () => {
  const { comercial } = await cenarioSorteio();
  for (const tipo of ["pdf_urna", "pdf_auditoria", "pdf_auditoria_publica"]) {
    const arquivoGerado = await gerarExportacao({ tipo, usuario: comercial });
    assert.equal(arquivoGerado.buffer.subarray(0, 5).toString(), "%PDF-", tipo);
    assert.equal(arquivoGerado.totalCupons, 40);
  }
  const csv = (await gerarExportacao({ tipo: "csv_numerica", usuario: comercial })).buffer.toString("utf8");
  assert.equal(csv.trim().split("\r\n").length, 41);
  assert.match(csv.split("\r\n")[0], /lote_distribuicao/);
  const auditoria = await listarCuponsAuditoria();
  assert.equal(auditoria.length, 40);
  assert.ok(auditoria.every((linha) => linha.situacao === "Elegível" && linha.lote && linha.origem));
  assert.equal(mascararDocumento("11222333000181"), "11.***.***/0001-**");
  assert.equal(mascararDocumento("52998224725"), "***.982.247-**");
});

// ---------- 27 e 28: prazo ----------

test("27 e 28. depois do prazo ninguém emite cupons; a validação do que já foi enviado continua", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const { conta } = await liberar(distribuidor, admin, 12000);
  const inicial = await enviar(conta, { quantidade: 3 });
  await assert.rejects(enviar(conta, { quantidade: 1, now: DEPOIS_DO_PRAZO }), { code: "encerrada" });
  await assert.rejects(adicionar(inicial.distribuicao.participacaoId, distribuidor, { quantidade: 1, now: DEPOIS_DO_PRAZO }), { code: "encerrada" });
  const aprovada = await aprovarParticipacao({ id: inicial.distribuicao.participacaoId, usuario: comercial, now: DEPOIS_DO_PRAZO });
  assert.equal(aprovada.cupons.validos, 3);
});

// ---------- HTTP: formulário público e painel ----------

test("HTTP: envio público com quantidade, painel autenticado e isolamento entre distribuidores", async (t) => {
  const { admin, comercial, distribuidor, outroDistribuidor } = await contexto();
  const { conta } = await liberar(distribuidor, admin, 12000);
  const app = express();
  app.use(express.json());
  app.use("/api/public/natal-2026", natalPublicRoutes);
  app.use("/api/natal-2026", natalRoutes);
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = (usuario) => ({ Authorization: `Bearer ${jwt.sign({ id: usuario._id, tipo: usuario.tipo, tokenVersion: 0 }, process.env.JWT_SECRET, { algorithm: "HS256" })}` });

  const formulario = (campos, comprovante = arquivo()) => {
    const form = new FormData();
    for (const [nome, valor] of Object.entries(campos)) form.append(nome, String(valor));
    form.append("comprovante", new Blob([comprovante.buffer], { type: "image/png" }), "nota.png");
    return form;
  };
  // O controlador usa a data real: compra no início da campanha, nunca futura.
  const publico = { ...dados({ dataCompra: "2026-11-04" }), aceiteTermos: "true", iniciadoEm: String(Date.now() - 60000), website: "" };
  const id = chave();
  const envio = await fetch(`${base}/api/public/natal-2026/lotes/${conta.codigoPublico}/participacoes`, {
    method: "POST",
    body: formulario({ ...publico, quantidade: "7", chaveIdempotencia: id }),
  });
  const corpo = await envio.json();
  assert.equal(envio.status, 201, corpo.message);
  assert.equal(corpo.quantidade, 7);
  assert.equal(corpo.cupons.length, 7);
  assert.match(corpo.message, /Foram gerados 7 cupons/);
  assert.equal(corpo.saldo.disponiveis, 93);
  assert.equal(corpo.petshop, undefined, "nada do cadastro é devolvido");

  const repetido = await fetch(`${base}/api/public/natal-2026/lotes/${conta.codigoPublico}/participacoes`, {
    method: "POST",
    body: formulario({ ...publico, quantidade: "7", chaveIdempotencia: id }),
  });
  assert.equal(repetido.status, 200);
  assert.equal((await repetido.json()).protocolo, corpo.protocolo);

  const invalido = await fetch(`${base}/api/public/natal-2026/lotes/${conta.codigoPublico}/participacoes`, {
    method: "POST",
    body: formulario({ ...publico, documento: gerarCnpj(), quantidade: "2.5", chaveIdempotencia: chave() }),
  });
  assert.equal(invalido.status, 400);
  assert.ok((await invalido.json()).errors.quantidade);

  const participacaoId = (await NatalParticipacao.findOne({}))._id;
  const adicionarHttp = (usuario, campos) => fetch(`${base}/api/natal-2026/participacoes/${participacaoId}/distribuicoes`, {
    method: "POST",
    headers: usuario ? token(usuario) : {},
    body: formulario({ vendedorNome: "Rafa", dataCompra: "2026-11-05", valorCompra: "500,00", aceiteTermos: "true", quantidade: "3", chaveIdempotencia: chave(), ...campos }),
  });
  assert.equal((await adicionarHttp(null, {})).status, 401);
  assert.equal((await adicionarHttp(comercial, {})).status, 403);
  assert.equal((await adicionarHttp(outroDistribuidor, {})).status, 404);
  const proprio = await adicionarHttp(distribuidor, {});
  const corpoProprio = await proprio.json();
  assert.equal(proprio.status, 201, corpoProprio.message);
  assert.match(corpoProprio.message, /3 novos cupons adicionados com sucesso\. Este pet shop agora possui 10 cupons/);

  const detalhe = await fetch(`${base}/api/natal-2026/participacoes/${participacaoId}`, { headers: token(distribuidor) });
  const corpoDetalhe = await detalhe.json();
  assert.equal(corpoDetalhe.lotes.length, 2);
  assert.equal(corpoDetalhe.cupons.total, 10);
  assert.equal(corpoDetalhe.lotes[0].cupons.length, 7);
  assert.equal(corpoDetalhe.alertas, undefined, "alertas só para a gestão");
  assert.equal((await fetch(`${base}/api/natal-2026/participacoes/${participacaoId}`, { headers: token(outroDistribuidor) })).status, 403);

  const loteId = corpoDetalhe.lotes[1]._id;
  assert.equal((await fetch(`${base}/api/natal-2026/distribuicoes/${loteId}/aprovar`, { method: "POST", headers: token(distribuidor) })).status, 403);
  assert.equal((await fetch(`${base}/api/natal-2026/distribuicoes/${loteId}/comprovante`, { headers: token(outroDistribuidor) })).status, 403);
  assert.equal((await fetch(`${base}/api/natal-2026/distribuicoes/${loteId}/comprovante`, { headers: token(distribuidor) })).status, 200);
  const lista = await listarParticipacoes({ comLotePendente: "true" }, { gestor: true });
  assert.equal(lista.total, 1);
});
