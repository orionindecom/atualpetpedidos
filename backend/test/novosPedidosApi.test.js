import adminTrainingRouter from '../src/routes/adminTreinamentoRoutes.js';
import materialsRouter from '../src/routes/materialMarketingRoutes.js';
import ProgressoTreinamento from '../src/models/ProgressoTreinamento.js';
import { PERMISSIONS, ROLE_PERMISSIONS, effectivePermissions, hasGlobalScope } from '../src/utils/permissions.js';
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Usuario from "../src/models/Usuario.js";
import Pedido from "../src/models/Pedido.js";
import Produto from "../src/models/Produto.js";
import PrecoProduto from "../src/models/PrecoProduto.js";
import TabelaPreco from "../src/models/TabelaPreco.js";
import OperadorLogistica from "../src/models/OperadorLogistica.js";
import { signOperatorContext } from "../src/utils/operadorLogistica.js";
import carteiraRouter from "../src/routes/carteiraRoutes.js";
import usuarioRouter from "../src/routes/usuarioRoutes.js";
import trainingRouter from "../src/routes/treinamentoRoutes.js";
import Treinamento from "../src/models/Treinamento.js";
import pedidoRouter from "../src/routes/pedidoRoutes.js";
import authRouter from '../src/routes/authRoutes.js';
import produtoRouter from '../src/routes/produtoRoutes.js';
import logisticaRouter from "../src/routes/logisticaRoutes.js";
import { buildOrderAuditTimeline } from "../src/utils/pedidoAuditoria.js";
import { buildOrderOperationsForm, buildOrderOperationsPayload, updateOrderSeparationForm } from "../../frontend/src/utils/orderOperations.js";
import { listarDistribuidoresPedido } from "../src/controllers/pedidoComercialController.js";

const id = (n) => n.toString(16).padStart(24, "0");
const objectId = (n) => new mongoose.Types.ObjectId(id(n));
const query = (value) => ({
  select() { return this; }, lean() { return this; }, sort() { return this; }, populate() { return this; }, maxTimeMS() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});

