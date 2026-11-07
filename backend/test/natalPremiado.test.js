import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { buildNatalConfig, NATAL_2026 } from "../src/config/natalPremiado2026.js";
import Pedido from "../src/models/Pedido.js";
import Produto from "../src/models/Produto.js";
import PrecoProduto from "../src/models/PrecoProduto.js";
import Usuario from "../src/models/Usuario.js";
import NatalAuditoria from "../src/models/NatalAuditoria.js";
import NatalBonificacao from "../src/models/NatalBonificacao.js";
import NatalConta from "../src/models/NatalConta.js";
import NatalCupom from "../src/models/NatalCupom.js";
import NatalLote from "../src/models/NatalLote.js";
import NatalMovimentoCupom from "../src/models/NatalMovimentoCupom.js";
import NatalParticipacao from "../src/models/NatalParticipacao.js";
import { NatalCampanhaEstado, NatalExportacao } from "../src/models/NatalCampanhaEstado.js";
import natalRoutes, { natalPublicRoutes } from "../src/routes/natalRoutes.js";
import {
  aprovarPedidoAdmin,
  atualizarPedidoAdmin,
  atualizarStatusPedido,
} from "../src/controllers/pedidoController.js";
import { mensagemEnvioPublico } from "../src/controllers/natalController.js";
import { resetIndicesNatalParaTestes } from "../src/services/natalBaseService.js";
import { criarStorageMemoria, setComprovanteStorage, validarArquivoComprovante } from "../src/services/natalComprovanteService.js";
import { sincronizarPedidoNatal } from "../src/services/natalLoteService.js";
import {
  aprovarParticipacao,
  cancelarParticipacao,
  registrarParticipacaoPublica,
  rejeitarParticipacao,
} from "../src/services/natalParticipacaoService.js";
import { alterarFechamentoLista, listarParticipacoes } from "../src/services/natalGestaoService.js";
import { gerarCsvCupons, gerarExportacao, listarCuponsValidosParaSorteio } from "../src/services/natalExportacaoService.js";
import { resolverRevisaoPendente } from "../src/services/natalRevisaoService.js";
import { calcularFaixa, validarParticipacaoPublica } from "../src/utils/natalCampanha.js";

process.env.JWT_SECRET ||= "segredo-de-teste-com-mais-de-32-caracteres!!";

let replSet;
const storage = criarStorageMemoria();
const DENTRO = new Date("2026-11-20T15:00:00.000Z");
const CRIADO_EM = new Date("2026-11-10T13:00:00.000Z");

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: "natal-testes" });
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
  await NatalCampanhaEstado.create({ _id: "natal-2026", modoCumulativo: "ativo" });
  storage.arquivos.clear();
});

let sequencia = 0;
const criarUsuario = (tipo, extra = {}) => {
  sequencia += 1;
  return Usuario.create({
    nomeResponsavel: `${tipo} ${sequencia}`,
    nomeFantasia: tipo === "cliente" ? `Distribuidora ${sequencia}` : undefined,
    razaoSocial: tipo === "cliente" ? `Distribuidora ${sequencia} LTDA` : undefined,
    email: `${tipo}${sequencia}@teste.local`,
    senha: "hash",
    tipo,
    statusCadastro: "aprovado",
    ...extra,
  });
};

const criarPedido = async (cliente, valorTotal, extra = {}) => {
  sequencia += 1;
  const produtoId = new mongoose.Types.ObjectId();
  return Pedido.create({
    numeroPedido: `PED-${sequencia}`,
    clienteId: cliente._id,
    nomeFantasiaCliente: cliente.nomeFantasia,
    razaoSocialCliente: cliente.razaoSocial,
    tabelaPrecoId: new mongoose.Types.ObjectId(),
    dia: 10, mes: 11, ano: 2026,
    itens: [{ produtoId, nomeProduto: "Shampoo", quantidade: 1, valorUnitario: valorTotal, subtotal: valorTotal }],
    valorTotal,
    status: "aguardando_aprovacao",
    createdAt: CRIADO_EM,
    ...extra,
  });
};

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const aprovarSomente = async (pedido, admin) => {
  const res = response();
  await aprovarPedidoAdmin({ usuario: admin, params: { id: String(pedido._id) } }, res);
  assert.equal(res.statusCode, 200, res.body?.message);
};

// Cupons são liberados na aprovação; o saldo fica na conta do distribuidor.
const liberarPedido = async (pedido, admin) => {
  await aprovarSomente(pedido, admin);
  return NatalConta.findOne({ clienteId: pedido.clienteId });
};

