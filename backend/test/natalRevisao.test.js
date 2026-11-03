import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import Pedido from "../src/models/Pedido.js";
import Produto from "../src/models/Produto.js";
import PrecoProduto from "../src/models/PrecoProduto.js";
import Usuario from "../src/models/Usuario.js";
import NatalAuditoria from "../src/models/NatalAuditoria.js";
import NatalCupom from "../src/models/NatalCupom.js";
import NatalLote from "../src/models/NatalLote.js";
import NatalParticipacao from "../src/models/NatalParticipacao.js";
import natalRoutes from "../src/routes/natalRoutes.js";
import { aprovarPedidoAdmin, atualizarPedidoAdmin, atualizarStatusPedido } from "../src/controllers/pedidoController.js";
import { resetIndicesNatalParaTestes } from "../src/services/natalBaseService.js";
import { criarStorageMemoria, setComprovanteStorage, validarArquivoComprovante } from "../src/services/natalComprovanteService.js";
import { resetReconciliacaoParaTestes } from "../src/services/natalLoteService.js";
import {
  aprovarParticipacao,
  cancelarParticipacao,
  obterLotePublico,
  registrarParticipacaoPublica,
} from "../src/services/natalParticipacaoService.js";
import { listarParticipacoes } from "../src/services/natalGestaoService.js";
import { listarCuponsValidosParaSorteio } from "../src/services/natalExportacaoService.js";
import { validarParticipacaoPublica } from "../src/utils/natalCampanha.js";

process.env.JWT_SECRET ||= "segredo-de-teste-com-mais-de-32-caracteres!!";

let replSet;
const storage = criarStorageMemoria();
const DENTRO = new Date("2026-11-20T15:00:00.000Z");
const CRIADO_EM = new Date("2026-11-10T13:00:00.000Z");

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: "natal-revisao" });
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
  resetReconciliacaoParaTestes();
});

let seq = 0;
const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const contexto = async () => {
  seq += 1;
  const tabelaPrecoId = new mongoose.Types.ObjectId();
  const produto = await Produto.create({ nome: `Shampoo ${seq}`, linha: "Banho", categoria: "Shampoo" });
  await PrecoProduto.create({ produtoId: produto._id, tabelaPrecoId, valor: 1000 });
  const mk = (tipo, extra = {}) => Usuario.create({
    nomeResponsavel: `${tipo} ${seq}`, email: `${tipo}${seq}@rev.local`, senha: "x", tipo, statusCadastro: "aprovado", ...extra,
  });
  const [admin, comercial, vendedor, distribuidor] = await Promise.all([
    mk("admin"), mk("comercial"), mk("vendedor"),
    mk("cliente", { nomeFantasia: `Distribuidora ${seq}`, razaoSocial: `Distribuidora ${seq} LTDA`, tabelaPrecoId }),
  ]);
  return { admin, comercial, vendedor, distribuidor, produto, tabelaPrecoId };
};

// Pedido aprovado de R$ "valor" (unidades de R$ 1.000) com lote criado na aprovação.
const pedidoAprovado = async (ctx, valor) => {
  seq += 1;
  const quantidade = valor / 1000;
  const pedido = await Pedido.create({
    numeroPedido: `REV-${seq}`,
    clienteId: ctx.distribuidor._id,
    nomeFantasiaCliente: ctx.distribuidor.nomeFantasia,
    tabelaPrecoId: ctx.tabelaPrecoId,
    dia: 10, mes: 11, ano: 2026,
    itens: [{ produtoId: ctx.produto._id, nomeProduto: ctx.produto.nome, quantidade, valorUnitario: 1000, subtotal: valor }],
    valorTotal: valor,
    status: "aguardando_aprovacao",
    createdAt: CRIADO_EM,
  });
  const res = response();
  await aprovarPedidoAdmin({ usuario: ctx.admin, params: { id: String(pedido._id) } }, res);
  assert.equal(res.statusCode, 200);
  return { pedido: await Pedido.findById(pedido._id), lote: await NatalLote.findOne({ pedidoId: pedido._id }) };
};

