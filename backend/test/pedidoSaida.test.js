import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import Pedido from "../src/models/Pedido.js";
import Usuario from "../src/models/Usuario.js";
import pedidoRouter from "../src/routes/pedidoRoutes.js";
import logisticaRouter from "../src/routes/logisticaRoutes.js";
import { registrarSaidaAdministrativa } from "../src/services/pedidoSaidaService.js";
import { calcularNecessidadeProducao } from "../src/utils/necessidadeProducao.js";
import { sanitizeClientOrder, transicoesPermitidasParaPedido } from "../src/utils/pedidoLogistica.js";
import { buildOrderAuditPdfData } from "../src/services/pdfAuditoriaPedidoService.js";
import { applyLogisticsOrderUpdate, buildLogisticsOrderFilter, parseLogisticsOrderQuery } from "../src/controllers/logisticaController.js";

const id = (n) => n.toString(16).padStart(24, "0");
const query = (value) => ({
  select() { return this; }, lean() { return this; }, sort() { return this; }, maxTimeMS() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});
const admin = { _id: id(1), tipo: "admin", nomeResponsavel: "Admin da Central" };

async function fixture(t, status = "aguardando_aprovacao", extra = {}) {
  let persisted = new Pedido({
    _id: id(100), __v: 0, numeroPedido: "PED-SAIDA", clienteId: id(4),
    tabelaPrecoId: id(5), dia: 5, mes: 10, ano: 2026, valorTotal: 30,
    itens: [{ produtoId: id(10), nomeProduto: "Shampoo", quantidade: 3,
      quantidadeSeparada: status === "separado" ? 3 : 0, valorUnitario: 10, subtotal: 30 }],
    status, ...extra,
  }).toObject();
  let writes = 0;
  t.mock.method(Pedido, "findById", () => query(new Pedido(persisted)));
  const demandQueries = [];
  t.mock.method(Pedido, "find", (filter) => {
    const results = filter.status?.$in
      ? (filter.status.$in.includes(persisted.status) ? [persisted] : [])
      : [persisted];
    const result = query(results);
    result.select = (projection) => {
      if (filter.status) demandQueries.push({ filter, projection });
      return result;
    };
    return result;
  });
  t.mock.method(Pedido, "findOneAndUpdate", (filter, update) => {
    if (persisted.status !== filter.status || (filter.__v !== undefined && persisted.__v !== filter.__v)) return query(null);
    const next = new Pedido({ ...persisted, ...update.$set,
      historicoStatus: [...(persisted.historicoStatus || []), update.$push.historicoStatus],
      __v: (persisted.__v || 0) + 1,
    });
    assert.equal(next.validateSync(), undefined);
    persisted = next.toObject();
    writes += 1;
    return query(next);
  });
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "testes-saida-administrativa-segredo-local";
  t.after(() => { if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; });
  const users = [admin, ...["comercial", "logistica", "cliente", "vendedor", "marketing", "groomer"].map((tipo, i) => ({ _id: id(i + 2), tipo }))]
    .map((user) => ({ ...user, ativo: true, statusCadastro: "aprovado", tokenVersion: 0 }));
  t.mock.method(Usuario, "findById", (target) => query(users.find((user) => user._id === target)));
  const app = express();
  app.use(express.json()); app.use("/pedidos", pedidoRouter); app.use("/logistica", logisticaRouter);
  const server = await new Promise((resolve) => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = async (role, action, method = "PATCH", body = {}) => {
    const user = users.find((entry) => entry.tipo === role);
    const token = user && jwt.sign({ id: user._id, tipo: user.tipo, tokenVersion: 0 }, process.env.JWT_SECRET);
    const path = action.startsWith("/") ? action : `/pedidos/${action}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { request, getPedido: () => persisted, writes: () => writes, demandQueries, setPedido: (data) => { Object.assign(persisted, data); } };
}

test("HTTP: somente Admin pode enviar diretamente ou retirar, mesmo com permissões comerciais", async (t) => {
  const f = await fixture(t);
  for (const role of ["comercial", "logistica", "cliente", "vendedor", "marketing", "groomer", null]) {
    for (const action of ["marcar-enviado", "retirar"]) {
      assert.equal((await f.request(role, `${id(100)}/${action}`)).status, role ? 403 : 401);
    }
  }
  assert.equal(f.writes(), 0);
});

test("Admin avança sem inventar aprovação, separação, conferência ou faturamento", async (t) => {
  const f = await fixture(t, "aguardando_aprovacao", { conferenciaObrigatoria: true, fechamentoLogisticoObrigatorio: true });
  const response = await f.request("admin", `${id(100)}/marcar-enviado`);
  assert.equal(response.status, 200);
  const pedido = f.getPedido();
  assert.equal(pedido.status, "enviado");
  assert.ok(pedido.dataEnvio instanceof Date);
  for (const field of ["aprovacao", "conferencia", "fechamentoLogistico", "dataFaturamento"]) assert.equal(pedido[field], undefined);
  assert.equal(pedido.historicoStatus.length, 1);
  assert.equal(pedido.historicoStatus[0].statusAnterior, "aguardando_aprovacao");
  assert.equal(pedido.historicoStatus[0].acao, "envio_direto_admin");
  assert.equal(String(pedido.historicoStatus[0].usuarioId), admin._id);
  const evento = response.body.pedido.historicoPedido.find((entry) => entry.tipo === "envio_direto_admin");
  assert.match(evento.titulo, /Avanço direto/);
  assert.match(evento.detalhes, /intermediárias ignoradas/);
});

for (const destino of ["enviado", "retirado"]) {
  test(`requisições concorrentes e repetidas para ${destino} mantêm data e um único histórico`, async (t) => {
    const f = await fixture(t, destino === "retirado" ? "faturado" : "separando");
    const results = await Promise.all(Array.from({ length: 8 }, () => registrarSaidaAdministrativa({ pedidoId: id(100), destino, usuario: admin })));
    assert.ok(results.every((pedido) => pedido.status === destino));
    const dateField = destino === "retirado" ? "retiradoEm" : "dataEnvio";
    const date = f.getPedido()[dateField].getTime();
    await registrarSaidaAdministrativa({ pedidoId: id(100), destino, usuario: { ...admin, _id: id(2) } });
    assert.equal(f.writes(), 1);
    assert.equal(f.getPedido().historicoStatus.length, 1);
    assert.equal(f.getPedido()[dateField].getTime(), date);
    if (destino === "retirado") assert.equal(String(f.getPedido().retiradoPor.usuarioId), admin._id);
  });
}

test("retirada encerra a operação, preserva data no histórico do distribuidor e autoria interna", async (t) => {
  const f = await fixture(t, "separado");
  const response = await f.request("admin", `${id(100)}/retirar`, "PATCH", { retiradoEm: "2000-01-01", usuarioId: id(99) });
  assert.equal(response.status, 200);
  const pedido = f.getPedido();
  assert.equal(pedido.status, "retirado");
  assert.ok(pedido.retiradoEm.getFullYear() > 2000);
  assert.equal(pedido.dataEntrega, undefined);
  assert.equal(pedido.historicoStatus[0].alteradoEm.getTime(), pedido.retiradoEm.getTime());
  assert.equal(pedido.historicoStatus[0].acao, "retirada_admin");
  assert.equal(String(pedido.retiradoPor.usuarioId), admin._id);
  const meus = await f.request("cliente", "meus", "GET");
  assert.equal(meus.status, 200);
  assert.equal(meus.body[0].retiradoEm, pedido.retiradoEm.toISOString());
  assert.equal(meus.body[0].retiradoPor, undefined);
  assert.deepEqual(transicoesPermitidasParaPedido(pedido, { admin: true }), []);
  assert.equal(applyLogisticsOrderUpdate({ pedido, data: {}, usuario: admin }).valid, false);
  assert.equal((await f.request("admin", `${id(100)}/marcar-enviado`)).status, 409);
  assert.equal((await f.request("admin", `${id(100)}`, "DELETE")).status, 409);
  const pdf = buildOrderAuditPdfData(pedido);
  assert.equal(pdf.statusLabel, "Retirado pelo distribuidor");
  assert.ok(pdf.timeline.some((event) => event.tipo === "pedido_retirado" && event.responsavelNome === admin.nomeResponsavel));
});

test("retirada exige preparação e não ignora conferência ou fechamento obrigatório", async (t) => {
  const f = await fixture(t, "aprovado");
  assert.equal((await f.request("admin", `${id(100)}/retirar`)).status, 409);
  f.setPedido({ status: "separado", conferenciaObrigatoria: true });
  assert.equal((await f.request("admin", `${id(100)}/retirar`)).status, 409);
  f.setPedido({ conferenciaObrigatoria: false, fechamentoLogisticoObrigatorio: true });
  assert.equal((await f.request("admin", `${id(100)}/retirar`)).status, 409);
  assert.equal(f.writes(), 0);
});

test("novo estado é validado e excluído dos filtros de ação e demanda de produção", async (t) => {
  const f = await fixture(t, "separando");
  assert.equal(calcularNecessidadeProducao([f.getPedido()]).resumo.quantidadeFaltante, 3);
  await registrarSaidaAdministrativa({ pedidoId: id(100), destino: "enviado", usuario: admin });
  assert.equal(calcularNecessidadeProducao([f.getPedido()]).resumo.quantidadeFaltante, 0);
  f.setPedido({ status: "retirado" });
  assert.equal(calcularNecessidadeProducao([f.getPedido()]).resumo.quantidadeFaltante, 0);
  assert.equal(parseLogisticsOrderQuery({ status: "retirado" }).valid, true);
  assert.ok(buildLogisticsOrderFilter({ aguardandoAcao: true }).status.$nin.includes("retirado"));
});

test("pedidos antigos não exigem campos de retirada e mantêm estados e datas originais", async (t) => {
  const f = await fixture(t, "faturado");
  const legacy = new Pedido(f.getPedido());
  assert.equal(legacy.validateSync(), undefined);
  assert.equal(sanitizeClientOrder(legacy).retiradoEm, undefined);
  assert.equal((await f.request("admin", `${id(100)}/retirar`)).status, 200);
});

test("Admin não envia pedidos cancelados, entregues ou em estado desconhecido", async (t) => {
  const f = await fixture(t, "cancelado");
  for (const status of ["cancelado", "entregue", "desconhecido"]) {
    f.setPedido({ status });
    assert.equal((await f.request("admin", `${id(100)}/marcar-enviado`)).status, 409);
  }
  assert.equal(f.writes(), 0);
});

test("a rota genérica não permite retirada sem data, responsável e ação específica", async (t) => {
  const f = await fixture(t, "faturado");
  assert.equal((await f.request("admin", `${id(100)}/status`, "PUT", { status: "retirado" })).status, 409);
  assert.equal(f.writes(), 0);
  const invalid = new Pedido({ ...f.getPedido(), status: "retirado" });
  await assert.rejects(invalid.validate(), (error) => Boolean(error.errors.retiradoEm && error.errors.retiradoPor));
});

test("edição concorrente impede avanço com snapshot desatualizado", async (t) => {
  const f = await fixture(t, "separando");
  t.mock.method(Pedido, "findOneAndUpdate", (filter) => {
    assert.equal(filter.__v, 0);
    f.setPedido({ __v: 1 });
    return query(null);
  });
  await assert.rejects(registrarSaidaAdministrativa({ pedidoId: id(100), destino: "enviado", usuario: admin }), { statusCode: 409 });
  assert.equal(f.getPedido().status, "separando");
  assert.equal(f.getPedido().dataEnvio, undefined);
});

test("envio e retirada concorrentes não registram dois finais", async (t) => {
  const f = await fixture(t, "faturado");
  const results = await Promise.allSettled(["enviado", "retirado"].map((destino) => registrarSaidaAdministrativa({ pedidoId: id(100), destino, usuario: admin })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.statusCode, 409);
  assert.equal(f.writes(), 1);
  assert.equal(f.getPedido().historicoStatus.length, 1);
});

test("HTTP: envio direto encerra demanda aberta sem modificar as quantidades ou criar etapas", async (t) => {
  const f = await fixture(t, "separando", { conferenciaObrigatoria: true, fechamentoLogisticoObrigatorio: true });
  const itensAntes = new Pedido(f.getPedido()).toObject().itens;
  const antes = await f.request("admin", "/logistica/necessidade-producao", "GET");
  assert.equal(antes.status, 200);
  assert.equal(antes.body.resumo.quantidadeFaltante, 3);
  assert.equal((await f.request("admin", `${id(100)}/marcar-enviado`)).status, 200);
  const depois = await f.request("admin", "/logistica/necessidade-producao", "GET");
  assert.equal(depois.status, 200);
  assert.deepEqual(depois.body, { produtos: [], pedidos: [], resumo: { quantidadePedidos: 0, quantidadeProdutos: 0, quantidadeFaltante: 0 } });
  assert.deepEqual(f.getPedido().itens, itensAntes);
  assert.equal(f.getPedido().historicoStatus.length, 1);
  assert.equal(f.getPedido().historicoStatus[0].statusAnterior, "separando");
  assert.equal(f.getPedido().historicoStatus[0].novoStatus, "enviado");
  assert.equal((await f.request("admin", `${id(100)}/marcar-enviado`)).status, 200);
  assert.equal(f.writes(), 1);
});

test("HTTP: retirada permanece fora da produção, preservando data, autor e histórico após repetição", async (t) => {
  const f = await fixture(t, "faturado");
  assert.equal((await f.request("admin", `${id(100)}/retirar`)).status, 200);
  const original = new Pedido(f.getPedido()).toObject();
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const demanda = await f.request("admin", "/logistica/necessidade-producao", "GET");
    assert.equal(demanda.status, 200);
    assert.deepEqual(demanda.body, { produtos: [], pedidos: [], resumo: { quantidadePedidos: 0, quantidadeProdutos: 0, quantidadeFaltante: 0 } });
    assert.equal((await f.request("admin", `${id(100)}/retirar`, "PATCH", {
      retiradoEm: "2000-01-01", retiradoPor: { usuarioId: id(99) },
    })).status, 200);
  }
  assert.equal(f.writes(), 1);
  assert.equal(f.getPedido().retiradoEm.getTime(), original.retiradoEm.getTime());
  assert.equal(String(f.getPedido().retiradoPor.usuarioId), admin._id);
  assert.equal(f.getPedido().historicoStatus.length, 1);
  assert.deepEqual(f.getPedido().itens, original.itens);
  const meus = await f.request("cliente", "meus", "GET");
  assert.equal(meus.body[0].status, "retirado");
  assert.equal(meus.body[0].retiradoEm, original.retiradoEm.toISOString());
  assert.ok(f.demandQueries.every(({ filter, projection }) => !filter.status.$in.includes("retirado") && projection.includes("retiradoEm")));
});