let cnpjSeq = 0;
const gerarCnpj = () => {
  cnpjSeq += 1;
  const base = `${String(10000000 + cnpjSeq).slice(-8)}0001`;
  const calc = (digits, weights) => {
    const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = calc(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(`${base}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${d1}${d2}`;
};

const pngValido = (marca = "x") => Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(400, marca),
]);

const dadosParticipacao = (extra = {}) => ({
  vendedorNome: "Carlos Vendedor",
  nomeFantasia: "Pet Feliz",
  razaoSocial: "Pet Feliz Comércio LTDA",
  documento: gerarCnpj(),
  responsavel: "Ana Souza",
  whatsapp: "11987654321",
  instagram: "petfeliz",
  dataCompra: "2026-11-15",
  valorCompra: 350.5,
  ...extra,
});

const cadastrar = async (conta, { dados = dadosParticipacao(), marca, now = DENTRO, config } = {}) => {
  const buffer = pngValido(marca || String(Math.random()));
  const meta = validarArquivoComprovante({ buffer, mimetype: "image/png", originalname: "nota.png" });
  return registrarParticipacaoPublica({
    codigo: conta.codigoPublico,
    dados,
    arquivo: { buffer, meta },
    ip: "10.0.0.1",
    userAgent: "teste",
    now,
    ...(config ? { config } : {}),
  });
};

const contexto = async () => {
  const [admin, comercial, distribuidor, outroDistribuidor, vendedorInterno] = await Promise.all([
    criarUsuario("admin"),
    criarUsuario("comercial"),
    criarUsuario("cliente"),
    criarUsuario("cliente"),
    criarUsuario("vendedor"),
  ]);
  return { admin, comercial, distribuidor, outroDistribuidor, vendedorInterno };
};

// 1–4: faixas definitivas, agora avaliadas por ciclo acumulado
for (const [valor, cupons, produtos] of [[12000, 100, 5], [20000, 200, 7], [30000, 300, 10], [40000, 400, 10], [55000, 500, 10]]) {
  test(`pedido de R$ ${valor} aprovado gera ${cupons} cupons`, async () => {
    const { admin, distribuidor } = await contexto();
    const pedido = await criarPedido(distribuidor, valor);
    const conta = await liberarPedido(pedido, admin);
    assert.ok(conta, "conta deve existir");
    assert.equal(conta.cupons.total, cupons);
    assert.equal((await NatalBonificacao.findOne({ clienteId: distribuidor._id, ciclo: 1, tipo: "marketing" })).percentual, 3);
    assert.equal((await NatalBonificacao.findOne({ clienteId: distribuidor._id, ciclo: 1, tipo: "produtos" })).percentual, produtos);
    assert.equal(await NatalLote.countDocuments(), 0, "novos pedidos não criam lote");
  });
}

test("faixas usam somente a configuração central", () => {
  assert.equal(calcularFaixa(11999.99), null);
  assert.equal(calcularFaixa(12000).cupons, 100);
  assert.equal(calcularFaixa(19999.99).cupons, 100);
  assert.deepEqual(NATAL_2026.faixas.map((faixa) => faixa.cupons), [100, 200, 300, 400]);
});

test("5. pedido aguardando aprovação não libera cupons", async () => {
  const { distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 25000);
  const resultado = await sincronizarPedidoNatal({ pedido, usuario: null });
  assert.equal(resultado.elegivel, false);
  assert.equal(await NatalConta.countDocuments(), 0);
  assert.equal(await NatalLote.countDocuments(), 0);
});test("6 e 15. aprovação libera o link próprio do distribuidor, sem depender do pedido", async () => {
  const { admin, distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 12500);
  const conta = await liberarPedido(pedido, admin);
  assert.match(conta.codigoPublico, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(String(conta.clienteId), String(distribuidor._id));
  assert.equal(conta.distribuidorNome, distribuidor.nomeFantasia);
  const participacao = await cadastrar(conta);
  assert.equal(String(participacao.clienteId), String(distribuidor._id));
  assert.equal(participacao.pedidoId, undefined);
  assert.equal(participacao.loteId, undefined);
});
test("pedido fora do período da campanha não entra no acumulado", async () => {
  const { admin, distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 30000, { createdAt: new Date("2026-10-20T12:00:00Z") });
  assert.equal(await liberarPedido(pedido, admin), null);
});
test("7, 8 e 9. subir de faixa acrescenta só a diferença, preserva participações e é idempotente", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 12000);
  let conta = await liberarPedido(pedido, admin);
  const participacoes = [];
  for (let i = 0; i < 3; i += 1) participacoes.push(await cadastrar(conta));
  for (const participacao of participacoes) await aprovarParticipacao({ id: participacao._id, usuario: comercial, now: DENTRO });
  const codigoOriginal = conta.codigoPublico;

  const atualizado = await Pedido.findById(pedido._id);
  atualizado.valorTotal = 20000;
  await atualizado.save();
  await sincronizarPedidoNatal({ pedido: atualizado, usuario: comercial, origem: "edicao" });
  await sincronizarPedidoNatal({ pedido: atualizado, usuario: comercial, origem: "edicao" });
  await Promise.all([1, 2, 3].map(() => sincronizarPedidoNatal({ pedido: atualizado, usuario: comercial, origem: "edicao" })));

  conta = await NatalConta.findById(conta._id);
  assert.equal(conta.cupons.total, 200);
  assert.equal(conta.codigoPublico, codigoOriginal, "não gera outro link");
  assert.equal(conta.contadores.aprovados, 3);
  assert.equal(await NatalConta.countDocuments(), 1, "não cria outra conta");
  const aumentos = await NatalMovimentoCupom.find({ clienteId: distribuidor._id, tipo: "conquista" }).sort({ _id: 1 });
  assert.deepEqual(aumentos.map((item) => item.quantidade), [100, 100]);
  assert.equal(aumentos[1].autor.usuarioTipo, "comercial");
  assert.equal(await NatalParticipacao.countDocuments({ status: "aprovado" }), 3);
});
test("redução fora da edição instrumentada não altera benefícios e sinaliza revisão pendente", async () => {
  const { admin, distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 12000);
  await liberarPedido(pedido, admin);
  const atualizado = await Pedido.findById(pedido._id);
  atualizado.valorTotal = 6000;
  await atualizado.save();
  await sincronizarPedidoNatal({ pedido: atualizado, usuario: admin, origem: "edicao" });
  await sincronizarPedidoNatal({ pedido: atualizado, usuario: admin, origem: "edicao" });
  const conta = await NatalConta.findOne({ clienteId: distribuidor._id });
  assert.equal(conta.cupons.total, 100);
  assert.equal(conta.acumulado.totalCompras, 6000);
  assert.equal(conta.revisaoPendente.valorNovo, 6000);
  assert.equal(await NatalAuditoria.countDocuments({ acao: "revisao_pendente", clienteId: distribuidor._id }), 1);
});
test("11. pedido cancelado abre revisão pendente e não invalida cadastros em silêncio", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 12000);
  const conta = await liberarPedido(pedido, admin);
  const aprovada = await cadastrar(conta);
  const pendente = await cadastrar(conta);
  await aprovarParticipacao({ id: aprovada._id, usuario: comercial, now: DENTRO });

  const res = response();
  await atualizarStatusPedido({ usuario: admin, params: { id: String(pedido._id) }, body: { status: "cancelado" } }, res);
  assert.equal(res.statusCode, 200, res.body?.message);

  const contaFinal = await NatalConta.findById(conta._id);
  assert.equal(contaFinal.cupons.total, 100, "benefícios só mudam por decisão");
  assert.equal(contaFinal.acumulado.totalCompras, 0);
  assert.equal(contaFinal.revisaoPendente.origem, "cancelamento");
  assert.equal((await NatalCupom.findOne({ participacaoId: aprovada._id })).status, "valido");
  assert.equal((await NatalParticipacao.findById(pendente._id)).status, "pendente");
  assert.equal((await listarCuponsValidosParaSorteio()).length, 1);

  await resolverRevisaoPendente({ clienteId: distribuidor._id, entrada: { decisao: "adequar", justificativa: "Pedido cancelado pelo distribuidor" }, usuario: comercial, now: DENTRO });
  const adequada = await NatalConta.findById(conta._id);
  assert.equal(adequada.cupons.total, 0);
  assert.equal(adequada.revisaoPendente, undefined);
  assert.equal((await NatalParticipacao.findById(aprovada._id)).status, "invalidado_revisao");
  assert.equal((await NatalCupom.findOne({ participacaoId: aprovada._id })).status, "invalidado");
  assert.equal((await listarCuponsValidosParaSorteio()).length, 0);
});
test("12. pedidos do mesmo distribuidor somam em um único saldo", async () => {
  const { admin, distribuidor } = await contexto();
  await liberarPedido(await criarPedido(distribuidor, 12000), admin);
  const conta = await liberarPedido(await criarPedido(distribuidor, 30000), admin);
  assert.equal(await NatalConta.countDocuments(), 1);
  assert.equal(conta.cupons.total, 400);
  assert.equal(conta.acumulado.ciclosConcluidos, 1);
  assert.equal(conta.acumulado.acumuladoCiclo, 2000);
  await cadastrar(conta);
  assert.equal((await NatalConta.findById(conta._id)).contadores.pendentes, 1);
});
test("13. mesmo CNPJ participa várias vezes e duplicidades geram alerta", async () => {
  const { admin, outroDistribuidor, distribuidor } = await contexto();
  const contaA = await liberarPedido(await criarPedido(distribuidor, 12000), admin);
  const contaB = await liberarPedido(await criarPedido(outroDistribuidor, 12000), admin);
  const cnpj = gerarCnpj();
  const primeira = await cadastrar(contaA, { dados: dadosParticipacao({ documento: cnpj, dataCompra: "2026-11-12" }), marca: "a" });
  const outraData = await cadastrar(contaA, { dados: dadosParticipacao({ documento: cnpj, dataCompra: "2026-11-14" }), marca: "b" });
  const repetida = await cadastrar(contaB, { dados: dadosParticipacao({ documento: cnpj, dataCompra: "2026-11-12" }), marca: "a" });
  assert.equal(await NatalParticipacao.countDocuments({ "petshop.documento": cnpj }), 3);
  assert.equal(outraData.alertas.length, 0);
  assert.equal(repetida.alertas[0].tipo, "mesmo_comprovante");
  const primeiraAtualizada = await NatalParticipacao.findById(primeira._id);
  assert.equal(String(primeiraAtualizada.alertas[0].participacaoId), String(repetida._id));
});

