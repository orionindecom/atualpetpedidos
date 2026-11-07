import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import Pedido from "../src/models/Pedido.js";
import Usuario from "../src/models/Usuario.js";
import NatalAuditoria from "../src/models/NatalAuditoria.js";
import NatalBonificacao from "../src/models/NatalBonificacao.js";
import NatalCompraExterna from "../src/models/NatalCompraExterna.js";
import NatalConta from "../src/models/NatalConta.js";
import NatalCupom from "../src/models/NatalCupom.js";
import NatalLote from "../src/models/NatalLote.js";
import NatalMovimentoCupom from "../src/models/NatalMovimentoCupom.js";
import NatalParticipacao from "../src/models/NatalParticipacao.js";
import { NatalCampanhaEstado } from "../src/models/NatalCampanhaEstado.js";
import { aprovarPedidoAdmin, atualizarStatusPedido, excluirPedidoAdmin } from "../src/controllers/pedidoController.js";
import { gerarCodigoPublico, resetIndicesNatalParaTestes } from "../src/services/natalBaseService.js";
import {
  cancelarCompraExterna,
  registrarCompraExterna,
  registrarEntregaBonificacao,
  rejeitarCompraExterna,
  validarCompraExterna,
} from "../src/services/natalCompraExternaService.js";
import { criarStorageMemoria, setComprovanteStorage, validarArquivoComprovante } from "../src/services/natalComprovanteService.js";
import { ajustarCuponsConta, garantirConta, recalcularConta } from "../src/services/natalContaService.js";
import { detalharDistribuidor, listarDistribuidores } from "../src/services/natalDistribuidorService.js";
import { listarCuponsValidosParaSorteio } from "../src/services/natalExportacaoService.js";
import { reconciliarLotes, sincronizarPedidoNatal } from "../src/services/natalLoteService.js";
import { analisarMigracao, ativarCumulativo, concederBeneficios, executarMigracao, fotografarDadosOriginais } from "../src/services/natalMigracaoService.js";
import {
  aprovarParticipacao,
  cancelarParticipacao,
  obterLotePublico,
  registrarParticipacaoPublica,
} from "../src/services/natalParticipacaoService.js";
import { previaRevisaoPendente, resolverRevisaoPendente } from "../src/services/natalRevisaoService.js";
import { alocarComprasNosCiclos, calcularEstadoCumulativo, paraCentavos } from "../src/utils/natalCumulativo.js";

process.env.JWT_SECRET ||= "segredo-de-teste-com-mais-de-32-caracteres!!";

let replSet;
const storage = criarStorageMemoria();
const DENTRO = new Date("2026-11-20T15:00:00.000Z");
const CRIADO_EM = new Date("2026-11-10T13:00:00.000Z");

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: "natal-cumulativo" });
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

const usuario = (tipo, extra = {}) => {
  sequencia += 1;
  return Usuario.create({
    nomeResponsavel: `${tipo} ${sequencia}`,
    nomeFantasia: tipo === "cliente" ? `Distribuidora ${sequencia}` : undefined,
    razaoSocial: tipo === "cliente" ? `Distribuidora ${sequencia} LTDA` : undefined,
    email: `${tipo}${sequencia}@cumulativo.local`,
    senha: "hash",
    tipo,
    statusCadastro: "aprovado",
    ...extra,
  });
};

const voltarAoLegado = () => NatalCampanhaEstado.updateOne({ _id: "natal-2026" }, { $set: { modoCumulativo: "legado" } });

// Percorre as etapas autorizadas: migração, concessão e ativação.
const ativarModelo = async () => {
  await executarMigracao({ operador: "Teste", now: DENTRO });
  await concederBeneficios({ operador: "Teste", now: DENTRO });
  await ativarCumulativo({ operador: "Teste", now: DENTRO });
};

const contexto = async () => {
  const [admin, comercial, distribuidor] = await Promise.all([usuario("admin"), usuario("comercial"), usuario("cliente")]);
  return { admin, comercial, distribuidor };
};