const editar = async (ctx, pedidoId, valor, { usuario = ctx.comercial, revisao } = {}) => {
  const atual = await Pedido.findById(pedidoId);
  const res = response();
  await atualizarPedidoAdmin({
    usuario,
    params: { id: String(pedidoId) },
    body: {
      versaoPedido: atual.__v,
      itens: [{ produtoId: String(ctx.produto._id), quantidade: valor / 1000 }],
      ...(revisao ? { revisaoBeneficios: revisao } : {}),
    },
  }, res);
  return res;
};

const JUSTIFICATIVA = "Distribuidor reduziu o pedido por falta de verba";

// Fixture direta: N participações já aprovadas, recebidas em sequência a partir de "base".
let numeroCupom = 1000;
const semearAprovadas = async (lote, quantidade, { base = new Date("2026-11-12T10:00:00Z"), passoMs = 1000, aprovacaoInversa = false } = {}) => {
  const docs = [];
  const cupons = [];
  for (let i = 0; i < quantidade; i += 1) {
    const _id = new mongoose.Types.ObjectId();
    numeroCupom += 1;
    const recebidoEm = new Date(base.getTime() + i * passoMs);
    // Aprovação em ordem inversa ao recebimento: a antiguidade usa o recebimento.
    const aprovadoEm = new Date(DENTRO.getTime() + (aprovacaoInversa ? quantidade - i : i) * 1000);
    docs.push({
      _id, loteId: lote._id, pedidoId: lote.pedidoId, clienteId: lote.clienteId, numeroPedido: lote.numeroPedido,
      distribuidorNome: lote.distribuidorNome, protocolo: `NP26-T${String(numeroCupom).padStart(7, "0")}`,
      vendedorNome: "Vendedor", petshop: { nomeFantasia: `Pet ${i}`, razaoSocial: `Pet ${i} LTDA`, documento: "11222333000181", tipoDocumento: "cnpj", responsavel: "Ana", whatsapp: "11987654321", instagram: "pet" },
      compra: { data: "2026-11-12", valor: 100 },
      comprovante: { provider: "memoria", chave: `c${i}`, mimetype: "image/png", bytes: 500, sha256: `h${numeroCupom}` },
      status: "aprovado", recebidoEm,
      cupom: { numero: numeroCupom, codigo: String(numeroCupom).padStart(5, "0"), emitidoEm: aprovadoEm },
      decisao: { em: aprovadoEm, autor: { usuarioTipo: "comercial", usuarioNome: "Letícia" } },
      historico: [{ acao: "recebido", em: recebidoEm, autor: { usuarioTipo: "publico" } }],
    });
    cupons.push({
      numero: numeroCupom, codigo: String(numeroCupom).padStart(5, "0"), participacaoId: _id, loteId: lote._id,
      pedidoId: lote.pedidoId, clienteId: lote.clienteId, status: "valido", emitidoEm: aprovadoEm, emitidoPor: { usuarioTipo: "comercial" },
    });
  }
  await NatalParticipacao.insertMany(docs);
  await NatalCupom.insertMany(cupons);
  await NatalLote.updateOne({ _id: lote._id }, { $inc: { "contadores.aprovados": quantidade } });
  return docs;
};

const semearPendentes = async (lote, quantidade) => {
  const docs = (await semearAprovadas(lote, quantidade, { base: new Date("2026-11-19T10:00:00Z") })).map((doc) => doc._id);
  await NatalParticipacao.updateMany({ _id: { $in: docs } }, { $set: { status: "pendente" }, $unset: { cupom: 1, decisao: 1 } });
  await NatalCupom.deleteMany({ participacaoId: { $in: docs } });
  await NatalLote.updateOne({ _id: lote._id }, { $inc: { "contadores.aprovados": -quantidade, "contadores.pendentes": quantidade } });
  return docs;
};