const montarApp = () => {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api/public/natal-2026", natalPublicRoutes);
  app.use("/api/natal-2026", natalRoutes);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
};

test("14 e 16. formulário funciona sem login via HTTP e o cadastro fica pendente", async (t) => {
  const { admin, distribuidor } = await contexto();
  const conta = await liberarPedido(await criarPedido(distribuidor, 12000), admin);
  const server = await montarApp();
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/public/natal-2026`;

  const info = await fetch(`${base}/lotes/${conta.codigoPublico}`).then((r) => r.json());
  assert.equal(info.distribuidorNome, distribuidor.nomeFantasia);
  assert.equal(info.cuponsConcedidos, undefined, "não expõe dados internos");

  const config = await fetch(`${base}/config`).then((r) => r.json());
  assert.equal(config.faixas.length, 4);

  // Fora do período os envios são bloqueados; aqui valida a regra de período do lado do servidor.
  const form = new FormData();
  // Data de compra = hoje (Brasília): válida quando o teste roda durante a campanha.
  const hojeBrasilia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const dados = dadosParticipacao({ dataCompra: hojeBrasilia });
  for (const [campo, valor] of Object.entries(dados)) form.append(campo, String(valor));
  form.append("aceiteTermos", "true");
  form.append("iniciadoEm", String(Date.now() - 60000));
  form.append("comprovante", new Blob([pngValido("http")], { type: "image/png" }), "nota.png");
  const envio = await fetch(`${base}/lotes/${conta.codigoPublico}/participacoes`, { method: "POST", body: form });
  const corpo = await envio.json();
  if (new Date() < NATAL_2026.inicio) {
    assert.equal(envio.status, 409);
    assert.equal(corpo.codigo, "nao_iniciada");
  } else if (new Date() > NATAL_2026.fimCadastros) {
    assert.equal(envio.status, 409);
  } else {
    assert.equal(envio.status, 201);
    assert.equal(corpo.message, mensagemEnvioPublico(1));
    assert.equal(corpo.quantidade, 1);
    assert.equal(corpo.cupons.length, 1);
    assert.equal(corpo.status, "pendente");
  }

  const bot = new FormData();
  bot.append("website", "http://spam");
  const bloqueado = await fetch(`${base}/lotes/${conta.codigoPublico}/participacoes`, { method: "POST", body: bot });
  assert.equal(bloqueado.status, 400);

  const executavel = new FormData();
  executavel.append("comprovante", new Blob([Buffer.from("MZ....")], { type: "application/x-msdownload" }), "virus.exe");
  const recusado = await fetch(`${base}/lotes/${conta.codigoPublico}/participacoes`, { method: "POST", body: executavel });
  assert.equal(recusado.status, 400);

  assert.equal((await fetch(`${base}/lotes/codigo-inexistente-123456`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/natal-2026/gestao/painel`)).status, 401);
});