const criarPedido = async (cliente, valorTotal, extra = {}) => {
  sequencia += 1;
  return Pedido.create({
    numeroPedido: `CUM-${sequencia}`,
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

const mudarStatus = async (pedido, status = "aprovado") => {
  await Pedido.updateOne({ _id: pedido._id }, { $set: { status } });
  await sincronizarPedidoNatal({ pedido: await Pedido.findById(pedido._id), usuario: null, origem: "status", now: DENTRO });
};

const comprar = async (cliente, valores) => {
  const pedidos = [];
  for (const valor of valores) {
    const pedido = await criarPedido(cliente, valor);
    await mudarStatus(pedido);
    pedidos.push(pedido);
  }
  return pedidos;
};

const contaDe = (cliente) => NatalConta.findOne({ clienteId: cliente._id });

const bonificacao = (cliente, ciclo, tipo) => NatalBonificacao.findOne({ clienteId: cliente._id, ciclo, tipo });

// Lote do modelo antigo, com link já divulgado.
const criarLoteLegado = async (cliente, pedido, cupons) => NatalLote.create({
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
  const base = `${String(20000000 + cnpjSeq).slice(-8)}0001`;
  const calc = (digits, weights) => {
    const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = calc(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(`${base}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${d1}${d2}`;
};

const cadastrar = async (codigo, marca = String(Math.random())) => {
  const buffer = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, marca)]);
  const meta = validarArquivoComprovante({ buffer, mimetype: "image/png", originalname: "nota.png" });
  return registrarParticipacaoPublica({
    codigo,
    dados: {
      vendedorNome: "Carlos Vendedor", nomeFantasia: "Pet Feliz", razaoSocial: "Pet Feliz LTDA",
      documento: gerarCnpj(), tipoDocumento: "cnpj", responsavel: "Ana", whatsapp: "11987654321",
      instagram: "petfeliz", dataCompra: "2026-11-15", valorCompra: 350.5,
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

const JUSTIFICATIVA = "Pedido reduzido a pedido do distribuidor";
const DADOS_EXTERNA = { valor: "12.000,00", data: "2026-11-10", referencia: "NF 12345", observacoes: "Compra direta" };
const AGORA = new Date("2026-11-25T12:00:00.000Z");

// ---------- Regras puras ----------

test("exemplo obrigatório: R$ 60 mil em seis pedidos resultam em 600 cupons, ciclo a ciclo", () => {
  const passos = [[12000, 100], [20000, 200], [40000, 400], [48000, 400], [52000, 500], [60000, 600]];
  for (const [total, cupons] of passos) {
    assert.equal(calcularEstadoCumulativo(paraCentavos(total)).cuponsDevidos, cupons, `R$ ${total}`);
  }
  const estado = calcularEstadoCumulativo(paraCentavos(60000));
  assert.equal(estado.ciclosConcluidos, 1);
  assert.equal(estado.cicloAtual, 2);
  assert.equal(estado.acumuladoCicloCentavos, paraCentavos(20000));
  assert.equal(estado.restanteProximaFaixaCentavos, paraCentavos(10000));
});

test("sem limite global e sem arredondamento indevido", () => {
  assert.equal(calcularEstadoCumulativo(paraCentavos(400000)).cuponsDevidos, 4000);
  assert.equal(calcularEstadoCumulativo(paraCentavos(39999.99)).cuponsDevidos, 300);
  assert.equal(calcularEstadoCumulativo(paraCentavos(11999.99)).cuponsDevidos, 0);
  assert.equal(calcularEstadoCumulativo(paraCentavos(19999.99)).ciclos[0].produtos.devidoCentavos, 100000);
  // Soma de valores quebrados em ponto flutuante não perde centavos.
  assert.equal(paraCentavos(30507.519999999993), 3050752);
});

test("alocação mostra em quais ciclos caiu o valor de cada compra", () => {
  const alocadas = alocarComprasNosCiclos([
    { id: "a", data: "2026-11-05", valorCentavos: paraCentavos(30000) },
    { id: "b", data: "2026-11-06", valorCentavos: paraCentavos(52000) },
  ]);
  assert.deepEqual(alocadas[1].ciclos.map((item) => [item.ciclo, item.valorCentavos / 100]), [[1, 10000], [2, 40000], [3, 2000]]);
});

// ---------- 1 a 7: cupons ----------

for (const [numero, valores, cupons] of [
  [1, [12000], 100],
  [2, [12000, 8000], 200],
  [3, [12000, 8000, 20000], 400],
  [4, [40000, 8000], 400],
  [5, [40000, 8000, 4000], 500],
  [6, [52000], 500],
  [7, [80000], 800],
]) {
  test(`${numero}. pedidos de ${valores.join(" + ")} resultam em ${cupons} cupons`, async () => {
    const { distribuidor } = await contexto();
    await comprar(distribuidor, valores);
    const conta = await contaDe(distribuidor);
    assert.equal(conta.cupons.total, cupons);
    const movimentos = await NatalMovimentoCupom.find({ clienteId: distribuidor._id, tipo: "conquista" });
    assert.equal(movimentos.reduce((soma, item) => soma + item.quantidade, 0), cupons, "só diferenças");
  });
}

test("valores abaixo de R$ 12 mil acumulam sem liberar benefícios", async () => {
  const { distribuidor } = await contexto();
  await comprar(distribuidor, [6000, 5999.99]);
  const conta = await contaDe(distribuidor);
  assert.equal(conta.cupons.total, 0);
  assert.equal(conta.acumulado.totalCompras, 11999.99);
  await comprar(distribuidor, [0.01]);
  assert.equal((await contaDe(distribuidor)).cupons.total, 100);
});

test("somente após a aprovação: aguardando não libera; separação, faturamento e entrega não repetem", async () => {
  const { distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 20000, { status: "aguardando_aprovacao" });
  await sincronizarPedidoNatal({ pedido, usuario: null, origem: "criacao" });
  assert.equal(await NatalConta.countDocuments(), 0);

  await mudarStatus(pedido);
  assert.equal((await contaDe(distribuidor)).cupons.total, 200);
  for (const status of ["separando", "separado", "faturado", "enviado", "entregue"]) await mudarStatus(pedido, status);
  const conta = await contaDe(distribuidor);
  assert.equal(conta.cupons.total, 200);
  assert.equal(await NatalMovimentoCupom.countDocuments({ clienteId: distribuidor._id }), 1);
  assert.equal((await bonificacao(distribuidor, 1, "produtos")).valorConcedido, 1400);
});
test("aprovação pelo controlador real dispara o cálculo cumulativo", async () => {
  const { admin, distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 12000, { status: "aguardando_aprovacao" });
  const res = response();
  await aprovarPedidoAdmin({ usuario: admin, params: { id: String(pedido._id) } }, res);
  assert.equal(res.statusCode, 200, res.body?.message);
  assert.equal((await contaDe(distribuidor)).cupons.total, 100);
});// ---------- 8 e 9: bonificações ----------

test("8. bonificação retroativa desconta os valores já concedidos no ciclo", async () => {
  const { distribuidor } = await contexto();
  await comprar(distribuidor, [12000]);
  let doc = await bonificacao(distribuidor, 1, "produtos");
  assert.equal(doc.valorConcedido, 600);
  assert.equal(doc.percentual, 5);

  await comprar(distribuidor, [8000]);
  doc = await bonificacao(distribuidor, 1, "produtos");
  assert.equal(doc.valorDevido, 1400);
  assert.equal(doc.historico.at(-1).valorAnterior, 600);
  assert.equal(doc.historico.at(-1).complemento, 800);

  await comprar(distribuidor, [20000]);
  doc = await bonificacao(distribuidor, 1, "produtos");
  assert.equal(doc.valorDevido, 4000);
  assert.equal(doc.valorConcedido, 4000);
  assert.equal(doc.historico.at(-1).valorAnterior, 1400);
  assert.equal(doc.historico.at(-1).complemento, 2600);
  assert.equal(doc.historico.at(-1).percentual, 10);
  assert.equal(doc.historico.at(-1).valorAcumulado, 40000);
  assert.ok(doc.historico.at(-1).origem.numeroPedido);
  assert.equal(doc.valorEntregue, 0, "calculado não é entregue");
  assert.equal(doc.saldoPendente, 4000);

  // Novo ciclo começa do zero, sem descontar o ciclo anterior.
  await comprar(distribuidor, [12000]);
  assert.equal((await bonificacao(distribuidor, 1, "produtos")).valorConcedido, 4000);
  assert.equal((await bonificacao(distribuidor, 2, "produtos")).valorConcedido, 600);
});

test("9. produtos e marketing são controlados separadamente", async () => {
  const { distribuidor } = await contexto();
  await comprar(distribuidor, [52000]);
  const [produtos1, marketing1, produtos2, marketing2] = await Promise.all([
    bonificacao(distribuidor, 1, "produtos"), bonificacao(distribuidor, 1, "marketing"),
    bonificacao(distribuidor, 2, "produtos"), bonificacao(distribuidor, 2, "marketing"),
  ]);
  assert.equal(produtos1.valorConcedido, 4000);
  assert.equal(marketing1.valorConcedido, 1200);
  assert.equal(produtos2.valorConcedido, 600);
  assert.equal(marketing2.valorConcedido, 360);

  const entrega = await registrarEntregaBonificacao({ id: produtos1._id, valor: 1500, observacao: "Entrega de produtos em dezembro", usuario: await usuario("comercial"), now: AGORA });
  assert.equal(entrega.valorEntregue, 1500);
  assert.equal(entrega.saldoPendente, 2500);
  assert.equal((await bonificacao(distribuidor, 1, "marketing")).valorEntregue, 0);
  await assert.rejects(
    registrarEntregaBonificacao({ id: produtos1._id, valor: 2500.01, observacao: "Acima do saldo pendente", usuario: await usuario("admin") }),
    { code: "entrega_acima_do_saldo" }
  );
  assert.equal(await Pedido.countDocuments({ clienteId: distribuidor._id }), 1, "nenhum pedido criado ou alterado");
});

// ---------- 10 e 11: reprocessamento e reduções ----------

test("10. reprocessar o faturamento, em série ou em paralelo, não duplica nada", async () => {
  const { distribuidor } = await contexto();
  const [pedido] = await comprar(distribuidor, [52000]);
  const atual = await Pedido.findById(pedido._id);
  for (let i = 0; i < 3; i += 1) await sincronizarPedidoNatal({ pedido: atual, usuario: null, origem: "faturamento" });
  await Promise.all([1, 2, 3, 4, 5].map(() => sincronizarPedidoNatal({ pedido: atual, usuario: null, origem: "faturamento" })));
  await reconciliarLotes();
  const conta = await contaDe(distribuidor);
  assert.equal(conta.cupons.total, 500);
  assert.equal(await NatalMovimentoCupom.countDocuments({ clienteId: distribuidor._id }), 1);
  assert.equal((await bonificacao(distribuidor, 1, "produtos")).historico.length, 1);
  assert.equal(await NatalAuditoria.countDocuments({ acao: "cupons_liberados", clienteId: distribuidor._id }), 1);
});

test("11. cancelamento recalcula o acumulado e aguarda decisão, sem retirar benefícios", async () => {
  const { admin, distribuidor } = await contexto();
  const [primeiro, segundo] = await comprar(distribuidor, [12000, 8000]);
  const res = response();
  await atualizarStatusPedido({ usuario: admin, params: { id: String(segundo._id) }, body: { status: "cancelado" } }, res);
  assert.equal(res.statusCode, 200, res.body?.message);

  const conta = await contaDe(distribuidor);
  assert.equal(conta.acumulado.totalCompras, 12000);
  assert.equal(conta.cupons.total, 200);
  assert.equal(conta.revisaoPendente.origem, "cancelamento");
  assert.equal(conta.revisaoPendente.cuponsDevidos, 100);

  const previa = await previaRevisaoPendente({ clienteId: distribuidor._id });
  assert.equal(previa.impactoManter.cupons, 200);
  assert.equal(previa.impactoAdequar.cupons, 100);
  assert.equal(previa.bonificacoes.produtos.concedido, 1400);
  assert.equal(previa.bonificacoes.produtos.devidoDepois, 600);
  assert.ok(primeiro._id);
});

test("exclusão de pedido contabilizado também abre revisão pendente", async () => {
  const { admin, distribuidor } = await contexto();
  const [pedido] = await comprar(distribuidor, [12000]);
  const res = response();
  await excluirPedidoAdmin({ usuario: admin, params: { id: String(pedido._id) } }, res);
  assert.equal(res.statusCode, 200, res.body?.message);
  const conta = await contaDe(distribuidor);
  assert.equal(conta.acumulado.totalCompras, 0);
  assert.equal(conta.revisaoPendente.origem, "exclusao");
});

test("12. manter benefícios exige justificativa, preserva tudo e não reabre a pendência", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const [, segundo] = await comprar(distribuidor, [12000, 8000]);
  const res = response();
  await atualizarStatusPedido({ usuario: admin, params: { id: String(segundo._id) }, body: { status: "cancelado" } }, res);

  await assert.rejects(resolverRevisaoPendente({ clienteId: distribuidor._id, entrada: { decisao: "manter", justificativa: "curta" }, usuario: comercial }), { code: "justificativa_invalida" });
  await assert.rejects(resolverRevisaoPendente({ clienteId: distribuidor._id, entrada: { decisao: "manter", justificativa: JUSTIFICATIVA }, usuario: distribuidor }), { statusCode: 403 });

  await resolverRevisaoPendente({ clienteId: distribuidor._id, entrada: { decisao: "manter", justificativa: JUSTIFICATIVA }, usuario: comercial, now: DENTRO });
  await recalcularConta({ clienteId: distribuidor._id });
  await reconciliarLotes();
  const conta = await contaDe(distribuidor);
  assert.equal(conta.cupons.total, 200);
  assert.equal(conta.revisaoPendente, undefined, "decisão tomada não volta a pedir revisão");
  assert.equal(conta.revisoes.length, 1);
  assert.equal(conta.revisoes[0].justificativa, JUSTIFICATIVA);
  assert.equal(conta.revisoes[0].autor.usuarioTipo, "comercial");
  assert.equal((await bonificacao(distribuidor, 1, "produtos")).valorConcedido, 1400);
  assert.ok(await NatalAuditoria.findOne({ acao: "beneficios_revisados", clienteId: distribuidor._id }));
});

test("13. adequar reduz cupons e bonificações, invalida os excedentes e nunca reutiliza números", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const [pedido] = await comprar(distribuidor, [12000]);
  const conta = await contaDe(distribuidor);
  await ajustarCuponsConta({ clienteId: distribuidor._id, quantidade: -97, motivo: "Saldo reduzido para o cenário", usuario: comercial });
  const participacoes = [];
  for (let i = 0; i < 3; i += 1) participacoes.push(await cadastrar(conta.codigoPublico));
  const numeros = [];
  for (const item of participacoes) numeros.push((await aprovarParticipacao({ id: item._id, usuario: comercial, now: DENTRO })).cupom.numero);

  const res = response();
  await atualizarStatusPedido({ usuario: admin, params: { id: String(pedido._id) }, body: { status: "cancelado" } }, res);
  assert.equal(res.statusCode, 200, res.body?.message);

  await resolverRevisaoPendente({ clienteId: distribuidor._id, entrada: { decisao: "adequar", justificativa: JUSTIFICATIVA }, usuario: comercial, now: DENTRO });
  const final = await contaDe(distribuidor);
  assert.equal(final.cupons.reduzidos, 100);
  assert.equal(final.cupons.ajustes, -97, "ajuste manual é preservado");
  assert.equal(final.contadores.aprovados, 0);
  assert.equal(final.contadores.invalidadosRevisao, 3);
  assert.equal(await NatalParticipacao.countDocuments({ clienteId: distribuidor._id, status: "invalidado_revisao" }), 3);
  assert.equal(await NatalCupom.countDocuments({ numero: { $in: numeros }, status: "invalidado" }), 3);
  assert.equal(await NatalCupom.countDocuments({ numero: { $in: numeros } }), 3, "números permanecem gravados");
  assert.equal((await bonificacao(distribuidor, 1, "produtos")).valorConcedido, 0);
  assert.equal((await bonificacao(distribuidor, 1, "marketing")).valorConcedido, 0);
  assert.equal((await listarCuponsValidosParaSorteio()).length, 0);
  assert.ok(await NatalMovimentoCupom.findOne({ clienteId: distribuidor._id, tipo: "revisao_adequacao", quantidade: -100 }));
  await assert.rejects(cadastrar(conta.codigoPublico), { code: "sem_beneficios" });
});
test("adequar depois de bonificação entregue sinaliza o ajuste sem desfazer a entrega", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const [pedido] = await comprar(distribuidor, [12000]);
  const doc = await bonificacao(distribuidor, 1, "produtos");
  await registrarEntregaBonificacao({ id: doc._id, valor: 600, observacao: "Produtos entregues ao distribuidor", usuario: comercial });
  const res = response();
  await atualizarStatusPedido({ usuario: admin, params: { id: String(pedido._id) }, body: { status: "cancelado" } }, res);
  await resolverRevisaoPendente({ clienteId: distribuidor._id, entrada: { decisao: "adequar", justificativa: JUSTIFICATIVA }, usuario: comercial, now: DENTRO });
  const conta = await contaDe(distribuidor);
  assert.equal(conta.revisoes[0].ajusteBonificacaoPendente, true);
  const final = await bonificacao(distribuidor, 1, "produtos");
  assert.equal(final.valorEntregue, 600);
  assert.equal(final.valorConcedido, 0);
  assert.equal(final.saldoPendente, -600);
});

// ---------- 14 e 15: compra externa e ajuste manual ----------

test("14. compra externa só soma depois de validada e participa dos mesmos cálculos", async () => {
  const { comercial, admin, distribuidor } = await contexto();
  const compra = await registrarCompraExterna({ clienteId: distribuidor._id, dados: DADOS_EXTERNA, arquivo: null, usuario: comercial, now: AGORA });
  assert.equal(compra.status, "pendente");
  assert.equal(compra.registradoPor.usuarioTipo, "comercial");
  assert.equal(await NatalConta.countDocuments(), 0, "pendente não conta");

  const { conta, cuponsLiberados } = await validarCompraExterna({ id: compra._id, usuario: admin, now: AGORA });
  assert.equal(cuponsLiberados, 100);
  assert.equal(conta.cupons.total, 100);
  assert.equal(conta.acumulado.totalCompras, 12000);
  assert.ok(conta.codigoPublico, "distribuidor novo recebe link próprio");
  assert.equal(await Pedido.countDocuments({ clienteId: distribuidor._id }), 0, "nenhum pedido fictício");

  await comprar(distribuidor, [8000]);
  assert.equal((await contaDe(distribuidor)).cupons.total, 200);
  const doc = await bonificacao(distribuidor, 1, "produtos");
  assert.equal(doc.valorDevido, 1400);

  await assert.rejects(validarCompraExterna({ id: compra._id, usuario: admin }), { code: "status_invalido" });
  await assert.rejects(
    registrarCompraExterna({ clienteId: distribuidor._id, dados: { ...DADOS_EXTERNA, referencia: "nf12345" }, arquivo: null, usuario: comercial, now: AGORA }),
    { code: "referencia_duplicada" }
  );
  assert.equal(await NatalCompraExterna.countDocuments(), 1);
});

test("14b. compra externa rejeitada não conta e cancelada pede revisão", async () => {
  const { comercial, distribuidor } = await contexto();
  const rejeitada = await registrarCompraExterna({ clienteId: distribuidor._id, dados: { ...DADOS_EXTERNA, referencia: "NF 1" }, arquivo: null, usuario: comercial, now: AGORA });
  await rejeitarCompraExterna({ id: rejeitada._id, motivo: "Nota inválida", usuario: comercial, now: AGORA });
  assert.equal((await contaDe(distribuidor)).acumulado.totalCompras, 0);

  const validada = await registrarCompraExterna({ clienteId: distribuidor._id, dados: { ...DADOS_EXTERNA, referencia: "NF 1" }, arquivo: null, usuario: comercial, now: AGORA });
  await validarCompraExterna({ id: validada._id, usuario: comercial, now: AGORA });
  await cancelarCompraExterna({ id: validada._id, motivo: "Nota cancelada", usuario: comercial, now: AGORA });
  const conta = await contaDe(distribuidor);
  assert.equal(conta.acumulado.totalCompras, 0);
  assert.equal(conta.cupons.total, 100);
  assert.equal(conta.revisaoPendente.origem, "compra_externa");
});

test("compra externa valida permissão, data e valor", async () => {
  const { comercial, distribuidor } = await contexto();
  await assert.rejects(registrarCompraExterna({ clienteId: distribuidor._id, dados: DADOS_EXTERNA, arquivo: null, usuario: distribuidor, now: AGORA }), { statusCode: 403 });
  await assert.rejects(registrarCompraExterna({ clienteId: distribuidor._id, dados: { ...DADOS_EXTERNA, data: "2026-10-01" }, arquivo: null, usuario: comercial, now: AGORA }), { code: "dados_invalidos" });
  await assert.rejects(registrarCompraExterna({ clienteId: distribuidor._id, dados: { ...DADOS_EXTERNA, valor: "0" }, arquivo: null, usuario: comercial, now: AGORA }), { code: "dados_invalidos" });
  await assert.rejects(registrarCompraExterna({ clienteId: comercial._id, dados: DADOS_EXTERNA, arquivo: null, usuario: comercial, now: AGORA }), { statusCode: 404 });
});

test("15. ajuste manual fica separado, exige motivo e sobrevive a recálculos sem duplicar", async () => {
  const { comercial, distribuidor } = await contexto();
  await comprar(distribuidor, [12000]);
  await assert.rejects(ajustarCuponsConta({ clienteId: distribuidor._id, quantidade: 10, motivo: "curto", usuario: comercial }), { code: "motivo_invalido" });
  await assert.rejects(ajustarCuponsConta({ clienteId: distribuidor._id, quantidade: 0, motivo: "Motivo suficiente", usuario: comercial }), { code: "quantidade_invalida" });
  await assert.rejects(ajustarCuponsConta({ clienteId: distribuidor._id, quantidade: 10, motivo: "Motivo suficiente", usuario: distribuidor }), { statusCode: 403 });

  const chave = "ajuste-teste-0001";
  const argumentos = { clienteId: distribuidor._id, quantidade: 50, motivo: "Bônus aprovado pela diretoria", chave, usuario: comercial, now: AGORA };
  await ajustarCuponsConta(argumentos);
  const repetido = await ajustarCuponsConta(argumentos);
  assert.equal(repetido.repetido, true);

  await recalcularConta({ clienteId: distribuidor._id });
  await comprar(distribuidor, [8000]);
  await recalcularConta({ clienteId: distribuidor._id });
  const conta = await contaDe(distribuidor);
  assert.equal(conta.cupons.ajustes, 50);
  assert.equal(conta.cupons.conquistados, 200);
  assert.equal(conta.cupons.total, 250);
  const movimento = await NatalMovimentoCupom.findOne({ clienteId: distribuidor._id, tipo: "ajuste_manual" });
  assert.equal(movimento.motivo, "Bônus aprovado pela diretoria");
  assert.equal(movimento.autor.usuarioTipo, "comercial");
  assert.equal(await NatalMovimentoCupom.countDocuments({ tipo: "ajuste_manual" }), 1);
  assert.ok(await NatalAuditoria.findOne({ acao: "cupons_ajustados", clienteId: distribuidor._id }));
});

test("retirada manual não deixa o saldo abaixo dos cupons em uso", async () => {
  const { comercial, distribuidor } = await contexto();
  await comprar(distribuidor, [12000]);
  const conta = await contaDe(distribuidor);
  await ajustarCuponsConta({ clienteId: distribuidor._id, quantidade: -98, motivo: "Correção de lançamento", usuario: comercial });
  const [p1, p2] = [await cadastrar(conta.codigoPublico), await cadastrar(conta.codigoPublico)];
  await aprovarParticipacao({ id: p1._id, usuario: comercial, now: DENTRO });
  await aprovarParticipacao({ id: p2._id, usuario: comercial, now: DENTRO });
  await assert.rejects(ajustarCuponsConta({ clienteId: distribuidor._id, quantidade: -1, motivo: "Tentativa de retirar demais", usuario: comercial }), { code: "ajuste_excede_saldo" });
  const atual = await contaDe(distribuidor);
  assert.equal(atual.cupons.total, 2);
});

// ---------- 16 a 20: links, preservação e migração ----------

test("16. dois links antigos do mesmo distribuidor compartilham um único saldo", async () => {
  const { comercial, distribuidor } = await contexto();
  const pedidoA = await criarPedido(distribuidor, 100);
  const pedidoB = await criarPedido(distribuidor, 100);
  const loteA = await criarLoteLegado(distribuidor, pedidoA, 1);
  const loteB = await criarLoteLegado(distribuidor, pedidoB, 1);
  await garantirConta({ clienteId: distribuidor._id });

  const publicoA = await obterLotePublico(loteA.codigoPublico, { now: DENTRO });
  const publicoB = await obterLotePublico(loteB.codigoPublico, { now: DENTRO });
  assert.equal(publicoA.distribuidorNome, distribuidor.nomeFantasia);
  assert.equal(publicoA.aceitandoCadastros, true);
  assert.equal(publicoB.aceitandoCadastros, true);
  assert.equal(await NatalConta.countDocuments(), 1, "sem duplicar saldo");
  assert.equal((await contaDe(distribuidor)).cupons.total, 2);

  const primeira = await cadastrar(loteA.codigoPublico);
  const segunda = await cadastrar(loteB.codigoPublico);
  // Reserva estrita: com as 2 vagas reservadas, o terceiro envio é recusado em qualquer link.
  await assert.rejects(cadastrar(loteB.codigoPublico), { code: "fila_cheia" });
  await aprovarParticipacao({ id: primeira._id, usuario: comercial, now: DENTRO });
  await aprovarParticipacao({ id: segunda._id, usuario: comercial, now: DENTRO });

  assert.equal((await obterLotePublico(loteA.codigoPublico, { now: DENTRO })).motivo, "esgotado");
  assert.equal((await contaDe(distribuidor)).contadores.aprovados, 2);
  assert.equal((await NatalLote.findById(loteA._id)).contadores.aprovados, 1);
  assert.equal((await NatalLote.findById(loteB._id)).contadores.aprovados, 1);
  assert.equal((await NatalLote.findById(loteA._id)).codigoPublico, loteA.codigoPublico);
  assert.equal(String((await NatalParticipacao.findById(segunda._id)).loteId), String(loteB._id), "cadastro mantém o link de origem");
});

test("link antigo segue válido com o pedido de origem cancelado", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 12000);
  const lote = await criarLoteLegado(distribuidor, pedido, 100);
  await garantirConta({ clienteId: distribuidor._id });
  await comprar(distribuidor, [12000]);
  const res = response();
  await atualizarStatusPedido({ usuario: admin, params: { id: String(pedido._id) }, body: { status: "cancelado" } }, res);
  assert.equal(res.statusCode, 200, res.body?.message);
  const publico = await obterLotePublico(lote.codigoPublico, { now: DENTRO });
  assert.equal(publico.aceitandoCadastros, true);
  const participacao = await cadastrar(lote.codigoPublico);
  const aprovada = await aprovarParticipacao({ id: participacao._id, usuario: comercial, now: DENTRO });
  assert.equal(aprovada.status, "aprovado");
});

test("link próprio é único por distribuidor, sobrevive ao cancelamento e usa o saldo da conta", async () => {
  const { admin, comercial, distribuidor } = await contexto();
  const [primeiro] = await comprar(distribuidor, [12000]);
  await comprar(distribuidor, [8000]);
  const conta = await contaDe(distribuidor);
  assert.equal(await NatalLote.countDocuments(), 0);
  const res = response();
  await atualizarStatusPedido({ usuario: admin, params: { id: String(primeiro._id) }, body: { status: "cancelado" } }, res);
  assert.equal((await contaDe(distribuidor)).codigoPublico, conta.codigoPublico);
  const participacao = await cadastrar(conta.codigoPublico);
  await aprovarParticipacao({ id: participacao._id, usuario: comercial, now: DENTRO });
  const [linha] = await listarCuponsValidosParaSorteio();
  assert.equal(linha.distribuidor, distribuidor.nomeFantasia);
  assert.equal(linha.pedido, "");
  const outro = await usuario("cliente");
  await comprar(outro, [12000]);
  assert.notEqual((await contaDe(outro)).codigoPublico, conta.codigoPublico);
});

// Cenário com dados no formato antigo: lotes, cadastros e cupons em todos os estados.
const semearLegado = async ({ comercial, distribuidor }) => {
  const pedido = await criarPedido(distribuidor, 20000);
  const lote = await criarLoteLegado(distribuidor, pedido, 200);
  const conta = await garantirConta({ clienteId: distribuidor._id });
  const aprovada = await cadastrar(lote.codigoPublico);
  const pendente = await cadastrar(lote.codigoPublico);
  const cancelada = await cadastrar(lote.codigoPublico);
  await aprovarParticipacao({ id: aprovada._id, usuario: comercial, now: DENTRO });
  await aprovarParticipacao({ id: cancelada._id, usuario: comercial, now: DENTRO });
  await cancelarParticipacao({ id: cancelada._id, usuario: comercial, motivo: "Venda desfeita" });
  // Volta ao estado anterior à migração: somente os registros antigos existem.
  await NatalConta.deleteMany({});
  await NatalMovimentoCupom.deleteMany({});
  await voltarAoLegado();
  assert.ok(conta);
  return { pedido, lote, aprovada, pendente, cancelada };
};

test("17 e 18. migração preserva números de cupons e cadastros aprovados, pendentes e cancelados", async () => {
  const ctx = await contexto();
  const { lote, aprovada, pendente, cancelada } = await semearLegado(ctx);
  const antes = await fotografarDadosOriginais();
  const numeroAprovado = (await NatalParticipacao.findById(aprovada._id)).cupom.numero;
  const numeroCancelado = (await NatalParticipacao.findById(cancelada._id)).cupom.numero;

  await ativarModelo();
  assert.equal(await fotografarDadosOriginais(), antes, "registros antigos idênticos");

  const conta = await contaDe(ctx.distribuidor);
  assert.equal(conta.cupons.legado, 200);
  assert.equal(conta.cupons.total, 200);
  assert.equal(conta.contadores.aprovados, 1);
  assert.equal(conta.contadores.pendentes, 1);
  assert.equal(conta.contadores.cancelados, 1);
  assert.equal(conta.codigoPublico, undefined, "quem já tem link não recebe outro");
  assert.equal((await NatalParticipacao.findById(aprovada._id)).cupom.numero, numeroAprovado);
  assert.equal((await NatalCupom.findOne({ numero: numeroCancelado })).status, "cancelado");
  assert.equal((await NatalParticipacao.findById(pendente._id)).status, "pendente");
  assert.equal((await NatalLote.findById(lote._id)).codigoPublico, lote.codigoPublico);

  // Pendente aprovado depois da migração consome o saldo compartilhado.
  const aprovadaDepois = await aprovarParticipacao({ id: pendente._id, usuario: ctx.comercial, now: DENTRO });
  assert.equal(aprovadaDepois.status, "aprovado");
  assert.equal((await contaDe(ctx.distribuidor)).contadores.aprovados, 2);
});

test("migração libera somente a diferença: 200 concedidos e direito a 300 geram 100", async () => {
  const { distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 20000, { status: "faturado" });
  await criarPedido(distribuidor, 10000, { status: "faturado" });
  await criarLoteLegado(distribuidor, pedido, 200);
  await voltarAoLegado();
  const relatorio = await analisarMigracao();
  assert.equal(relatorio.distribuidores[0].depois.cuponsLiberadosNaMigracao, 100);
  await ativarModelo();
  const conta = await contaDe(distribuidor);
  assert.equal(conta.cupons.legado, 200);
  assert.equal(conta.cupons.conquistados, 100);
  assert.equal(conta.cupons.total, 300);
});

test("19. migração executada duas vezes não duplica nada", async () => {
  const ctx = await contexto();
  await semearLegado(ctx);
  await executarMigracao({ operador: "Teste", now: DENTRO });
  const contaPrimeira = await contaDe(ctx.distribuidor);
  const movimentos = await NatalMovimentoCupom.countDocuments();
  const segunda = await executarMigracao({ operador: "Teste", now: DENTRO });
  const contaSegunda = await contaDe(ctx.distribuidor);
  assert.equal(segunda.movimentosCriados, 0);
  assert.equal(await NatalMovimentoCupom.countDocuments(), movimentos);
  assert.equal(await NatalConta.countDocuments(), 1);
  assert.deepEqual(contaSegunda.cupons.toObject(), contaPrimeira.cupons.toObject());
  assert.deepEqual(contaSegunda.contadores.toObject(), contaPrimeira.contadores.toObject());
});

test("simulação da migração não grava nada e relata divergências", async () => {
  const { distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 15000);
  await criarLoteLegado(distribuidor, pedido, 400);
  const relatorio = await analisarMigracao();
  assert.equal(await NatalConta.countDocuments(), 0);
  assert.equal(await NatalMovimentoCupom.countDocuments(), 0);
  assert.equal(relatorio.totais.links, 1);
  const codigos = relatorio.divergencias.map((item) => item.codigo);
  assert.ok(codigos.includes("legado_acima_do_calculo"));
  assert.ok(codigos.includes("cupons_fora_da_faixa"));
  assert.ok(!JSON.stringify(relatorio).includes((await NatalLote.findOne()).codigoPublico), "relatório não expõe o link completo");
});

test("divergência da migração não invalida nada nem cria pendência", async () => {
  const { distribuidor } = await contexto();
  const pedido = await criarPedido(distribuidor, 15000);
  await criarLoteLegado(distribuidor, pedido, 400);
  await voltarAoLegado();
  await ativarModelo();
  await recalcularConta({ clienteId: distribuidor._id });
  const conta = await contaDe(distribuidor);
  assert.equal(conta.cupons.total, 400);
  assert.equal(conta.revisaoPendente, undefined);
  // Faturamento não muda nada: o direito de 100 já está coberto pelos 400 antigos.
  await mudarStatus(pedido, "faturado");
  assert.equal((await contaDe(distribuidor)).cupons.total, 400);
});

test("20. pedido fictício da Support Pet segue intacto e a troca por compra externa não duplica", async () => {
  const ctx = await contexto();
  const pedido = await criarPedido(ctx.distribuidor, 12000, {
    numeroPedido: "AP-05112026-0001",
    itens: [{ produtoId: new mongoose.Types.ObjectId(), nomeProduto: "cupom campanha", quantidade: 12000, valorUnitario: 1, subtotal: 12000 }],
  });
  const lote = await criarLoteLegado(ctx.distribuidor, pedido, 100);
  const pedidoAntes = JSON.stringify(await Pedido.findById(pedido._id).lean());
  const loteAntes = JSON.stringify(await NatalLote.findById(lote._id).lean());

  await voltarAoLegado();
  const relatorio = await analisarMigracao();
  assert.ok(relatorio.divergencias.some((item) => item.codigo === "pedido_simbolico"));
  await ativarModelo();
  await executarMigracao({ operador: "Teste", now: DENTRO }).catch((error) => assert.equal(error.code, "modo_invalido"));

  assert.equal(JSON.stringify(await Pedido.findById(pedido._id).lean()), pedidoAntes);
  assert.equal(JSON.stringify(await NatalLote.findById(lote._id).lean()), loteAntes);
  let conta = await contaDe(ctx.distribuidor);
  assert.equal(conta.cupons.total, 100);
  assert.equal(conta.cupons.conquistados, 0, "os 100 antigos não são concedidos de novo");
  assert.equal(conta.acumulado.totalCompras, 12000, "pedido aprovado soma no acumulado");
  assert.equal((await obterLotePublico(lote.codigoPublico, { now: DENTRO })).aceitandoCadastros, true);

  // Regularização futura: cancelar o pedido antes de validar a compra evita somar duas vezes.
  const res = response();
  await atualizarStatusPedido({ usuario: ctx.admin, params: { id: String(pedido._id) }, body: { status: "cancelado" } }, res);
  assert.equal(res.statusCode, 200, res.body?.message);
  assert.ok((await contaDe(ctx.distribuidor)).revisaoPendente);
  const compra = await registrarCompraExterna({ clienteId: ctx.distribuidor._id, dados: DADOS_EXTERNA, arquivo: null, usuario: ctx.comercial, now: AGORA });
  await validarCompraExterna({ id: compra._id, usuario: ctx.comercial, now: AGORA });
  conta = await contaDe(ctx.distribuidor);
  assert.equal(conta.cupons.total, 100);
  assert.equal(conta.acumulado.totalCompras, 12000);
  assert.equal(conta.revisaoPendente, undefined, "pendência se resolve quando o direito volta");
  assert.equal((await obterLotePublico(lote.codigoPublico, { now: DENTRO })).aceitandoCadastros, true);
});
// ---------- Concorrência ----------

test("aprovações simultâneas por links diferentes nunca ultrapassam o saldo do distribuidor", async () => {
  const { comercial, distribuidor } = await contexto();
  const loteA = await criarLoteLegado(distribuidor, await criarPedido(distribuidor, 100), 5);
  const loteB = await criarLoteLegado(distribuidor, await criarPedido(distribuidor, 100), 5);
  await garantirConta({ clienteId: distribuidor._id });
  const participacoes = [];
  for (let i = 0; i < 5; i += 1) participacoes.push(await cadastrar(loteA.codigoPublico));
  for (let i = 0; i < 5; i += 1) participacoes.push(await cadastrar(loteB.codigoPublico));
  // Saldo reduzido depois dos envios (como numa adequação): 10 pendentes para 4 vagas.
  await NatalConta.updateOne({ clienteId: distribuidor._id }, { $set: { "cupons.total": 4 } });

  const tentativas = participacoes.flatMap((item) => [item, item]).map((item) => aprovarParticipacao({ id: item._id, usuario: comercial, now: DENTRO }));
  await Promise.allSettled(tentativas);

  const aprovadas = await NatalParticipacao.countDocuments({ clienteId: distribuidor._id, status: "aprovado" });
  const conta = await contaDe(distribuidor);
  assert.ok(aprovadas <= 4, `aprovadas: ${aprovadas}`);
  assert.equal(conta.contadores.aprovados, aprovadas);
  assert.equal(conta.contadores.pendentes, 10 - aprovadas);
  assert.equal(await NatalCupom.countDocuments({ clienteId: distribuidor._id, status: "valido" }), aprovadas);
});

test("liberações simultâneas de cupons não duplicam a diferença", async () => {
  const { distribuidor } = await contexto();
  const pedidos = await Promise.all([12000, 8000, 20000, 12000].map((valor) => criarPedido(distribuidor, valor, { status: "faturado", dataFaturamento: DENTRO })));
  await Promise.all(pedidos.map((pedido) => sincronizarPedidoNatal({ pedido, usuario: null, origem: "faturamento" })));
  await Promise.all(pedidos.map((pedido) => sincronizarPedidoNatal({ pedido, usuario: null, origem: "faturamento" })));
  const conta = await contaDe(distribuidor);
  assert.equal(conta.acumulado.totalCompras, 52000);
  assert.equal(conta.cupons.total, 500);
  const movimentos = await NatalMovimentoCupom.find({ clienteId: distribuidor._id });
  assert.equal(movimentos.reduce((soma, item) => soma + item.quantidade, 0), 500);
});

test("ajustes e aprovações simultâneos mantêm o saldo coerente", async () => {
  const { comercial, distribuidor } = await contexto();
  await comprar(distribuidor, [12000]);
  const conta = await contaDe(distribuidor);
  const participacoes = [];
  for (let i = 0; i < 5; i += 1) participacoes.push(await cadastrar(conta.codigoPublico));
  // Saldo reduzido depois dos envios: 5 pendentes para 3 vagas.
  await NatalConta.updateOne({ _id: conta._id }, { $inc: { "cupons.total": -97, "cupons.ajustes": -97 } });
  await Promise.allSettled([
    ...participacoes.map((item) => aprovarParticipacao({ id: item._id, usuario: comercial, now: DENTRO })),
    ajustarCuponsConta({ clienteId: distribuidor._id, quantidade: -2, motivo: "Retirada simultânea de saldo", usuario: comercial }),
  ]);
  const final = await contaDe(distribuidor);
  assert.ok(final.contadores.aprovados <= final.cupons.total, "nunca consome além do saldo");
  assert.equal(await NatalParticipacao.countDocuments({ clienteId: distribuidor._id, status: "aprovado" }), final.contadores.aprovados);
});

// ---------- Gestão ----------

test("gestão mostra o consolidado do distribuidor e a origem dos valores", async () => {
  const { comercial, distribuidor } = await contexto();
  await comprar(distribuidor, [30000, 22000]);
  const compra = await registrarCompraExterna({ clienteId: distribuidor._id, dados: { ...DADOS_EXTERNA, valor: 8000 }, arquivo: null, usuario: comercial, now: AGORA });
  await validarCompraExterna({ id: compra._id, usuario: comercial, now: AGORA });

  const [linha] = await listarDistribuidores();
  assert.equal(linha.compras.total, 60000);
  assert.equal(linha.compras.ciclosConcluidos, 1);
  assert.equal(linha.compras.cicloAtual, 2);
  assert.equal(linha.compras.acumuladoCiclo, 20000);
  assert.equal(linha.compras.faixaAtual.cupons, 200);
  assert.equal(linha.compras.proximaFaixa.cupons, 300);
  assert.equal(linha.compras.restanteProximaFaixa, 10000);
  assert.equal(linha.cupons.total, 600);
  assert.equal(linha.cupons.disponiveis, 600);
  assert.equal(linha.bonificacoes.produtos.concedido, 5400);
  assert.equal(linha.bonificacoes.marketing.concedido, 1800);
  assert.equal(linha.bonificacoes.produtos.pendente, 5400);
  assert.equal(linha.links.length, 1);
  assert.equal(linha.links[0].tipo, "distribuidor");

  const detalhe = await detalharDistribuidor({ clienteId: distribuidor._id });
  assert.equal(detalhe.ciclos.length, 2);
  assert.equal(detalhe.comprasParticipantes.length, 3);
  assert.ok(detalhe.comprasParticipantes.some((item) => item.tipo === "compra_externa" && item.referencia === "NF 12345"));
  assert.equal(detalhe.comprasParticipantes.flatMap((item) => item.ciclos).reduce((soma, item) => soma + item.valor, 0), 60000);
  assert.ok(detalhe.movimentos.length >= 1);
  assert.equal(detalhe.comprasExternas.length, 1);

  const publico = await detalharDistribuidor({ clienteId: distribuidor._id, gestor: false });
  assert.equal(publico.movimentos, undefined);
  assert.equal(publico.comprasExternas, undefined);
});