// 11–14 e 18: toda redução de pedido participante exige decisão explícita.
for (const [de, para, depois] of [[12000, 10000, 0], [20000, 18000, 100], [40000, 35000, 300], [40000, 30000, 300]]) {
  test(`redução de R$ ${de} para R$ ${para} exige decisão e nada é salvo sem ela`, async () => {
    const ctx = await contexto();
    const { pedido, lote } = await pedidoAprovado(ctx, de);
    const res = await editar(ctx, pedido._id, para);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.codigo, "revisao_beneficios_obrigatoria");
    assert.equal(res.body.revisao.valorAnterior, de);
    assert.equal(res.body.revisao.valorNovo, para);
    assert.equal(res.body.revisao.beneficiosAtuais.cupons, lote.cuponsConcedidos);
    assert.equal(res.body.revisao.beneficiosDoNovoValor.cupons, depois);
    assert.equal((await Pedido.findById(pedido._id)).valorTotal, de, "pedido não é salvo parcialmente");
    assert.equal((await NatalLote.findById(lote._id)).cuponsConcedidos, lote.cuponsConcedidos);
  });
}

test("18. backend rejeita decisão inválida, justificativa ausente e perfil sem permissão", async () => {
  const ctx = await contexto();
  const { pedido } = await pedidoAprovado(ctx, 20000);
  assert.equal((await editar(ctx, pedido._id, 18000, { revisao: { decisao: "talvez", justificativa: JUSTIFICATIVA } })).statusCode, 400);
  assert.equal((await editar(ctx, pedido._id, 18000, { revisao: { decisao: "manter", justificativa: "" } })).statusCode, 400);
  // Vendedor (carteira) não decide benefícios; aqui a edição já é barrada pelo status operacional.
  const vendedor = await editar(ctx, pedido._id, 18000, { usuario: ctx.vendedor, revisao: { decisao: "manter", justificativa: JUSTIFICATIVA } });
  assert.ok([403, 409].includes(vendedor.statusCode));
  assert.equal((await Pedido.findById(pedido._id)).valorTotal, 20000);
});

test("15. manter preserva faixa, cupons e bonificações e registra a decisão", async () => {
  const ctx = await contexto();
  const { pedido, lote } = await pedidoAprovado(ctx, 40000);
  const res = await editar(ctx, pedido._id, 35000, { revisao: { decisao: "manter", justificativa: JUSTIFICATIVA } });
  assert.equal(res.statusCode, 200, res.body?.message);
  const atual = await NatalLote.findById(lote._id);
  assert.equal(atual.cuponsConcedidos, 400);
  assert.equal(atual.faixaMaxima.produtosPercentual, 10);
  assert.equal(atual.valorAtual, 35000);
  assert.equal((await Pedido.findById(pedido._id)).valorTotal, 35000);
  assert.equal(atual.revisoes.length, 1);
  assert.equal(atual.revisoes[0].decisao, "manter");
  assert.equal(atual.revisoes[0].justificativa, JUSTIFICATIVA);
  assert.equal(atual.revisoes[0].autor.usuarioTipo, "comercial");
  assert.ok(await NatalAuditoria.findOne({ acao: "beneficios_revisados", loteId: lote._id }));
});

test("16 e 4.7. adequar recalcula cupons e todas as bonificações (R$ 40 mil → R$ 20 mil)", async () => {
  const ctx = await contexto();
  const { pedido, lote } = await pedidoAprovado(ctx, 40000);
  const res = await editar(ctx, pedido._id, 20000, { revisao: { decisao: "adequar", justificativa: JUSTIFICATIVA, cuponsEsperados: 400 } });
  assert.equal(res.statusCode, 200, res.body?.message);
  assert.equal(res.body.revisaoBeneficios.cupons, 200);
  const atual = await NatalLote.findById(lote._id);
  assert.equal(atual.cuponsConcedidos, 200);
  assert.equal(atual.faixaMaxima.marketingPercentual, 3);
  assert.equal(atual.faixaMaxima.produtosPercentual, 7);
  assert.equal(atual.codigoPublico, lote.codigoPublico, "mesmo link");
  const revisao = atual.revisoes[0];
  assert.equal(revisao.faixaAnterior.cupons, 400);
  assert.equal(revisao.faixaResultante.cupons, 200);
  assert.equal(revisao.faixaAnterior.produtosPercentual, 10);
});