test("16. cadastro enviado entra pendente e não consome saldo", async () => {
  const { admin, distribuidor } = await contexto();
  const conta = await liberarPedido(await criarPedido(distribuidor, 12000), admin);
  const participacao = await cadastrar(conta);
  assert.equal(participacao.status, "pendente");
  assert.equal(participacao.cupom, undefined);
  const atualizado = await NatalConta.findById(conta._id);
  assert.equal(atualizado.contadores.pendentes, 1);
  assert.equal(atualizado.contadores.aprovados, 0);
  assert.equal(atualizado.cupons.total - atualizado.contadores.aprovados, 100);
});

test("17 e 18. somente Comercial ou Administrador aprovam; distribuidor e vendedor não", async () => {
  const { admin, comercial, distribuidor, vendedorInterno } = await contexto();
  const conta = await liberarPedido(await criarPedido(distribuidor, 12000), admin);
  const p1 = await cadastrar(conta);
  const p2 = await cadastrar(conta);
  await assert.rejects(aprovarParticipacao({ id: p1._id, usuario: distribuidor }), { statusCode: 403 });
  await assert.rejects(aprovarParticipacao({ id: p1._id, usuario: vendedorInterno }), { statusCode: 403 });
  await assert.rejects(rejeitarParticipacao({ id: p1._id, usuario: distribuidor, motivo: "Sem nota" }), { statusCode: 403 });
  const aprovadaComercial = await aprovarParticipacao({ id: p1._id, usuario: comercial, now: DENTRO });
  const aprovadaAdmin = await aprovarParticipacao({ id: p2._id, usuario: admin, now: DENTRO });
  assert.equal(aprovadaComercial.status, "aprovado");
  assert.equal(aprovadaAdmin.status, "aprovado");
  assert.match(aprovadaComercial.cupom.codigo, /^\d{5}$/);
});

test("rejeição exige motivo e fica registrada no histórico", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const conta = await liberarPedido(await criarPedido(distribuidor, 12000), admin);
  const p = await cadastrar(conta);
  await assert.rejects(rejeitarParticipacao({ id: p._id, usuario: comercial, motivo: "" }), { statusCode: 400 });
  const rejeitada = await rejeitarParticipacao({ id: p._id, usuario: comercial, motivo: "Comprovante ilegível" });
  assert.equal(rejeitada.status, "rejeitado");
  assert.equal(rejeitada.historico.at(-1).acao, "rejeitado");
  const atualizado = await NatalConta.findById(conta._id);
  assert.equal(atualizado.contadores.rejeitados, 1);
  assert.equal(atualizado.contadores.pendentes, 0);
  assert.ok(await NatalAuditoria.findOne({ acao: "participacao_rejeitada", participacaoId: p._id }));
});