async function fixture(t) {
  const secret = "segredo-exclusivo-dos-testes-locais-com-32-caracteres";
  const anterior = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  t.after(() => { if (anterior === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = anterior; });
  const usuarios = new Map(["admin", "comercial", "logistica", "cliente", "marketing", "groomer", "vendedor"].map((tipo, i) => [tipo, {
    _id: id(i + 1), tipo, ativo: true, statusCadastro: "aprovado", nomeResponsavel: `Pessoa ${tipo}`, tokenVersion: 0,
    tabelaPrecoId: objectId(50), nomeFantasia: "Distribuidor A",
  }]));
  const clienteB = { ...usuarios.get("cliente"), _id: id(20), tabelaPrecoId: objectId(51), nomeFantasia: "Distribuidor B" };
  usuarios.set("clienteB", clienteB);
  usuarios.get("cliente").vendedorResponsavelId = usuarios.get("vendedor")._id;
  const tabelas = new Map([[id(50), { _id: id(50), nome: "Tabela A", ativa: true }], [id(51), { _id: id(51), nome: "Tabela B", ativa: true }]]);
  const pedidos = [];
  const produto = { _id: objectId(100), nome: "Shampoo", ativo: true };
  let disponivel = true;
  t.mock.method(Usuario, "findById", (target) => query([...usuarios.values()].find((user) => String(user._id) === String(target)) || null));
  t.mock.method(Usuario, "find", (filter = {}) => query([...usuarios.values()].filter((u) => (!filter.tipo || u.tipo === filter.tipo) && (!filter.vendedorResponsavelId || String(u.vendedorResponsavelId) === String(filter.vendedorResponsavelId)))));
  t.mock.method(TabelaPreco, "findById", (target) => query(tabelas.get(String(target))));
  t.mock.method(Produto, "find", (filter) => {
    assert.equal(filter.ativo, true);
    return query(disponivel && filter._id.$in.includes(String(produto._id)) ? [produto] : []);
  });
  t.mock.method(PrecoProduto, "find", ({ tabelaPrecoId }) => query([{ produtoId: produto._id, valor: String(tabelaPrecoId) === id(50) ? 10 : 25 }]));
  t.mock.method(PrecoProduto, "aggregate", (pipeline) => ({ option: async () => {
    const tabelaId = String(pipeline[0].$match.tabelaPrecoId);
    assert.ok(tabelas.has(tabelaId));
    return [{ produtos: [{ id: produto._id, nome: produto.nome, preco: tabelaId === id(50) ? 10 : 25 }], total: [{ quantidade: 1 }] }];
  } }));
  t.mock.method(Pedido, "countDocuments", async () => pedidos.length);
  t.mock.method(Pedido, "create", async (data) => {
    const pedido = new Pedido({ ...data, __v: 0, _id: id(200 + pedidos.length), createdAt: new Date() });
    await pedido.validate();
    pedidos.push(pedido);
    return pedido;
  });
  t.mock.method(Pedido, "find", (filter = {}) => query(pedidos.filter((pedido) => (
    (!filter.clienteId || (filter.clienteId.$in ? filter.clienteId.$in.some((c) => String(c) === String(pedido.clienteId)) : String(pedido.clienteId) === String(filter.clienteId))) &&
    (!filter.status || filter.status.$in.includes(pedido.status))
  )).map((pedido) => pedido.toObject())));
  t.mock.method(Pedido, "findById", (target) => query(pedidos.find((pedido) => String(pedido._id) === String(target)) || null));
  t.mock.method(Pedido, "findOneAndUpdate", (filter, update) => {
    const pedido = pedidos.find((entry) => String(entry._id) === String(filter._id) && entry.status === filter.status);
    if (pedido) {
      Object.assign(pedido, update.$set);
      pedido.historicoStatus ||= [];
      pedido.historicoStatus.push(update.$push.historicoStatus);
    }
    return query(pedido);
  });
  const app = express();
  app.use(express.json());
  app.use("/carteira", carteiraRouter);
  app.use('/auth', authRouter);
  app.use('/produtos', produtoRouter);
  app.use("/usuarios", usuarioRouter);
  app.use("/treinamentos", trainingRouter);
  app.use("/admin/treinamentos", adminTrainingRouter);
  app.use("/materiais-marketing", materialsRouter);
  app.use("/pedidos", pedidoRouter);
  app.use("/logistica", logisticaRouter);
  const server = await new Promise((resolve) => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const request = async (role, path, body, method = body ? "POST" : "GET", headers = {}) => {
    const user = usuarios.get(role);
    const token = user ? jwt.sign({ id: user._id, tipo: user.tipo, tokenVersion: 0 }, secret, { expiresIn: "1h" }) : null;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  const body = (extra = {}) => ({ clienteId: usuarios.get("cliente")._id, itens: [{ produtoId: String(produto._id), quantidade: 3 }], ...extra });
  return { request, body, usuarios, tabelas, pedidos, setDisponivel: (value) => { disponivel = value; } };
}

test("HTTP: Admin/Logística consultam necessidade; demais perfis e sessão ausente são bloqueados", async (t) => {
  const { request } = await fixture(t);
  for (const [role, expected] of [["admin", 200], ["logistica", 200], ["comercial", 403], ["cliente", 403], ["marketing", 403], ["groomer", 403], [null, 401]]) {
    assert.equal((await request(role, "/logistica/necessidade-producao")).status, expected, String(role));
  }
});

test("HTTP: Logística recebe pedido sem valores após edição e separação e não acessa rotas comerciais", async (t) => {
  const { request, body, pedidos, usuarios } = await fixture(t);
  await request("comercial", "/pedidos/comercial", body());
  const pedido = pedidos[0];
  t.mock.method(pedido, "save", async () => {
    await pedido.validate(); pedido.__v = Number(pedido.__v ?? 0) + 1; return pedido;
  });
  const operador = { _id: id(300), nome: "Operador local", ativo: true };
  t.mock.method(OperadorLogistica, "findById", () => query(operador));
  const headers = { "X-Operador-Contexto": signOperatorContext({
    operadorId: operador._id, pedidoId: pedido._id, usuarioId: usuarios.get("logistica")._id,
  }) };
  const path = `/logistica/pedidos/${pedido._id}`;
  assert.equal((await request("admin", `/pedidos/${pedido._id}/aprovar`, {}, "PATCH")).status, 200);
  assert.equal((await request("logistica", path, { versaoPedido: Number(pedido.__v ?? 0), status: "separando" }, "PATCH", headers)).status, 200);
  const edited = await request("admin", `/pedidos/${pedido._id}`, {
    versaoPedido: pedido.__v, itens: [{ produtoId: id(100), quantidade: 5 }],
  }, "PUT");
  assert.equal(edited.status, 200);
  assert.equal(edited.body.pedido.itens[0].quantidadeFaltante, 5);
  assert.equal(edited.body.pedido.valorTotal, 50);
  const read = await request("logistica", path, undefined, "GET", headers);
  assert.equal(read.status, 200);
  assert.equal(read.body.pedido.itens[0].quantidadeFaltante, 5);
  const changed = await request("logistica", path, {
    versaoPedido: pedido.__v, separacaoItens: [{ produtoId: id(100), quantidadeSeparada: 5 }],
  }, "PATCH", headers);
  assert.equal(changed.status, 200);
  assert.equal(changed.body.pedido.itens[0].quantidadeFaltante, 0);
  assert.equal(changed.body.pedido.itens[0].quantidadeFaltanteSeparacao, 0);
  for (const result of [read, changed]) {
    assert.doesNotMatch(JSON.stringify(result.body), /valorUnitario|subtotal|valorTotal|totalAnterior|totalNovo|tabelaPrecoId|nomeTabela|R\$/);
    assert.ok(result.body.pedido.historicoPedido.some((entry) => entry.detalhes?.includes("3 -> 5")));
  }
  for (const commercialPath of ["/pedidos", "/pedidos/meus", `/pedidos/${pedido._id}`, `/pedidos/${pedido._id}/pdf`, `/pedidos/${pedido._id}/relatorio`, `/pedidos/${pedido._id}/aprovacao`]) {
    assert.equal((await request("logistica", commercialPath)).status, 403, commercialPath);
  }
});

for (const actor of ["admin", "comercial"]) {
  test(`HTTP: inclusão por ${actor} inicializa 10/0/10 e preserva itens separados e permissões`, async (t) => {
    const { request, body, pedidos, usuarios } = await fixture(t);
    const created = await request("comercial", "/pedidos/comercial", body({ itens: [{
      produtoId: id(100), quantidade: 3, quantidadeSeparada: 3, quantidadeFaltante: 0,
    }] }));
    assert.equal(created.status, 201);
    const pedido = pedidos[0];
    assert.equal(pedido.itens[0].quantidadeSeparada, 0);
    assert.equal(pedido.itens[0].situacaoSeparacao, "pendente");
    t.mock.method(pedido, "save", async () => {
      await pedido.validate(); pedido.__v = Number(pedido.__v ?? 0) + 1; return pedido;
    });
    const operador = { _id: id(300), nome: "Operador local", ativo: true };
    t.mock.method(OperadorLogistica, "findById", () => query(operador));
    const headers = { "X-Operador-Contexto": signOperatorContext({
      operadorId: operador._id, pedidoId: pedido._id, usuarioId: usuarios.get("logistica")._id,
    }) };
    const operationPath = `/logistica/pedidos/${pedido._id}`;
    const patch = (data) => request("logistica", operationPath, { versaoPedido: pedido.__v ?? 0, ...data }, "PATCH", headers);
    assert.equal((await request("admin", `/pedidos/${pedido._id}/aprovar`, {}, "PATCH")).status, 200);
    assert.equal((await patch({ status: "separando" })).status, 200);
    assert.equal((await patch({ separacaoItens: [{ produtoId: id(100), quantidadeSeparada: 3 }] })).status, 200);
    const separated = await patch({ status: "separado" });
    assert.equal(separated.status, 200, separated.body.message);

    const produtos = [{ _id: objectId(100), nome: "Shampoo", ativo: true }, { _id: objectId(101), nome: "Condicionador", ativo: true }];
    t.mock.method(Produto, "find", (filter) => query(produtos.filter((product) => filter._id.$in.includes(String(product._id)))));
    t.mock.method(PrecoProduto, "find", () => query(produtos.map((product) => ({ produtoId: product._id, valor: 10 }))));
    const edit = await request(actor, `/pedidos/${pedido._id}`, {
      versaoPedido: pedido.__v, itens: [
        { produtoId: id(100), quantidade: 3 },
        { produtoId: id(101), quantidade: 10, quantidadeSeparada: 10, quantidadeFaltante: 0 },
      ],
    }, "PUT");
    assert.equal(edit.status, 200);
    assert.equal(edit.body.pedido.status, "separando");
    assert.equal(edit.body.pedido.valorTotal, 130);
    assert.equal(edit.body.pedido.itens[0].quantidadeSeparada, 3);
    assert.equal(edit.body.pedido.itens[0].quantidadeFaltante, 0);
    const added = edit.body.pedido.itens[1];
    assert.equal(added.quantidadeSeparada, 0);
    assert.equal(added.quantidadeFaltante, 10);
    assert.equal(added.quantidadeFaltanteSeparacao, 10);
    assert.equal(added.situacaoSeparacao, "pendente");
    assert.equal(pedido.itens[1].quantidadeSeparada, 0);

    const read = await request("logistica", operationPath, undefined, "GET", headers);
    assert.equal(read.status, 200);
    assert.equal(read.body.pedido.itens[1].quantidadeFaltante, 10);
    assert.doesNotMatch(JSON.stringify(read.body), /valorUnitario|subtotal|valorTotal|totalAnterior|totalNovo|tabelaPrecoId|R\$/);
    const untouched = buildOrderOperationsForm(read.body.pedido);
    assert.equal((await patch(buildOrderOperationsPayload(read.body.pedido, untouched))).status, 200);
    assert.equal(pedido.itens[1].situacaoSeparacao, "pendente");
    assert.equal((await request("logistica", "/logistica/necessidade-producao")).body.resumo.quantidadeFaltante, 10);

    for (const [separado, faltante] of [["0", 10], ["3", 7], ["10", 0]]) {
      const current = (await request("logistica", operationPath, undefined, "GET", headers)).body.pedido;
      const form = updateOrderSeparationForm(buildOrderOperationsForm(current), id(101), separado);
      const saved = await patch(buildOrderOperationsPayload(current, form));
      assert.equal(saved.status, 200);
      assert.equal(saved.body.pedido.itens[1].quantidadeSeparada, Number(separado));
      assert.equal(saved.body.pedido.itens[1].quantidadeFaltante, faltante);
      assert.equal(saved.body.pedido.itens[1].quantidadeFaltanteSeparacao, faltante);
      assert.equal(saved.body.pedido.itens[0].quantidadeSeparada, 3);
      assert.doesNotMatch(JSON.stringify(saved.body), /valorUnitario|subtotal|valorTotal|totalAnterior|totalNovo|tabelaPrecoId|R\$/);
      assert.equal((await request("logistica", "/logistica/necessidade-producao")).body.resumo.quantidadeFaltante, faltante);
    }
    const commercial = await request(actor, `/pedidos/${pedido._id}/aprovacao`);
    assert.equal(commercial.body.valorTotal, 130);
    assert.equal(commercial.body.itens[1].valorUnitario, 10);
  });
}

test("HTTP: endpoints comerciais exigem o Comercial sem ampliar cadastro administrativo ou criação do cliente", async (t) => {
  const { request, body } = await fixture(t);
  for (const role of ["logistica", "cliente", "marketing", "groomer", null]) {
    const expected = role ? 403 : 401;
    for (const path of ["/pedidos/comercial/distribuidores", `/pedidos/comercial/distribuidores/${id(4)}/catalogo`]) assert.equal((await request(role, path)).status, expected);
    assert.equal((await request(role, "/pedidos/comercial", body())).status, expected);
  }
  assert.equal((await request("comercial", "/pedidos", body())).status, 403);
});

test("HTTP: diferentes distribuidores usam seus próprios preços; origem/autoria/status não podem ser forjados", async (t) => {
  const { request, body, pedidos, usuarios } = await fixture(t);
  for (const [clienteId, expectedTotal] of [[id(4), 30], [id(20), 75]]) {
    const catalog = await request("comercial", `/pedidos/comercial/distribuidores/${clienteId}/catalogo?pagina=1&limite=12`);
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.produtos[0].preco, expectedTotal / 3);
    const result = await request("comercial", "/pedidos/comercial", body({ clienteId, origem: "cliente", criadoPor: { usuarioId: id(1) }, status: "aprovado", valorTotal: 0 }));
    assert.equal(result.status, 201);
    const salvo = pedidos.at(-1);
    assert.equal(String(salvo.clienteId), clienteId);
    assert.equal(salvo.valorTotal, expectedTotal);
    assert.equal(salvo.origem, "comercial");
    assert.equal(String(salvo.criadoPor.usuarioId), usuarios.get("comercial")._id);
    assert.equal(salvo.criadoPor.usuarioNome, "Pessoa comercial");
    assert.equal(salvo.status, "aguardando_aprovacao");
    assert.equal(salvo.conferenciaObrigatoria, true);
    assert.equal(salvo.fechamentoLogisticoObrigatorio, true);
    assert.equal(result.body.pedido.criadoPor, undefined);
    const detalhe = await request("comercial", `/pedidos/${salvo._id}/aprovacao`);
    assert.equal(detalhe.body.criadoPor.usuarioNome, "Pessoa comercial");
    assert.equal(detalhe.body.historicoPedido[0].responsavelPerfil, "comercial");
    assert.equal(detalhe.body.historicoPedido[0].responsavelId, id(2));
  }
  const meus = await request("cliente", "/pedidos/meus");
  assert.equal(meus.body.length, 1);
  assert.equal(meus.body[0].origem, "comercial");
  assert.equal((await request("clienteB", `/pedidos/${pedidos[0]._id}`)).status, 403);
});

test("HTTP: cliente continua dono e origem Cliente, mesmo enviando distribuidor/autoria falsos", async (t) => {
  const { request, body, pedidos } = await fixture(t);
  const result = await request("cliente", "/pedidos", body({ clienteId: id(20), origem: "comercial", criadoPor: { usuarioId: id(2) } }));
  assert.equal(result.status, 201);
  assert.equal(String(pedidos[0].clienteId), id(4));
  assert.equal(pedidos[0].valorTotal, 30);
  assert.equal(pedidos[0].origem, "cliente");
  assert.equal(pedidos[0].criadoPor.usuarioTipo, "cliente");
  assert.equal(String(pedidos[0].criadoPor.usuarioId), id(4));
  const legado = pedidos[0].toObject();
  delete legado.origem;
  assert.equal(buildOrderAuditTimeline(legado)[0].responsavelPerfil, "cliente");
});

test("HTTP: preço e nome vêm do cadastro; preço zero é válido e item sem preço impede pedido parcial", async (t) => {
  const { request, body, pedidos } = await fixture(t);
  const itens = [{ produtoId: id(100), quantidade: 2, nomeProduto: "Nome forjado", valorUnitario: 1, subtotal: 2 }];
  const result = await request("comercial", "/pedidos/comercial", body({ itens }));
  assert.equal(result.status, 201);
  assert.equal(pedidos[0].itens[0].valorUnitario, 10);
  assert.equal(pedidos[0].itens[0].nomeProduto, "Shampoo");
  let preco = 0;
  t.mock.method(PrecoProduto, "find", () => query(preco === null ? [] : [{ produtoId: objectId(100), valor: preco }]));
  assert.equal((await request("comercial", "/pedidos/comercial", body())).status, 201);
  assert.equal(pedidos.at(-1).valorTotal, 0);
  preco = null;
  assert.equal((await request("comercial", "/pedidos/comercial", body())).status, 400);
  assert.equal(pedidos.length, 2);
});

test("schema exige responsável comercial e mantém identidade de criação imutável", async (t) => {
  const { request, body, pedidos } = await fixture(t);
  await request("comercial", "/pedidos/comercial", body());
  const invalid = new Pedido({ ...pedidos[0].toObject(), criadoPor: undefined });
  await assert.rejects(invalid.validate(), /criadoPor/);
  const saved = pedidos[0];
  saved.isNew = false;
  saved.origem = "cliente";
  saved.criadoPor = { usuarioId: id(1), usuarioNome: "Pessoa diferente", usuarioTipo: "comercial" };
  assert.equal(saved.origem, "comercial");
  assert.equal(String(saved.criadoPor.usuarioId), id(2));
});

test("HTTP: valida elegibilidade, tabela vigente, produtos e quantidades antes de persistir", async (t) => {
  const { request, body, pedidos, usuarios, tabelas, setDisponivel } = await fixture(t);
  const cliente = usuarios.get("cliente");
  for (const [field, value] of [["ativo", false], ["statusCadastro", "pendente"], ["statusCadastro", "reprovado"], ["statusCadastro", "inativo"], ["tabelaPrecoId", null]]) {
    const old = cliente[field]; cliente[field] = value;
    assert.equal((await request("comercial", "/pedidos/comercial", body())).status, 400);
    assert.equal((await request("comercial", `/pedidos/comercial/distribuidores/${id(4)}/catalogo`)).status, 400);
    cliente[field] = old;
  }
  tabelas.get(id(50)).ativa = false;
  assert.equal((await request("comercial", "/pedidos/comercial", body())).status, 400);
  tabelas.get(id(50)).ativa = true;
  for (const clienteId of [id(1), id(6), id(999), "malformado"]) assert.ok([400, 404].includes((await request("comercial", "/pedidos/comercial", body({ clienteId }))).status));
  assert.equal((await request("comercial", "/pedidos/comercial", body({ tabelaPrecoId: id(51) }))).status, 409);
  for (const itens of [[], [{ produtoId: id(100), quantidade: 0 }], [{ produtoId: id(100), quantidade: 0.5 }], [{ produtoId: id(100), quantidade: 1000000 }], [{ produtoId: id(100), quantidade: 1 }, { produtoId: id(101), quantidade: 1 }], [body().itens[0], body().itens[0]]]) {
    assert.equal((await request("comercial", "/pedidos/comercial", body({ itens }))).status, 400);
  }
  setDisponivel(false);
  assert.equal((await request("comercial", "/pedidos/comercial", body())).status, 400);
  assert.equal(pedidos.length, 0);
});

test("HTTP: entrar em separação gera demanda imediatamente e cada alteração recalcula o faltante", async (t) => {
  const { request, body, pedidos } = await fixture(t);
  await request("comercial", "/pedidos/comercial", body());
  assert.equal((await request("logistica", "/logistica/necessidade-producao")).body.resumo.quantidadeFaltante, 0);
  const pedido = pedidos[0];
  t.mock.method(pedido, "save", async () => {
    await pedido.validate(); pedido.__v = Number(pedido.__v || 0) + 1; return pedido;
  });
  const approval = await request("comercial", `/pedidos/${pedido._id}/aprovar`, {}, "PATCH");
  assert.equal(approval.status, 200);
  assert.equal((await request("logistica", "/logistica/necessidade-producao")).body.resumo.quantidadeFaltante, 0);
  const atualizar = (data) => request("admin", `/logistica/pedidos/${pedido._id}`, { versaoPedido: Number(pedido.__v || 0), ...data }, "PATCH");
  assert.equal((await atualizar({ separacaoItens: [{ produtoId: id(100), quantidadeSeparada: 0 }] })).status, 409);
  assert.equal((await atualizar({ status: "separando" })).status, 200);
  const inicio = pedido.historicoStatus.find((evento) => evento.novoStatus === "separando");
  assert.ok(inicio.alteradoEm instanceof Date);
  assert.equal(String(inicio.usuarioId), id(1));
  assert.ok(buildOrderAuditTimeline(pedido).some((evento) => evento.tipo === "separacao_iniciada"));
  assert.equal((await request("logistica", "/logistica/necessidade-producao")).body.resumo.quantidadeFaltante, 3);
  for (const quantidadeSeparada of [0, 1, 3]) {
    assert.equal((await atualizar({ separacaoItens: [{ produtoId: id(100), quantidadeSeparada }] })).status, 200);
    const demand = await request("admin", "/logistica/necessidade-producao");
    assert.equal(demand.body.resumo.quantidadeFaltante, 3 - quantidadeSeparada);
    if (quantidadeSeparada < 3) {
      assert.equal(demand.body.pedidos[0].itens[0].quantidadeAtendida, quantidadeSeparada);
      assert.equal(demand.body.pedidos[0].valorTotal, undefined);
      assert.equal(demand.body.pedidos[0].historicoStatus, undefined);
    } else assert.deepEqual(demand.body.pedidos, []);
  }
});

test("formulário → API → necessidade inclui item vazio enquanto outro tem falta registrada", async (t) => {
  const { request, pedidos } = await fixture(t);
  const pedido = new Pedido({
    _id: id(200), numeroPedido: "AP-PARCIAL", clienteId: id(4), tabelaPrecoId: id(50),
    dia: 11, mes: 9, ano: 2026, status: "aprovado", valorTotal: 300,
    itens: [
      { produtoId: id(100), nomeProduto: "Produto A", quantidade: 10, valorUnitario: 10, subtotal: 100 },
      { produtoId: id(101), nomeProduto: "Produto B", quantidade: 20, valorUnitario: 10, subtotal: 200 },
    ],
  });
  pedidos.push(pedido);
  t.mock.method(pedido, "save", async () => { await pedido.validate(); return pedido; });
  await request("admin", `/logistica/pedidos/${pedido._id}`, { versaoPedido: 0, status: "separando" }, "PATCH");
  const form = buildOrderOperationsForm(pedido);
  form.separacao[id(100)] = "4";
  const response = await request("admin", `/logistica/pedidos/${pedido._id}`, buildOrderOperationsPayload(pedido, form), "PATCH");
  assert.equal(response.status, 200);
  assert.equal(pedido.itens[1].quantidadeSeparada, undefined);
  const demand = await request("logistica", "/logistica/necessidade-producao");
  assert.equal(demand.body.resumo.quantidadeFaltante, 26);
  assert.equal(demand.body.produtos.length, 2);
});

test("listagem de distribuidores usa projeção mínima e somente clientes elegíveis", async (t) => {
  let selection;
  const eligible = { _id: id(4), nomeFantasia: "Distribuidor", tabelaPrecoId: { _id: id(50), nome: "Tabela A" } };
  t.mock.method(Usuario, "find", (filter) => {
    assert.deepEqual(filter, { tipo: "cliente", ativo: true, statusCadastro: "aprovado", tabelaPrecoId: { $ne: null } });
    return { ...query([eligible, { _id: id(20), tabelaPrecoId: null }]),
      select(fields) { selection = fields; return this; },
      populate(options) { assert.deepEqual(options.match, { ativa: true }); return this; },
    };
  });
  const res = { status(code) { assert.equal(code, 200); return this; }, json(value) { this.body = value; } };
  await listarDistribuidoresPedido({ usuario: { tipo: "comercial" } }, res);
  assert.deepEqual(res.body, [eligible]);
  assert.doesNotMatch(selection, /senha|email|tokenVersion/);
});

test('HTTP: carteira valida IDs em clientes, catálogo, criação, detalhes, PDF e edição', async (t) => {
  const { request, body, usuarios, pedidos } = await fixture(t);
  const own = usuarios.get('cliente')._id, other = usuarios.get('clienteB')._id;
  assert.equal((await request('vendedor', `/carteira/${own}`)).status, 200);
  assert.equal((await request('vendedor', `/carteira/${other}`)).status, 403);
  assert.equal((await request('vendedor', `/pedidos/comercial/distribuidores/${other}/catalogo`)).status, 403);
  assert.equal((await request('vendedor', '/pedidos/comercial', body({ clienteId: other }))).status, 403);
  assert.equal((await request('vendedor', '/pedidos/comercial', body())).status, 201);
  assert.equal(String(pedidos[0].clienteId), own);
  assert.equal(pedidos[0].criadoPor.usuarioTipo, 'vendedor');
  assert.equal((await request('clienteB', '/pedidos', body())).status, 201);
  const target = pedidos[1]._id;
  for (const suffix of ['', '/pdf', '/aprovacao']) assert.equal((await request('vendedor', `/pedidos/${target}${suffix}`)).status, 403);
  assert.equal((await request('vendedor', `/pedidos/${target}`, { itens: [{ produtoId: id(100), quantidade: 2 }], versaoPedido: 0 }, 'PUT')).status, 403);
  assert.equal((await request('cliente', `/pedidos/${target}`)).status, 403);
  assert.equal((await request('cliente', `/pedidos/${target}/pdf`)).status, 403);
  assert.equal((await request('vendedor', '/pedidos')).body.length, 1);
  assert.equal((await request('admin', '/carteira')).body.length, 2);
});

test('HTTP: tela de pedidos do vendedor consulta produtos auxiliares, sem poder alterar catálogo', async (t) => {
  const { request, usuarios } = await fixture(t);
  t.mock.method(Produto, 'find', () => query([{ _id: id(100), nome: 'Produto', linha: 'Linha', categoria: 'Categoria' }]));
  assert.equal((await request('vendedor', '/produtos')).status, 200);
  usuarios.get('vendedor').permissoes = { editarPedidos: false };
  assert.equal((await request('vendedor', '/produtos')).status, 200);
  assert.equal((await request('vendedor', `/produtos/${id(100)}`, { nome: 'Indevido' }, 'PUT')).status, 403);
});

test('HTTP: vendedor acompanha pedido do distribuidor, edita antes da operação e respeita transferência', async (t) => {
  const { request, body, usuarios, pedidos } = await fixture(t);
  assert.equal((await request('cliente', '/pedidos', body())).status, 201);
  const pedido = pedidos[0];
  t.mock.method(pedido, 'save', async () => { await pedido.validate(); pedido.__v = Number(pedido.__v || 0) + 1; return pedido; });
  const detail = await request('vendedor', `/pedidos/${pedido._id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.__v, 0);
  assert.equal((await request('vendedor', '/pedidos')).body.length, 1);
  const editBody = () => ({ itens: [{ produtoId: id(100), quantidade: 2 }], versaoPedido: pedido.__v });
  const edited = await request('vendedor', `/pedidos/${pedido._id}`, editBody(), 'PUT');
  assert.equal(edited.status, 200);
  assert.equal(pedido.historicoAlteracoes[0].usuarioTipo, 'vendedor');
  for (const status of ['aprovado', 'separando', 'separado', 'faturado', 'enviado', 'entregue']) {
    pedido.status = status;
    assert.equal((await request('vendedor', `/pedidos/${pedido._id}`, editBody(), 'PUT')).status, 409, status);
  }
  usuarios.get('cliente').vendedorResponsavelId = usuarios.get('comercial')._id;
  assert.equal((await request('vendedor', `/pedidos/${pedido._id}`)).status, 403);
  assert.equal((await request('vendedor', '/pedidos')).body.length, 0);
});

test('HTTP: Comercial preserva escopo global e ganha treinamento por permissão', async (t) => {
  const { request, body, usuarios } = await fixture(t);
  usuarios.get('comercial').permissoes = { pedidosTodos: false };
  usuarios.get('cliente').vendedorResponsavelId = usuarios.get('comercial')._id;
  assert.equal((await request('comercial', '/carteira')).body.length, 2);
  assert.equal((await request('comercial', '/pedidos/comercial', body())).status, 201);
  assert.equal((await request('comercial', '/pedidos/comercial', body({ clienteId: id(20) }))).status, 201);
  t.mock.method(Treinamento, 'findOne', () => query(null));
  assert.equal((await request('comercial', `/treinamentos/${id(999)}`)).status, 404); // passou pela autorização
  usuarios.get('comercial').permissoes.treinamentos = false;
  assert.equal((await request('comercial', `/treinamentos/${id(999)}`)).status, 403);
  usuarios.get('vendedor').permissoes = { pedidosTodos: true };
  assert.equal((await request('vendedor', `/carteira/${id(20)}`)).status, 403);
});

test('HTTP: Admin atribui e troca vendedor; outras contas não gerenciam usuários', async (t) => {
  const { request, usuarios } = await fixture(t);
  t.mock.method(Usuario, 'findOneAndUpdate', (filter, update, options) => {
    assert.equal(options.returnDocument, 'after');
    assert.equal(options.new, undefined);
    const user = [...usuarios.values()].find((u) => u._id === filter._id && u.tipo === filter.tipo);
    if (user) Object.assign(user, update.$set);
    return query(user);
  });
  for (const role of ['vendedor', 'comercial', 'cliente']) assert.equal((await request(role, '/usuarios')).status, 403);
  assert.equal((await request('admin', '/usuarios')).body.usuarios.length, usuarios.size);
  for (const role of ['comercial', 'vendedor']) {
    assert.equal((await request('admin', `/usuarios/${id(4)}/vendedor`, { vendedorResponsavelId: usuarios.get(role)._id, vendedorResponsavelEsperadoId: usuarios.get('cliente').vendedorResponsavelId }, 'PATCH')).status, 200);
    assert.equal(usuarios.get('cliente').vendedorResponsavelId, usuarios.get(role)._id);
  }
  assert.equal((await request('admin', `/usuarios/${id(4)}/vendedor`, { vendedorResponsavelId: usuarios.get('marketing')._id, vendedorResponsavelEsperadoId: usuarios.get('cliente').vendedorResponsavelId }, 'PATCH')).status, 400);
});

test('HTTP: Admin cria pessoa, valida campos e altera perfil, permissões e status com invalidação da sessão', async (t) => {
  const { request, usuarios } = await fixture(t);
  let created;
  t.mock.method(Usuario, 'exists', async () => null);
  t.mock.method(Usuario.prototype, 'save', async function () { await this.validate(); created = this; return this; });
  const payload = { nomeResponsavel: 'Pessoa teste', email: 'pessoa@example.com', tipo: 'vendedor', ativo: true, permissoes: { treinamentos: true }, senha: 'senha-local-teste' };
  assert.equal((await request('admin', '/usuarios', { ...payload, permissoes: { invalida: true } })).status, 400);
  assert.equal((await request('admin', '/usuarios', payload)).status, 201);
  assert.equal(created.nomeResponsavel, 'Pessoa teste');
  assert.notEqual(created.senha, payload.senha);
  const user = usuarios.get('vendedor');
  user.email = 'vendedor@example.com';
  user.save = async () => user;
  const changed = await request('admin', `/usuarios/${user._id}`, { ...payload, email: user.email, tipo: 'comercial', ativo: false, senha: '' }, 'PATCH');
  assert.equal(changed.status, 200);
  assert.equal(user.tipo, 'comercial');
  assert.equal(user.ativo, false);
  assert.equal(user.permissoes.treinamentos, true);
  assert.equal(user.tokenVersion, 1);
  assert.equal((await request('vendedor', '/carteira')).status, 403);
  user.ativo = true;
  assert.equal((await request('vendedor', '/carteira')).status, 401);
});

test('HTTP: sessão legada sem permissões ou carteira mantém identidade e acesso padrão', async (t) => {
  const { request, usuarios } = await fixture(t);
  for (const role of ['cliente', 'comercial', 'admin']) {
    const user = usuarios.get(role);
    delete user.permissoes;
    delete user.vendedorResponsavelId;
    const result = await request(role, '/auth/me');
    assert.equal(result.status, 200);
    assert.equal(result.body.usuario.nomeResponsavel, user.nomeResponsavel);
    assert.equal(result.body.usuario.tokenVersion, undefined);
  }
  assert.equal((await request('cliente', '/pedidos/meus')).status, 200);
  assert.equal((await request('comercial', '/pedidos')).status, 200);
});

for (const origin of ['cliente', 'vendedor']) test(`HTTP: regressão completa ${origin} → produção → separação → conferência → faturamento → recebimento`, async (t) => {
  const { request, body, pedidos, usuarios } = await fixture(t);
  assert.equal((await request(origin, origin === 'cliente' ? '/pedidos' : '/pedidos/comercial', body())).status, 201);
  const pedido = pedidos[0];
  t.mock.method(pedido, 'save', async () => { await pedido.validate(); pedido.__v = Number(pedido.__v || 0) + 1; return pedido; });
  const path = `/logistica/pedidos/${pedido._id}`;
  const patch = (data) => request('admin', path, { versaoPedido: Number(pedido.__v || 0), ...data }, 'PATCH');
  assert.equal((await request('admin', `/pedidos/${pedido._id}/aprovar`, {}, 'PATCH')).status, 200);
  assert.equal((await patch({ status: 'separando' })).status, 200);
  assert.equal((await request('logistica', '/logistica/necessidade-producao')).body.resumo.quantidadeFaltante, 3);
  assert.equal((await patch({ separacaoItens: [{ produtoId: id(100), quantidadeSeparada: 3 }] })).status, 200);
  assert.equal((await request('logistica', '/logistica/necessidade-producao')).body.resumo.quantidadeFaltante, 0);
  assert.equal((await patch({ status: 'separado' })).status, 200);
  assert.equal((await patch({ conferencia: { acao: 'iniciar' } })).status, 200);
  assert.equal((await patch({ conferencia: { acao: 'concluir', itens: [{ produtoId: id(100), quantidadeConferida: 3 }] } })).status, 200);
  const operador = { _id: id(300), nome: "Operador", ativo: true };
  t.mock.method(OperadorLogistica, "findById", () => query(operador));
  const headers = { "X-Operador-Contexto": signOperatorContext({ operadorId: operador._id, pedidoId: pedido._id, usuarioId: usuarios.get("logistica")._id }) };
  assert.equal((await request("logistica", path, { versaoPedido: pedido.__v, fechamentoLogistico: { quantidadeVolumes: 1, pesoTotalKg: 2, observacaoVolumes: 'Uma caixa' } }, 'PATCH', headers)).status, 200);
  assert.equal((await patch({ status: 'faturado', numeroNotaFiscal: 'NF-LOCAL', dataFaturamento: '2026-09-30' })).status, 200);
  assert.equal((await patch({ status: 'enviado', transportadora: 'Transportadora local', dataEnvio: '2026-09-30' })).status, 200);
  assert.equal((await request('cliente', `/pedidos/${pedido._id}/confirmar-recebimento`, {}, 'PATCH')).status, 200);
  assert.equal(pedido.status, 'entregue');
});

test('HTTP: presets e permissões efetivas são fornecidos pelo backend', async (t) => {
  const { request } = await fixture(t);
  const presets = await request('admin', '/usuarios/presets');
  assert.deepEqual(presets.body.perfis, ROLE_PERMISSIONS);
  assert.deepEqual(presets.body.permissoes, PERMISSIONS);
  const me = await request('comercial', '/auth/me');
  assert.equal(me.body.usuario.permissoesEfetivas.acompanharTreinamentos, true);
  assert.equal(me.body.usuario.permissoesEfetivas.materiais, false);
  assert.equal(me.body.usuario.permissoesEfetivas.criarTreinamentos, false);
});
for (const [method, suffix, permission] of [['POST', '', 'criarTreinamentos'], ['PUT', `/${id(999)}`, 'editarTreinamentos'], ['PATCH', `/${id(999)}/status`, 'editarTreinamentos'], ['DELETE', `/${id(999)}`, 'excluirTreinamentos']]) {
  test(`HTTP: Comercial não executa ${permission} por padrão (${method})`, async (t) => {
    const { request } = await fixture(t);
    assert.equal((await request('comercial', `/admin/treinamentos${suffix}`, {}, method)).status, 403);
  });
}
test('HTTP: Comercial consulta treinamento e indicadores sem permissão de escrita', async (t) => {
  const { request } = await fixture(t);
  t.mock.method(Treinamento, 'findById', () => query({ _id: id(999), titulo: 'Treinamento' }));
  t.mock.method(ProgressoTreinamento, 'aggregate', () => ({ option: async () => [{ iniciaram: 2, concluiram: 1, mediaProgresso: 75 }] }));
  t.mock.method(ProgressoTreinamento, 'find', () => ({ ...query([{ usuarioId: { _id: id(4) }, percentualAssistido: 100 }]), skip() { return this; }, limit() { return this; } }));
  t.mock.method(ProgressoTreinamento, 'countDocuments', () => query(2));
  assert.equal((await request('comercial', `/admin/treinamentos/${id(999)}`)).status, 200);
  const progress = await request('comercial', `/admin/treinamentos/${id(999)}/progresso`);
  assert.equal(progress.status, 200);
  assert.equal(progress.body.resumo.mediaProgresso, 75);
});
test('HTTP: Comercial não recebe materiais e respeita overrides', async (t) => {
  const { request, usuarios } = await fixture(t);
  assert.equal((await request('comercial', '/materiais-marketing')).status, 403);
  usuarios.get('comercial').permissoes = { materiais: true, criarTreinamentos: true, acompanharTreinamentos: false };
  assert.equal(effectivePermissions(usuarios.get('comercial')).materiais, true);
  assert.equal(effectivePermissions(usuarios.get('comercial')).criarTreinamentos, true);
  assert.equal((await request('comercial', `/admin/treinamentos/${id(999)}/progresso`)).status, 403);
  assert.equal(hasGlobalScope(usuarios.get('comercial')), true);
});
test('HTTP: troca e remoção atualizam escopo e retornam cliente atualizado', async (t) => {
  const { request, usuarios, body } = await fixture(t);
  await request('cliente', '/pedidos', body());
  const vendedorB = { ...usuarios.get('vendedor'), _id: id(29) };
  usuarios.set('vendedorB', vendedorB);
  t.mock.method(Usuario, 'findOneAndUpdate', (filter, update, options) => {
    assert.equal(options.returnDocument, 'after');
    const cliente = usuarios.get('cliente');
    assert.equal(filter.vendedorResponsavelId, cliente.vendedorResponsavelId ?? null);
    Object.assign(cliente, update.$set);
    assert.equal(update.$push.historicoAdministrativo.autorId, usuarios.get('admin')._id);
    return query(cliente);
  });
  const swap = await request('admin', `/usuarios/${id(4)}/vendedor`, { vendedorResponsavelId: vendedorB._id, vendedorResponsavelEsperadoId: usuarios.get('cliente').vendedorResponsavelId }, 'PATCH');
  assert.equal(swap.body.vendedorResponsavelId, vendedorB._id);
  assert.equal((await request('vendedor', '/carteira')).body.length, 0);
  assert.equal((await request('vendedor', '/pedidos')).body.length, 0);
  assert.equal((await request('vendedorB', '/carteira')).body.length, 1);
  assert.equal((await request('vendedorB', '/pedidos')).body.length, 1);
  assert.equal((await request('admin', `/usuarios/${id(4)}/vendedor`, { vendedorResponsavelId: null, vendedorResponsavelEsperadoId: id(29) }, 'PATCH')).status, 200);
  assert.equal((await request('vendedorB', '/carteira')).body.length, 0);
  assert.equal((await request('vendedorB', '/pedidos')).body.length, 0);
  assert.equal((await request('comercial', '/carteira')).body.length, 2);
});

test('HTTP: acompanhamento inclui público elegível que ainda não iniciou', async (t) => {
  const { request } = await fixture(t);
  t.mock.method(Treinamento, 'findById', () => query({ _id: id(999), titulo: 'Treinamento', publicos: ['cliente'], audienciaTipo: 'especificos', distribuidoresIds: [id(4)] }));
  t.mock.method(ProgressoTreinamento, 'distinct', () => query([id(20)]));
  t.mock.method(Usuario, 'find', (filter) => {
    assert.deepEqual(filter.$or, [{ tipo: 'cliente', _id: { $in: [id(4)] } }]);
    assert.deepEqual(filter._id, { $nin: [id(20)] });
    assert.equal(filter.ativo, true);
    return { ...query([{ _id: id(4), nomeResponsavel: 'Cliente' }]), skip() { return this; }, limit() { return this; } };
  });
  t.mock.method(Usuario, 'countDocuments', () => query(1));
  const result = await request('comercial', `/admin/treinamentos/${id(999)}/nao-iniciados`);
  assert.equal(result.status, 200);
  assert.equal(result.body.resumo.totalNaoIniciaram, 1);
  assert.equal(result.body.usuarios[0].percentualAssistido, 0);
  assert.equal(result.body.usuarios[0].iniciadoEm, null);
});
test('HTTP: conflito concorrente na atribuição não sobrescreve outra relação', async (t) => {
  const { request } = await fixture(t);
  t.mock.method(Usuario, 'findOneAndUpdate', () => query(null));
  assert.equal((await request('admin', `/usuarios/${id(4)}/vendedor`, { vendedorResponsavelId: null, vendedorResponsavelEsperadoId: id(29) }, 'PATCH')).status, 409);
});

// Modelo em memória: filtro esperado e mutação são avaliados juntos.
const atomicAssignments = (t, usuarios) => t.mock.method(Usuario, 'findOneAndUpdate', (filter, update, options) => {
  assert.equal(options.returnDocument, 'after');
  const cliente = [...usuarios.values()].find((user) => user._id === filter._id && user.tipo === filter.tipo &&
    String(user.vendedorResponsavelId ?? '') === String(filter.vendedorResponsavelId ?? ''));
  if (!cliente) return query(null);
  Object.assign(cliente, update.$set);
  cliente.historicoAdministrativo ||= [];
  cliente.historicoAdministrativo.push(update.$push.historicoAdministrativo);
  return query({ ...cliente });
});
for (const [name, atual, esperado, novo, status] of [
  ['primeira atribuição', null, null, id(7), 200],
  ['primeira atribuição desatualizada', id(2), null, id(7), 409],
  ['troca A para B', id(7), id(7), id(2), 200],
  ['troca com responsável desatualizado', id(2), id(7), id(7), 409],
  ['remoção', id(7), id(7), null, 200],
  ['remoção desatualizada', id(2), id(7), null, 409],
  ['Comercial para Vendedor', id(2), id(2), id(7), 200],
]) {
  test(`HTTP: atribuição atômica ${name}`, async (t) => {
    const { request, usuarios } = await fixture(t);
    const cliente = usuarios.get('cliente');
    if (atual === null) delete cliente.vendedorResponsavelId;
    else cliente.vendedorResponsavelId = atual;
    atomicAssignments(t, usuarios);
    const result = await request('admin', `/usuarios/${id(4)}/vendedor`, { vendedorResponsavelId: novo, vendedorResponsavelEsperadoId: esperado }, 'PATCH');
    assert.equal(result.status, status);
    assert.equal(cliente.vendedorResponsavelId ?? null, status === 200 ? novo : atual);
    assert.equal(cliente.historicoAdministrativo?.length || 0, status === 200 ? 1 : 0);
    if (status === 200) {
      const audit = cliente.historicoAdministrativo[0];
      assert.equal(audit.antes.vendedorResponsavelId, esperado);
      assert.equal(audit.depois.vendedorResponsavelId, novo);
      assert.equal(audit.autorId, id(1));
      assert.ok(audit.em instanceof Date);
    } else {
      assert.equal(result.body.code, 'SELLER_ASSIGNMENT_CONFLICT');
      assert.equal(result.body.currentSellerId, atual);
      assert.equal(result.body.currentSellerName, usuarios.get('comercial').nomeResponsavel);
    }
  });
}
test('HTTP: duas escritas concorrentes possuem apenas um vencedor e uma auditoria', async (t) => {
  const { request, usuarios } = await fixture(t);
  atomicAssignments(t, usuarios);
  const results = await Promise.all([
    request('admin', `/usuarios/${id(4)}/vendedor`, { vendedorResponsavelId: id(2), vendedorResponsavelEsperadoId: id(7) }, 'PATCH'),
    request('admin', `/usuarios/${id(4)}/vendedor`, { vendedorResponsavelId: null, vendedorResponsavelEsperadoId: id(7) }, 'PATCH'),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(results.find((r) => r.status === 409).body.code, 'SELLER_ASSIGNMENT_CONFLICT');
  assert.equal(usuarios.get('cliente').historicoAdministrativo.length, 1);
});
for (const value of [undefined, '', 'invalido', {}, false]) {
  test(`HTTP: responsável esperado obrigatório e validado (${JSON.stringify(value)})`, async (t) => {
    const { request } = await fixture(t);
    t.mock.method(Usuario, 'findOneAndUpdate', () => { assert.fail('Não pode escrever payload inválido'); });
    const payload = { vendedorResponsavelId: null };
    if (value !== undefined) payload.vendedorResponsavelEsperadoId = value;
    assert.equal((await request('admin', `/usuarios/${id(4)}/vendedor`, payload, 'PATCH')).status, 400);
  });
}
test('HTTP: responsáveis retorna apenas Vendedor e Comercial ativos com campos mínimos', async (t) => {
  const { request, usuarios } = await fixture(t);
  usuarios.set('vendedorInativo', { _id: id(31), tipo: 'vendedor', ativo: false });
  usuarios.set('comercialInativo', { _id: id(32), tipo: 'comercial', ativo: false });
  t.mock.method(Usuario, 'find', (filter) => {
    assert.deepEqual(filter, { tipo: { $in: ['vendedor', 'comercial'] }, ativo: true });
    return query([...usuarios.values()].filter((u) => filter.tipo.$in.includes(u.tipo) && u.ativo));
  });
  const result = await request('admin', '/usuarios/responsaveis');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.map((u) => u.tipo).sort(), ['comercial', 'vendedor']);
  for (const user of result.body) assert.deepEqual(Object.keys(user).sort(), ['_id', 'nomeResponsavel', 'tipo']);
  assert.equal((await request('comercial', '/usuarios/responsaveis')).status, 403);
});