test("17. cancelar o modal (nenhuma decisão enviada) não salva itens nem benefícios", async () => {
  const ctx = await contexto();
  const { pedido, lote } = await pedidoAprovado(ctx, 30000);
  const antes = await Pedido.findById(pedido._id).select("+historicoAlteracoes");
  const res = await editar(ctx, pedido._id, 25000);
  assert.equal(res.statusCode, 409);
  const depois = await Pedido.findById(pedido._id).select("+historicoAlteracoes");
  assert.equal(depois.__v, antes.__v);
  assert.equal(depois.itens[0].quantidade, 30);
  assert.equal(depois.historicoAlteracoes, undefined);
  assert.equal((await NatalLote.findById(lote._id)).revisoes.length, 0);
});

test("19 e 20. aumento continua automático e repetido não duplica cupons nem benefícios", async () => {
  const ctx = await contexto();
  const { pedido, lote } = await pedidoAprovado(ctx, 12000);
  assert.equal((await editar(ctx, pedido._id, 20000)).statusCode, 200);
  assert.equal((await editar(ctx, pedido._id, 20000)).statusCode, 200);
  assert.equal((await editar(ctx, pedido._id, 21000)).statusCode, 200);
  const atual = await NatalLote.findById(lote._id);
  assert.equal(atual.cuponsConcedidos, 200);
  assert.equal(atual.faixaMaxima.produtosPercentual, 7);
  assert.equal(atual.historicoFaixas.filter((evento) => evento.tipo === "aumento_faixa").length, 1);
  assert.equal(atual.revisoes.length, 0);
  assert.equal(await NatalLote.countDocuments({ pedidoId: pedido._id }), 1);
});

test("21. 400 → 300 com 250 aprovados não invalida ninguém e mantém pendentes", async () => {
  const ctx = await contexto();
  const { pedido, lote } = await pedidoAprovado(ctx, 40000);
  await semearAprovadas(lote, 250);
  await semearPendentes(lote, 30);
  const res = await editar(ctx, pedido._id, 30000, { revisao: { decisao: "adequar", justificativa: JUSTIFICATIVA } });
  assert.equal(res.statusCode, 200, res.body?.message);
  const atual = await NatalLote.findById(lote._id);
  assert.equal(atual.cuponsConcedidos, 300);
  assert.equal(atual.contadores.aprovados, 250);
  assert.equal(atual.contadores.pendentes, 30);
  assert.equal(atual.cuponsConcedidos - atual.contadores.aprovados, 50);
  assert.equal(await NatalParticipacao.countDocuments({ loteId: lote._id, status: "invalidado_revisao" }), 0);
});