test("19, 20, 21 e 23. cancelamento pelo distribuidor dono devolve vaga uma única vez", async () => {
  const { admin, comercial, distribuidor, outroDistribuidor } = await contexto();
  const conta = await liberarPedido(await criarPedido(distribuidor, 12000), admin);
  const p = await cadastrar(conta);
  const aprovada = await aprovarParticipacao({ id: p._id, usuario: comercial, now: DENTRO });

  await assert.rejects(
    cancelarParticipacao({ id: p._id, usuario: outroDistribuidor, motivo: "Tentativa indevida" }),
    { statusCode: 403 }
  );
  await assert.rejects(cancelarParticipacao({ id: p._id, usuario: distribuidor, motivo: "" }), { statusCode: 400 });

  const resultados = await Promise.allSettled([1, 2, 3].map(() => cancelarParticipacao({
    id: p._id, usuario: distribuidor, motivo: "Compra devolvida pelo pet shop",
  })));
  assert.equal(resultados.filter((item) => item.status === "fulfilled").length, 1);

  const contaAtual = await NatalConta.findById(conta._id);
  assert.equal(contaAtual.contadores.aprovados, 0);
  assert.equal(contaAtual.contadores.cancelados, 1);
  assert.equal(contaAtual.cupons.total - contaAtual.contadores.aprovados, 100);
  const cancelada = await NatalParticipacao.findById(p._id);
  assert.equal(cancelada.status, "cancelado");
  assert.equal(cancelada.cancelamento.autor.usuarioTipo, "cliente");
  assert.equal(cancelada.cancelamento.statusAnterior, "aprovado");
  const cupom = await NatalCupom.findOne({ numero: aprovada.cupom.numero });
  assert.equal(cupom.status, "cancelado", "número invalidado, nunca reutilizado");
  await assert.rejects(aprovarParticipacao({ id: p._id, usuario: comercial }), { statusCode: 409 });
});

test("12 (saldo). exemplo 150 aprovados - 3 cancelados = 147 aprovados e 53 disponíveis", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const conta = await liberarPedido(await criarPedido(distribuidor, 20000), admin);
  const participacoes = [];
  for (let i = 0; i < 150; i += 1) participacoes.push(await cadastrar(conta));
  for (const p of participacoes) await aprovarParticipacao({ id: p._id, usuario: comercial, now: DENTRO });
  for (const p of participacoes.slice(0, 3)) {
    await cancelarParticipacao({ id: p._id, usuario: comercial, motivo: "Ajuste comercial" });
  }
  const atual = await NatalConta.findById(conta._id);
  assert.equal(atual.contadores.aprovados, 147);
  assert.equal(atual.cupons.total - atual.contadores.aprovados, 53);
  assert.equal(new Set((await NatalCupom.find({})).map((cupom) => cupom.numero)).size, 150);
});

test("22. cancelamento de cadastro pendente não altera o saldo aprovado", async () => {
  const { admin, distribuidor } = await contexto();
  const conta = await liberarPedido(await criarPedido(distribuidor, 12000), admin);
  const p = await cadastrar(conta);
  await cancelarParticipacao({ id: p._id, usuario: distribuidor, motivo: "Cadastro duplicado" });
  const atual = await NatalConta.findById(conta._id);
  assert.equal(atual.contadores.aprovados, 0);
  assert.equal(atual.contadores.pendentes, 0);
  assert.equal(atual.contadores.cancelados, 1);
  assert.equal(atual.cupons.total - atual.contadores.aprovados, 100);
});

test("24 e 25. aprovações simultâneas nunca ultrapassam a quantidade concedida", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const conta = await liberarPedido(await criarPedido(distribuidor, 12000), admin);
  const participacoes = [];
  for (let i = 0; i < 8; i += 1) participacoes.push(await cadastrar(conta));
  // Saldo reduzido depois dos envios: 8 pendentes para 3 vagas.
  await NatalConta.updateOne({ _id: conta._id }, { $set: { "cupons.total": 3 } });

  // Cada cadastro recebe duas aprovações concorrentes.
  const tentativas = participacoes.flatMap((p) => [p, p]).map((p) => aprovarParticipacao({ id: p._id, usuario: comercial, now: DENTRO }));
  await Promise.allSettled(tentativas);

  const aprovadas = await NatalParticipacao.countDocuments({ clienteId: conta.clienteId, status: "aprovado" });
  const atual = await NatalConta.findById(conta._id);
  assert.ok(aprovadas <= 3);
  assert.equal(atual.contadores.aprovados, aprovadas);
  assert.equal(await NatalCupom.countDocuments({ clienteId: conta.clienteId, status: "valido" }), aprovadas);
  assert.equal(atual.contadores.pendentes, 8 - aprovadas);
});