test("22 a 29. 400 → 300 com 350 aprovados invalida exatamente as 50 mais recentes por recebimento", async () => {
  const ctx = await contexto();
  const { pedido, lote } = await pedidoAprovado(ctx, 40000);
  const aprovadas = await semearAprovadas(lote, 350, { aprovacaoInversa: true });
  // Empate: o último recebido divide o horário com o 300º; o desempate é pelo identificador.
  const empateId = aprovadas[299]._id < aprovadas[300]._id ? aprovadas[300]._id : aprovadas[299]._id;
  await NatalParticipacao.updateOne({ _id: aprovadas[300]._id }, { $set: { recebidoEm: aprovadas[299].recebidoEm } });
  const pendentes = await semearPendentes(lote, 20);

  const previa = await editar(ctx, pedido._id, 30000);
  assert.equal(previa.body.revisao.impactoAdequar.invalidadas, 50);
  assert.equal(previa.body.revisao.impactoManter.invalidadas, 0);

  const res = await editar(ctx, pedido._id, 30000, { revisao: { decisao: "adequar", justificativa: JUSTIFICATIVA } });
  assert.equal(res.statusCode, 200, res.body?.message);
  assert.equal(res.body.revisaoBeneficios.participacoesInvalidadas, 50);

  const invalidadas = await NatalParticipacao.find({ loteId: lote._id, status: "invalidado_revisao" }).sort({ recebidoEm: 1, _id: 1 });
  assert.equal(invalidadas.length, 50);
  const esperadas = new Set(aprovadas.slice(300).map((doc) => String(doc._id)));
  if (String(empateId) === String(aprovadas[299]._id)) {
    esperadas.delete(String(aprovadas[300]._id));
    esperadas.add(String(aprovadas[299]._id));
  }
  assert.deepEqual(new Set(invalidadas.map((doc) => String(doc._id))), esperadas, "as 50 mais recentes por recebimento (desempate por _id)");
  assert.ok(invalidadas.every((doc) => doc.invalidacao.tipo === "revisao_faixa" && doc.petshop.nomeFantasia && doc.comprovante.chave));
  assert.equal(await NatalParticipacao.countDocuments({ loteId: lote._id, status: "aprovado" }), 300);

  const atual = await NatalLote.findById(lote._id);
  assert.equal(atual.contadores.aprovados, 300);
  assert.equal(atual.contadores.invalidadosRevisao, 50);
  assert.equal(atual.cuponsConcedidos - atual.contadores.aprovados, 0);
  // 26: pendentes continuam registrados, sem saldo para aprovação.
  assert.equal(await NatalParticipacao.countDocuments({ _id: { $in: pendentes }, status: "pendente" }), 20);
  await assert.rejects(aprovarParticipacao({ id: pendentes[0], usuario: ctx.comercial, now: DENTRO }), { code: "sem_saldo" });

  // 27 e 28: números invalidados fora do sorteio e nunca reutilizados.
  const numerosInvalidados = invalidadas.map((doc) => doc.cupom.numero);
  const sorteio = await listarCuponsValidosParaSorteio();
  assert.equal(sorteio.length, 300);
  assert.ok(sorteio.every((linha) => !numerosInvalidados.includes(linha.numero)));
  assert.equal(await NatalCupom.countDocuments({ numero: { $in: numerosInvalidados }, status: "invalidado" }), 50);

  // 29: histórico e auditoria completos.
  const revisao = atual.revisoes[0];
  assert.equal(revisao.participacoesInvalidadas.length, 50);
  assert.equal(revisao.aprovadasAntes, 350);
  assert.equal(revisao.pendentesNoMomento, 20);
  assert.equal(await NatalAuditoria.countDocuments({ acao: "participacao_invalidada_revisao", loteId: lote._id }), 50);
  const auditoria = await NatalAuditoria.findOne({ acao: "beneficios_revisados", loteId: lote._id });
  assert.equal(auditoria.detalhes.cuponsInvalidados.length, 50);
  assert.equal(auditoria.detalhes.decisao, "adequar");

  // Repetir a mesma redução não invalida de novo (já está em R$ 30 mil).
  assert.equal((await editar(ctx, pedido._id, 30000)).statusCode, 200);
  assert.equal(await NatalParticipacao.countDocuments({ loteId: lote._id, status: "invalidado_revisao" }), 50);
});

test("30 e 31. abaixo de R$ 12 mil zera benefícios e o aumento posterior reativa sem restaurar invalidados", async () => {
  const ctx = await contexto();
  const { pedido, lote } = await pedidoAprovado(ctx, 12000);
  await semearAprovadas(lote, 40);
  await semearPendentes(lote, 5);
  const res = await editar(ctx, pedido._id, 10000, { revisao: { decisao: "adequar", justificativa: JUSTIFICATIVA } });
  assert.equal(res.statusCode, 200, res.body?.message);
  let atual = await NatalLote.findById(lote._id);
  assert.equal(atual.status, "ativo");
  assert.equal(atual.cuponsConcedidos, 0);
  assert.equal(atual.faixaMaxima.marketingPercentual, 0);
  assert.equal(atual.faixaMaxima.produtosPercentual, 0);
  assert.equal(await NatalParticipacao.countDocuments({ loteId: lote._id, status: "invalidado_revisao" }), 40);
  assert.equal(await NatalParticipacao.countDocuments({ loteId: lote._id, status: "pendente" }), 5);
  assert.equal((await Pedido.findById(pedido._id)).status, "aprovado", "pedido continua existindo");
  const publico = await obterLotePublico(lote.codigoPublico, { now: DENTRO });
  assert.equal(publico.aceitandoCadastros, false);
  assert.equal(publico.motivo, "sem_beneficios");

  assert.equal((await editar(ctx, pedido._id, 20000)).statusCode, 200);
  atual = await NatalLote.findById(lote._id);
  assert.equal(atual.cuponsConcedidos, 200);
  assert.equal(atual.faixaMaxima.produtosPercentual, 7);
  assert.equal(await NatalParticipacao.countDocuments({ loteId: lote._id, status: "invalidado_revisao" }), 40, "sem reativação silenciosa");
  assert.equal(atual.contadores.aprovados, 0);
  assert.equal((await obterLotePublico(lote.codigoPublico, { now: DENTRO })).aceitandoCadastros, true);
});

test("4.6. R$ 40 mil → 30 mil (adequar) → 40 mil volta a 400 sem duplicar nem restaurar", async () => {
  const ctx = await contexto();
  const { pedido, lote } = await pedidoAprovado(ctx, 40000);
  await semearAprovadas(lote, 320);
  await editar(ctx, pedido._id, 30000, { revisao: { decisao: "adequar", justificativa: JUSTIFICATIVA } });
  assert.equal((await editar(ctx, pedido._id, 40000)).statusCode, 200);
  const atual = await NatalLote.findById(lote._id);
  assert.equal(atual.cuponsConcedidos, 400);
  assert.equal(atual.contadores.aprovados, 300);
  assert.equal(atual.cuponsConcedidos - atual.contadores.aprovados, 100);
  assert.equal(await NatalParticipacao.countDocuments({ loteId: lote._id, status: "invalidado_revisao" }), 20);
  assert.equal(await NatalLote.countDocuments(), 1);
});

test("32. revisões e aprovações simultâneas não produzem inconsistências", async () => {
  const ctx = await contexto();
  const { pedido, lote } = await pedidoAprovado(ctx, 40000);
  await semearAprovadas(lote, 290);
  const pendentes = await semearPendentes(lote, 15);
  const atual = await Pedido.findById(pedido._id);
  const req = (valor) => {
    const res = response();
    return atualizarPedidoAdmin({
      usuario: ctx.comercial,
      params: { id: String(pedido._id) },
      body: { versaoPedido: atual.__v, itens: [{ produtoId: String(ctx.produto._id), quantidade: valor / 1000 }], revisaoBeneficios: { decisao: "adequar", justificativa: JUSTIFICATIVA } },
    }, res).then(() => res);
  };
  const resultados = await Promise.all([
    req(30000), req(20000),
    ...pendentes.map((id) => aprovarParticipacao({ id, usuario: ctx.comercial, now: DENTRO }).then(() => "ok", (error) => error.code)),
  ]);
  const revisoes = resultados.slice(0, 2);
  assert.equal(revisoes.filter((res) => res.statusCode === 200).length, 1, "só uma revisão vence");
  assert.ok(revisoes.every((res) => [200, 409].includes(res.statusCode)));

  const final = await NatalLote.findById(lote._id);
  const aprovadas = await NatalParticipacao.countDocuments({ loteId: lote._id, status: "aprovado" });
  const invalidadas = await NatalParticipacao.countDocuments({ loteId: lote._id, status: "invalidado_revisao" });
  const pendentesFinais = await NatalParticipacao.countDocuments({ loteId: lote._id, status: "pendente" });
  assert.equal(final.contadores.aprovados, aprovadas, "contador igual aos registros");
  assert.equal(final.contadores.invalidadosRevisao, invalidadas);
  assert.equal(final.contadores.pendentes, pendentesFinais);
  assert.ok(aprovadas <= final.cuponsConcedidos, "nunca acima do limite");
  assert.equal(await NatalCupom.countDocuments({ loteId: lote._id, status: "valido" }), aprovadas);
  assert.equal(final.revisoes.length, 1);
  assert.equal((await Pedido.findById(pedido._id)).valorTotal, final.valorAtual, "pedido e lote coerentes");
});