test("ordem de recebimento: com vagas escassas, cadastros antigos têm prioridade", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const conta = await liberarPedido(await criarPedido(distribuidor, 12000), admin);
  const antigo = await cadastrar(conta, { now: new Date("2026-11-20T10:00:00Z") });
  const novo = await cadastrar(conta, { now: new Date("2026-11-20T11:00:00Z") });
  // Saldo reduzido depois dos envios: 2 pendentes para 1 vaga.
  await NatalConta.updateOne({ _id: conta._id }, { $set: { "cupons.total": 1 } });
  await assert.rejects(aprovarParticipacao({ id: novo._id, usuario: comercial }), { code: "ordem_recebimento" });
  await rejeitarParticipacao({ id: antigo._id, usuario: comercial, motivo: "Fora das regras" });
  const aprovado = await aprovarParticipacao({ id: novo._id, usuario: comercial, now: DENTRO });
  assert.equal(aprovado.status, "aprovado");
});

test("26. números de cupons são únicos, aleatórios e não reaproveitados", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const config = buildNatalConfig({ NATAL2026_CUPOM_MIN: "1", NATAL2026_CUPOM_MAX: "12", NATAL2026_CUPOM_DIGITOS: "4" });
  const conta = await liberarPedido(await criarPedido(distribuidor, 12000), admin);
  // Os números são gerados no envio (aguardando validação) e valem na aprovação.
  const participacoes = [];
  for (let i = 0; i < 12; i += 1) participacoes.push(await cadastrar(conta, { config }));
  const numeros = (await NatalCupom.find({ clienteId: conta.clienteId })).map((cupom) => cupom.numero);
  assert.equal(new Set(numeros).size, 12);
  assert.ok(numeros.every((numero) => numero >= 1 && numero <= 12));
  for (const p of participacoes.slice(0, 11)) {
    const aprovada = await aprovarParticipacao({ id: p._id, usuario: comercial, config, now: DENTRO });
    assert.ok(numeros.includes(aprovada.cupom.numero), "a aprovação mantém o número do envio");
  }
  await cancelarParticipacao({ id: participacoes[0]._id, usuario: comercial, motivo: "Teste de reaproveitamento" });
  // Intervalo esgotado: o número cancelado não volta e o envio é desfeito por completo.
  const antes = await NatalConta.findById(conta._id);
  const arquivosAntes = storage.arquivos.size;
  await assert.rejects(cadastrar(conta, { config }), { statusCode: 503, code: "numeracao_esgotada" });
  const atual = await NatalConta.findById(conta._id);
  assert.equal(atual.contadores.aprovados, 10);
  assert.equal(atual.contadores.pendentes, 1);
  assert.equal(atual.contadores.pendentes, antes.contadores.pendentes, "reserva desfeita");
  assert.equal(storage.arquivos.size, arquivosAntes, "comprovante removido");
  assert.equal(await NatalParticipacao.countDocuments({ clienteId: conta.clienteId }), 12, "nenhum cadastro parcial");
  assert.equal(await NatalCupom.countDocuments({ numero: numeros[0] }), 1);
  assert.equal((await NatalCupom.findOne({ participacaoId: participacoes[0]._id })).status, "cancelado");
});

test("27 e 28. exportações excluem cancelados, pendentes, rejeitados e invalidados", async () => {
  const { admin, comercial, distribuidor, outroDistribuidor } = await contexto();
  const contaA = await liberarPedido(await criarPedido(distribuidor, 12000), admin);
  const pedidoB = await criarPedido(outroDistribuidor, 12000);
  const contaB = await liberarPedido(pedidoB, admin);
  const [valida, cancelada, , rejeitada] = [await cadastrar(contaA), await cadastrar(contaA), await cadastrar(contaA), await cadastrar(contaA)];
  const invalidada = await cadastrar(contaB);
  await aprovarParticipacao({ id: valida._id, usuario: comercial, now: DENTRO });
  await aprovarParticipacao({ id: cancelada._id, usuario: comercial, now: DENTRO });
  await aprovarParticipacao({ id: invalidada._id, usuario: comercial, now: DENTRO });
  await rejeitarParticipacao({ id: rejeitada._id, usuario: comercial, motivo: "Documento inválido" });
  await cancelarParticipacao({ id: cancelada._id, usuario: distribuidor, motivo: "Venda desfeita" });
  const res = response();
  await atualizarStatusPedido({ usuario: admin, params: { id: String(pedidoB._id) }, body: { status: "cancelado" } }, res);
  await resolverRevisaoPendente({ clienteId: outroDistribuidor._id, entrada: { decisao: "adequar", justificativa: "Pedido cancelado, cupons retirados" }, usuario: comercial, now: DENTRO });

  const linhas = await listarCuponsValidosParaSorteio();
  const validaAtual = await NatalParticipacao.findById(valida._id);
  assert.deepEqual(linhas.map((linha) => linha.codigo), [validaAtual.cupom.codigo]);
  const csv = gerarCsvCupons(linhas).toString("utf8");
  assert.ok(csv.includes(validaAtual.cupom.codigo));
  const canceladaAtual = await NatalParticipacao.findById(cancelada._id);
  assert.ok(!csv.includes(`"${canceladaAtual.cupom.codigo}"`));

  const pdf = await gerarExportacao({ tipo: "pdf_urna", usuario: comercial });
  assert.equal(pdf.totalCupons, 1);
  assert.equal(pdf.buffer.subarray(0, 5).toString(), "%PDF-");
  assert.match(pdf.nomeArquivo, /previa\.pdf$/);
  const numerica = await gerarExportacao({ tipo: "csv_numerica", usuario: comercial });
  assert.equal(numerica.totalCupons, 1);
  assert.equal(await NatalExportacao.countDocuments(), 2);
});