test("33. falha durante a revisão não deixa alterações parciais", async (t) => {
  const ctx = await contexto();
  const { pedido, lote } = await pedidoAprovado(ctx, 40000);
  await semearAprovadas(lote, 350);
  t.mock.method(NatalAuditoria, "insertMany", async () => { throw new Error("falha simulada"); });
  const res = response();
  const atual = await Pedido.findById(pedido._id);
  await assert.rejects(atualizarPedidoAdmin({
    usuario: ctx.comercial,
    params: { id: String(pedido._id) },
    body: { versaoPedido: atual.__v, itens: [{ produtoId: String(ctx.produto._id), quantidade: 30 }], revisaoBeneficios: { decisao: "adequar", justificativa: JUSTIFICATIVA } },
  }, res).then(() => { if (res.statusCode >= 500) throw new Error("500"); if (res.statusCode !== 200) throw new Error(String(res.statusCode)); }));
  t.mock.restoreAll();
  assert.equal((await Pedido.findById(pedido._id)).valorTotal, 40000);
  const intacto = await NatalLote.findById(lote._id);
  assert.equal(intacto.cuponsConcedidos, 400);
  assert.equal(intacto.contadores.aprovados, 350);
  assert.equal(intacto.revisoes.length, 0);
  assert.equal(await NatalParticipacao.countDocuments({ loteId: lote._id, status: "aprovado" }), 350);
  assert.equal(await NatalCupom.countDocuments({ loteId: lote._id, status: "valido" }), 350);
});

test("37. pedidos não participantes (sem lote) reduzem valor sem revisão", async () => {
  const ctx = await contexto();
  seq += 1;
  const pedido = await Pedido.create({
    numeroPedido: `REV-FORA-${seq}`, clienteId: ctx.distribuidor._id, tabelaPrecoId: ctx.tabelaPrecoId, dia: 1, mes: 10, ano: 2026,
    itens: [{ produtoId: ctx.produto._id, nomeProduto: ctx.produto.nome, quantidade: 20, valorUnitario: 1000, subtotal: 20000 }],
    valorTotal: 20000, status: "aprovado", createdAt: new Date("2026-10-01T12:00:00Z"),
  });
  const res = await editar(ctx, pedido._id, 15000);
  assert.equal(res.statusCode, 200, res.body?.message);
  assert.equal(await NatalLote.countDocuments(), 0);
});

test("34, 35 e 38. cancelamento pelo distribuidor, aprovação e cancelamento do pedido seguem íntegros", async () => {
  const ctx = await contexto();
  const { pedido, lote } = await pedidoAprovado(ctx, 12000);
  const buffer = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 9)]);
  const meta = validarArquivoComprovante({ buffer, mimetype: "image/png", originalname: "n.png" });
  const dados = { vendedorNome: "Rafa", nomeFantasia: "Pet CPF", razaoSocial: "Maria da Silva", documento: "529.982.247-25", tipoDocumento: undefined, responsavel: "Maria", whatsapp: "11987654321", instagram: "petcpf", dataCompra: "2026-11-15", valorCompra: 300 };
  const valid = validarParticipacaoPublica({ ...dados, aceiteTermos: true }, { now: DENTRO });
  assert.equal(valid.valid, true);
  const p = await registrarParticipacaoPublica({ codigo: lote.codigoPublico, dados: valid.data, arquivo: { buffer, meta }, now: DENTRO });
  await aprovarParticipacao({ id: p._id, usuario: ctx.comercial, now: DENTRO });
  await cancelarParticipacao({ id: p._id, usuario: ctx.distribuidor, motivo: "Venda desfeita" });
  assert.equal((await NatalLote.findById(lote._id)).contadores.aprovados, 0);
  const res = response();
  await atualizarStatusPedido({ usuario: ctx.admin, params: { id: String(pedido._id) }, body: { status: "cancelado" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal((await NatalLote.findById(lote._id)).status, "invalidado");
});

test("CPF e CNPJ: aceitos, validados, normalizados e pesquisáveis", async () => {
  const ctx = await contexto();
  const { lote } = await pedidoAprovado(ctx, 12000);
  const base = { vendedorNome: "Rafa", nomeFantasia: "Pet", razaoSocial: "Pet LTDA", responsavel: "Ana", whatsapp: "11987654321", instagram: "pet", dataCompra: "2026-11-15", valorCompra: "300,00", aceiteTermos: "true" };
  const cpf = validarParticipacaoPublica({ ...base, documento: "529.982.247-25" }, { now: DENTRO });
  assert.equal(cpf.valid, true);
  assert.equal(cpf.data.documento, "52998224725");
  assert.equal(cpf.data.tipoDocumento, "cpf");
  const cnpj = validarParticipacaoPublica({ ...base, documento: "11.222.333/0001-81" }, { now: DENTRO });
  assert.equal(cnpj.data.tipoDocumento, "cnpj");
  assert.match(validarParticipacaoPublica({ ...base, documento: "529.982.247-24" }, { now: DENTRO }).errors.documento, /CPF/);
  assert.match(validarParticipacaoPublica({ ...base, documento: "11.222.333/0001-80" }, { now: DENTRO }).errors.documento, /CNPJ/);
  assert.ok(validarParticipacaoPublica({ ...base, documento: "123" }, { now: DENTRO }).errors.documento);

  const buffer = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 4)]);
  for (const entrada of [cpf.data, cnpj.data]) {
    const meta = validarArquivoComprovante({ buffer, mimetype: "image/png", originalname: "n.png" });
    await registrarParticipacaoPublica({ codigo: lote.codigoPublico, dados: entrada, arquivo: { buffer, meta: { ...meta, sha256: `${meta.sha256}${entrada.documento}` } }, now: DENTRO });
  }
  assert.equal((await listarParticipacoes({ documento: "529.982.247-25" }, { gestor: true })).total, 1);
  assert.equal((await listarParticipacoes({ documento: "11222333000181" }, { gestor: true })).total, 1);
  assert.equal((await listarParticipacoes({ cnpj: "5299" }, { gestor: true })).total, 1, "busca parcial e parâmetro legado");
  const salvo = await NatalParticipacao.findOne({ "petshop.documento": "52998224725" });
  assert.equal(salvo.petshop.tipoDocumento, "cpf");
  // Duplicidade considera o documento em ambos os formatos.
  const meta = validarArquivoComprovante({ buffer, mimetype: "image/png", originalname: "n.png" });
  const repetido = await registrarParticipacaoPublica({ codigo: lote.codigoPublico, dados: cpf.data, arquivo: { buffer, meta: { ...meta, sha256: "outro" } }, now: DENTRO });
  assert.equal(repetido.alertas[0].tipo, "mesma_compra");
});