test("29. cadastros após 10/12 (horário de Brasília) são bloqueados", async () => {
  const { admin, distribuidor } = await contexto();
  const conta = await liberarPedido(await criarPedido(distribuidor, 12000), admin);
  const ultimoMinuto = new Date("2026-12-10T23:59:00-03:00");
  const depois = new Date("2026-12-11T00:00:01-03:00");
  const ok = await cadastrar(conta, { dados: dadosParticipacao({ dataCompra: "2026-12-10" }), now: ultimoMinuto });
  assert.equal(ok.status, "pendente");
  await assert.rejects(cadastrar(conta, { now: depois }), { statusCode: 409, code: "encerrada" });
  const validacao = validarParticipacaoPublica({ ...dadosParticipacao({ dataCompra: "2026-12-20" }), aceiteTermos: true }, { now: depois });
  assert.ok(validacao.errors.dataCompra);
});

test("validação do formulário: CNPJ, campos obrigatórios e arquivos", () => {
  const invalido = validarParticipacaoPublica({ cnpj: "11.111.111/1111-11" }, { now: DENTRO });
  for (const campo of ["vendedorNome", "nomeFantasia", "razaoSocial", "documento", "responsavel", "whatsapp", "instagram", "dataCompra", "valorCompra", "aceiteTermos"]) {
    assert.ok(invalido.errors[campo], `erro esperado em ${campo}`);
  }
  const valido = validarParticipacaoPublica({ ...dadosParticipacao({ instagram: "https://instagram.com/Pet.Feliz/", valorCompra: "1.234,56" }), aceiteTermos: "true" }, { now: DENTRO });
  assert.equal(valido.valid, true);
  assert.equal(valido.data.instagram, "pet.feliz");
  assert.equal(valido.data.valorCompra, 1234.56);

  assert.throws(() => validarArquivoComprovante({ buffer: Buffer.from("GIF89a....".repeat(40)), mimetype: "image/png", originalname: "a.png" }));
  assert.throws(() => validarArquivoComprovante({ buffer: pngValido(), mimetype: "image/png", originalname: "a.exe" }));
  const pdfMalicioso = Buffer.from(`%PDF-1.7\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\n${"x".repeat(300)}`);
  assert.throws(() => validarArquivoComprovante({ buffer: pdfMalicioso, mimetype: "application/pdf", originalname: "nota.pdf" }));
  const pdfSimples = Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >>\n${"x".repeat(300)}`);
  assert.equal(validarArquivoComprovante({ buffer: pdfSimples, mimetype: "application/pdf", originalname: "nota.pdf" }).mimetype, "application/pdf");
  assert.throws(() => validarArquivoComprovante({ buffer: Buffer.alloc(11 * 1024 * 1024, 0x89), mimetype: "image/png", originalname: "a.png" }));
});

test("20. distribuidor lista e consulta apenas as próprias participações", async () => {
  const { admin, distribuidor, outroDistribuidor } = await contexto();
  const contaA = await liberarPedido(await criarPedido(distribuidor, 12000), admin);
  const contaB = await liberarPedido(await criarPedido(outroDistribuidor, 12000), admin);
  await cadastrar(contaA);
  const deOutro = await cadastrar(contaB);
  const lista = await listarParticipacoes({}, { clienteId: distribuidor._id });
  assert.equal(lista.total, 1);
  assert.equal(lista.itens[0].alertas, undefined, "alertas ficam restritos à gestão");

  const server = await montarApp();
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/natal-2026`;
    const token = jwt.sign({ id: distribuidor._id, tipo: "cliente", tokenVersion: 0 }, process.env.JWT_SECRET, { algorithm: "HS256" });
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(`${base}/participacoes/${deOutro._id}`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/participacoes/${deOutro._id}/comprovante`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/gestao/participacoes`, { headers })).status, 403);
    const resumo = await fetch(`${base}/distribuidor/resumo`, { headers }).then((r) => r.json());
    assert.equal(resumo.lotes.length, 0);
    assert.equal(String(resumo.conta.clienteId), String(distribuidor._id));
    assert.equal(resumo.conta.cupons.total, 100);
    assert.equal(resumo.conta.movimentos, undefined, "extrato completo é exclusivo da gestão");
    const proprias = await fetch(`${base}/distribuidor/participacoes`, { headers }).then((r) => r.json());
    assert.equal(proprias.total, 1);
    const comprovante = await fetch(`${base}/participacoes/${proprias.itens[0]._id}/comprovante`, { headers });
    assert.equal(comprovante.status, 200);
    assert.equal(comprovante.headers.get("cache-control"), "private, no-store");
  } finally {
    server.close();
  }
});

test("32. edição de pedido em separação preserva registros logísticos e atualiza a faixa", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const produtoA = await Produto.create({ nome: "Shampoo", linha: "Banho", categoria: "Shampoo" });
  const produtoB = await Produto.create({ nome: "Condicionador", linha: "Banho", categoria: "Condicionador" });
  const tabelaPrecoId = new mongoose.Types.ObjectId();
  await PrecoProduto.create([
    { produtoId: produtoA._id, tabelaPrecoId, valor: 100 },
    { produtoId: produtoB._id, tabelaPrecoId, valor: 80 },
  ]);
  const pedido = await criarPedido(distribuidor, 12000, {
    tabelaPrecoId,
    itens: [{ produtoId: produtoA._id, nomeProduto: "Shampoo", quantidade: 120, valorUnitario: 100, subtotal: 12000, quantidadeSeparada: 60, situacaoSeparacao: "parcial" }],
  });
  await aprovarSomente(pedido, admin);
  await Pedido.updateOne({ _id: pedido._id }, { $set: { status: "separando" } });
  const atual = await Pedido.findById(pedido._id);

  const res = response();
  await atualizarPedidoAdmin({
    usuario: comercial,
    params: { id: String(pedido._id) },
    body: { versaoPedido: atual.__v, itens: [{ produtoId: String(produtoA._id), quantidade: 120 }, { produtoId: String(produtoB._id), quantidade: 100 }] },
  }, res);
  assert.equal(res.statusCode, 200, res.body?.message);
  const editado = await Pedido.findById(pedido._id).select("+historicoAlteracoes");
  assert.equal(editado.valorTotal, 20000);
  assert.equal(editado.status, "separando");
  assert.equal(editado.itens.find((item) => String(item.produtoId) === String(produtoA._id)).quantidadeSeparada, 60);
  assert.equal(editado.historicoAlteracoes.length, 1);
  const conta = await NatalConta.findOne({ clienteId: distribuidor._id });
  assert.equal(conta.cupons.total, 200);
  const ultimo = await NatalMovimentoCupom.findOne({ clienteId: distribuidor._id, tipo: "conquista" }).sort({ _id: -1 });
  assert.equal(ultimo.autor.usuarioTipo, "comercial");
});

test("fechamento da lista bloqueia alterações exceto ajuste justificado do Administrador", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const conta = await liberarPedido(await criarPedido(distribuidor, 12000), admin);
  const p = await cadastrar(conta);
  await assert.rejects(alterarFechamentoLista({ acao: "fechar", usuario: comercial }), { statusCode: 403 });
  await alterarFechamentoLista({ acao: "fechar", usuario: admin });
  await assert.rejects(alterarFechamentoLista({ acao: "fechar", usuario: admin }), { statusCode: 409 });
  await assert.rejects(aprovarParticipacao({ id: p._id, usuario: comercial }), { code: "lista_fechada" });
  await assert.rejects(cancelarParticipacao({ id: p._id, usuario: distribuidor, motivo: "Desistência" }), { code: "lista_fechada" });
  await assert.rejects(aprovarParticipacao({ id: p._id, usuario: admin, justificativa: "curta" }), { code: "lista_fechada" });
  const ajustada = await aprovarParticipacao({ id: p._id, usuario: admin, justificativa: "Validação concluída antes do sorteio, conforme ata.", now: DENTRO });
  assert.equal(ajustada.status, "aprovado");
  const auditoria = await NatalAuditoria.findOne({ acao: "participacao_aprovada", participacaoId: p._id });
  assert.equal(auditoria.aposFechamento, true);
  const estado = await NatalCampanhaEstado.findById("natal-2026");
  assert.equal(estado.listaFechada, true);
  const exportacao = await gerarExportacao({ tipo: "csv_numerica", usuario: admin });
  assert.doesNotMatch(exportacao.nomeArquivo, /previa/);
});

test("auditoria é imutável", async () => {
  const { admin, distribuidor } = await contexto();
  await liberarPedido(await criarPedido(distribuidor, 12000), admin);
  const registro = await NatalAuditoria.findOne({ acao: "conta_criada" });
  assert.ok(registro);
  await assert.rejects(NatalAuditoria.updateOne({ _id: registro._id }, { $set: { acao: "lista_fechada" } }));
  await assert.rejects(NatalAuditoria.deleteOne({ _id: registro._id }));
  registro.detalhes = { alterado: true };
  await assert.rejects(registro.save());
});

test("saldo esgotado bloqueia novos cadastros e a reserva é estrita", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const conta = await liberarPedido(await criarPedido(distribuidor, 12000), admin);
  await NatalConta.updateOne({ _id: conta._id }, { $set: { "cupons.total": 1 } });
  const config = buildNatalConfig({ NATAL2026_FOLGA_FILA: "1" });
  const buffer = pngValido("fila");
  const meta = validarArquivoComprovante({ buffer, mimetype: "image/png", originalname: "n.png" });
  const enviar = () => registrarParticipacaoPublica({ codigo: conta.codigoPublico, dados: dadosParticipacao(), arquivo: { buffer, meta }, config, now: DENTRO });
  const primeiro = await enviar();
  await assert.rejects(enviar(), { code: "fila_cheia" });
  assert.equal(storage.arquivos.size, 1, "arquivo recusado não fica armazenado");
  await aprovarParticipacao({ id: primeiro._id, usuario: comercial, now: DENTRO });
  await assert.rejects(enviar(), { code: "esgotado" });
});