test("8 a 10. comprovante: Comercial vê, distribuidor de outro lote não, sem login não", async (t) => {
  const ctx = await contexto();
  const outro = await Usuario.create({ nomeResponsavel: "Outro", email: `outro${seq}@rev.local`, senha: "x", tipo: "cliente", statusCadastro: "aprovado" });
  const { lote } = await pedidoAprovado(ctx, 12000);
  const pdf = Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >>\n${"x".repeat(300)}`);
  const meta = validarArquivoComprovante({ buffer: pdf, mimetype: "application/pdf", originalname: "nota.pdf" });
  const dados = validarParticipacaoPublica({ vendedorNome: "Rafa", nomeFantasia: "Pet", razaoSocial: "Pet LTDA", documento: "11222333000181", responsavel: "Ana", whatsapp: "11987654321", instagram: "pet", dataCompra: "2026-11-15", valorCompra: 10, aceiteTermos: true }, { now: DENTRO }).data;
  const p = await registrarParticipacaoPublica({ codigo: lote.codigoPublico, dados, arquivo: { buffer: pdf, meta }, now: DENTRO });

  const app = express();
  app.use("/api/natal-2026", natalRoutes);
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/natal-2026/participacoes/${p._id}/comprovante`;
  const token = (u) => ({ Authorization: `Bearer ${jwt.sign({ id: u._id, tipo: u.tipo, tokenVersion: 0 }, process.env.JWT_SECRET, { algorithm: "HS256" })}` });

  const comercial = await fetch(base, { headers: token(ctx.comercial) });
  assert.equal(comercial.status, 200);
  assert.equal(comercial.headers.get("content-type"), "application/pdf");
  assert.equal(Buffer.from(await comercial.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  assert.equal((await fetch(base, { headers: token(ctx.admin) })).status, 200);
  assert.equal((await fetch(base, { headers: token(ctx.distribuidor) })).status, 200);
  assert.equal((await fetch(base, { headers: token(outro) })).status, 403);
  assert.equal((await fetch(base)).status, 401);
});
