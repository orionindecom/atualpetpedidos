import test from "node:test";
import assert from "node:assert/strict";
import { calcularNecessidadeProducao } from "../src/utils/necessidadeProducao.js";
import { PEDIDO_STATUS } from "../src/utils/pedidoLogistica.js";
import Pedido from "../src/models/Pedido.js";
import { obterNecessidadeProducao } from "../src/controllers/necessidadeProducaoController.js";

const item = (produtoId, quantidade, extra = {}) => ({ produtoId, nomeProduto: `Produto ${produtoId}`, quantidade, ...extra });
const pedido = (_id, itens, extra = {}) => ({ _id, numeroPedido: `AP-${_id}`, nomeFantasiaCliente: "Distribuidor", status: "aprovado", itens, ...extra });

test("regressão: aprovado sem início de separação não gera necessidade", () => {
  const result = calcularNecessidadeProducao([pedido("1", [item("A", 10)])]);
  assert.equal(result.resumo.quantidadeFaltante, 0);
  assert.deepEqual(result.pedidos, []);
  assert.deepEqual(result.produtos, []);
});

for (const [quantidadeSeparada, faltante] of [[0, 10], [4, 6], [10, 0]]) {
  test(`regressão: separação iniciada com ${quantidadeSeparada} de 10 gera falta ${faltante}`, () => {
    const result = calcularNecessidadeProducao([
      pedido("1", [item("A", 10, { quantidadeSeparada })], { status: "separando" }),
    ]);
    assert.equal(result.resumo.quantidadeFaltante, faltante);
    assert.equal(result.pedidos.length, faltante ? 1 : 0);
    assert.equal(result.produtos.length, faltante ? 1 : 0);
  });
}

test("regressão: dois pedidos não iniciados não aparecem no consolidado", () => {
  const result = calcularNecessidadeProducao([
    pedido("1", [item("A", 10, { quantidadeSeparada: 0 })]),
    pedido("2", [item("A", 20)], { status: "novo" }),
  ]);
  assert.equal(result.resumo.quantidadeFaltante, 0);
  assert.deepEqual(result.pedidos, []);
  assert.deepEqual(result.produtos, []);
});

test("regressão: falta real de 5 não soma solicitação de 20 de pedido não iniciado", () => {
  const result = calcularNecessidadeProducao([
    pedido("1", [item("A", 10, { quantidadeSeparada: 5 })], { status: "separando" }),
    pedido("2", [item("A", 20)]),
  ]);
  assert.equal(result.resumo.quantidadeFaltante, 5);
  assert.equal(result.pedidos.length, 1);
  assert.equal(result.produtos[0].quantidadePedidos, 1);
});

test("etapa atual de separação comprova início; aprovação e etapas encerradas não geram falta", () => {
  for (const status of [...PEDIDO_STATUS, "desconhecido", undefined]) {
    const result = calcularNecessidadeProducao([pedido("1", [item("A", 10, { quantidadeSeparada: 0 })], { status })]);
    assert.equal(result.resumo.quantidadeFaltante, status === "separando" ? 10 : 0, String(status));
  }
});

test("quantidades, aprovação e operador isolados não comprovam início da separação", () => {
  for (const status of ["aprovado", "novo", "em_analise"]) {
    for (const quantidadeSeparada of [undefined, null, 0, 4]) {
      const result = calcularNecessidadeProducao([pedido("1", [item("A", 10, { quantidadeSeparada, quantidadeFinal: 0 })], {
        status,
        aprovacao: { aprovadoEm: "2026-09-11T09:00:00Z" },
        historicoStatus: [{ novoStatus: "aprovado", alteradoEm: "2026-09-11T09:00:00Z", operadorId: "operador" }],
      })]);
      assert.equal(result.resumo.quantidadeFaltante, 0);
    }
  }
});

test("histórico de separação não inclui pedido que já saiu da etapa", () => {
  const base = pedido("1", [item("A", 10, { quantidadeSeparada: 0 })], {
    aprovacao: { aprovadoEm: "2026-09-11T09:00:00Z" },
  });
  for (const [novoStatus, alteradoEm, expected] of [
    ["separando", "2026-09-11T10:00:00Z", 0],
    ["aprovado", "2026-09-11T10:00:00Z", 0],
    ["separando", "data inválida", 0],
    ["separando", "2026-09-11T08:00:00Z", 0],
  ]) {
    const result = calcularNecessidadeProducao([{ ...base, historicoStatus: [{ novoStatus, alteradoEm }] }]);
    assert.equal(result.resumo.quantidadeFaltante, expected);
  }
});

test("início comprovado no histórico não reabre pedidos cancelados ou posteriores ao faturamento", () => {
  for (const status of ["aguardando_aprovacao", "faturado", "enviado", "entregue", "retirado", "cancelado", "desconhecido"]) {
    const result = calcularNecessidadeProducao([pedido("1", [item("A", 10, { quantidadeSeparada: 0 })], {
      status, historicoStatus: [{ novoStatus: "separando", alteradoEm: "2026-09-11T10:00:00Z" }],
    })]);
    assert.equal(result.resumo.quantidadeFaltante, 0, status);
  }
});

test("consolida produtos por ID em todos os pedidos, conta pedidos distintos e ordena por falta", () => {
  const result = calcularNecessidadeProducao([
    pedido("1", [item("A", 10, { quantidadeSeparada: 4 }), item("B", 20, { quantidadeSeparada: 0 }), item("A", 3, { quantidadeSeparada: 0 })], { status: "separando" }),
    pedido("2", [item("A", 8, { quantidadeSeparada: 2 }), item("B", 5, { quantidadeSeparada: 5 })], { status: "separando" }),
    pedido("3", [item("A", 2, { quantidadeSeparada: 2 })], { status: "separado" }),
  ]);
  assert.deepEqual(result.produtos.map(({ produtoId, quantidadeFaltante, quantidadePedidos }) => ({ produtoId, quantidadeFaltante, quantidadePedidos })), [
    { produtoId: "B", quantidadeFaltante: 20, quantidadePedidos: 1 },
    { produtoId: "A", quantidadeFaltante: 15, quantidadePedidos: 2 },
  ]);
  assert.deepEqual(result.resumo, { quantidadePedidos: 2, quantidadeProdutos: 2, quantidadeFaltante: 35 });
  assert.equal(result.pedidos[0].itens.length, 3);
  assert.equal(result.pedidos[1].itens.length, 1);
});

test("necessidade usa quantidade separada independentemente da conferência", () => {
  for (const [extra, faltante] of [
    [{ quantidadeSeparada: 0 }, 10], [{ quantidadeSeparada: 4 }, 6],
    [{ quantidadeSeparada: 8, quantidadeFinal: 3 }, 2], [{ quantidadeSeparada: 8, quantidadeFinal: 0 }, 2],
    [{ quantidadeSeparada: 4, quantidadeConferida: 9 }, 6],
  ]) {
    const original = item("A", 10, extra);
    const result = calcularNecessidadeProducao([pedido("1", [original], { status: "separando" })]);
    assert.equal(result.pedidos[0].itens[0].quantidadeAtendida, extra.quantidadeSeparada);
    assert.equal(result.produtos[0].quantidadeFaltante, faltante);
  }
});

test("pedido iniciado inclui itens pendentes e sem registro, inclusive em separação reaberta", () => {
  for (const quantidadeSeparada of [undefined, null, 0, "", NaN]) {
    const result = calcularNecessidadeProducao([pedido("1", [
      item("A", 10, { quantidadeSeparada: 5 }),
      item("B", 20, { quantidadeSeparada, situacaoSeparacao: "pendente" }),
      item("C", 30, { quantidadeSeparada, quantidadeFinal: 0 }),
    ], { status: "separando" })]);
    assert.equal(result.resumo.quantidadeFaltante, 55);
    assert.equal(result.pedidos[0].itens.length, 3);
    assert.equal(result.produtos.length, 3);
  }
  assert.equal(calcularNecessidadeProducao([pedido("1", [item("A", 10)], { status: "separando" })]).resumo.quantidadeFaltante, 10);
});

test("quantidades completas/excedentes não geram demanda nem compensam faltas de outros pedidos", () => {
  const result = calcularNecessidadeProducao([
    pedido("1", [item("A", 10, { quantidadeSeparada: 20 })], { status: "separando" }),
    pedido("2", [item("A", 10, { quantidadeSeparada: 4 })], { status: "separando" }),
    pedido("3", [item("B", 10, { quantidadeSeparada: 0, quantidadeFinal: 10 })], { status: "separado" }),
  ]);
  assert.equal(result.resumo.quantidadeFaltante, 6);
  assert.equal(result.resumo.quantidadePedidos, 1);
});

test("não reabre demanda de pedido entregue com status inconsistente", () => {
  for (const extra of [{ dataEntrega: new Date() }, { historicoStatus: [{ novoStatus: "entregue" }] }]) {
    assert.equal(calcularNecessidadeProducao([pedido("1", [item("A", 10, { quantidadeSeparada: 0 })], { status: "separando", ...extra })]).resumo.quantidadeFaltante, 0);
  }
});

for (const status of ["retirado", "enviado"]) {
  test(`${status} elimina toda a demanda mesmo com itens faltantes, pendentes ou sem registro`, () => {
    const itens = [
      item("A", 10, { quantidadeSeparada: 4 }),
      item("B", 20, { quantidadeSeparada: 0, situacaoSeparacao: "pendente" }),
      item("C", 30),
    ];
    const ativo = pedido("saida", itens, { status: "separando" });
    assert.equal(calcularNecessidadeProducao([ativo]).resumo.quantidadeFaltante, 56);
    const concluido = { ...ativo, status, historicoStatus: [
      { novoStatus: "separando", alteradoEm: "2026-10-05T10:00:00Z" },
      { novoStatus: status, alteradoEm: "2026-10-05T14:00:00Z" },
    ] };
    const before = structuredClone(concluido);
    assert.deepEqual(calcularNecessidadeProducao([concluido]), {
      produtos: [], pedidos: [], resumo: { quantidadePedidos: 0, quantidadeProdutos: 0, quantidadeFaltante: 0 },
    });
    assert.deepEqual(concluido, before);
  });
}

test("retirado não soma nem compensa faltas de pedidos ativos do mesmo produto", () => {
  const result = calcularNecessidadeProducao([
    pedido("retirado", [item("A", 100, { quantidadeSeparada: 0 }), item("B", 100)], { status: "retirado" }),
    pedido("ativo", [item("A", 10, { quantidadeSeparada: 4 })], { status: "separando" }),
  ]);
  assert.deepEqual(result.resumo, { quantidadePedidos: 1, quantidadeProdutos: 1, quantidadeFaltante: 6 });
  assert.deepEqual(result.pedidos.map((entry) => entry._id), ["ativo"]);
  assert.deepEqual(result.produtos.map(({ produtoId, quantidadeFaltante, quantidadePedidos }) => ({ produtoId, quantidadeFaltante, quantidadePedidos })), [
    { produtoId: "A", quantidadeFaltante: 6, quantidadePedidos: 1 },
  ]);
});

test("retiradoEm ou histórico de retirada não reabrem necessidade com status inconsistente", () => {
  for (const extra of [
    { retiradoEm: new Date("2026-10-05T14:00:00Z") },
    { historicoStatus: [{ novoStatus: "retirado", alteradoEm: "2026-10-05T14:00:00Z" }] },
  ]) {
    const result = calcularNecessidadeProducao([pedido("retirado", [item("A", 10, { quantidadeSeparada: 0 })], { status: "separando", ...extra })]);
    assert.deepEqual(result.resumo, { quantidadePedidos: 0, quantidadeProdutos: 0, quantidadeFaltante: 0 });
    assert.deepEqual(result.pedidos, []);
    assert.deepEqual(result.produtos, []);
  }
});

test("API de produção projeta retiradoEm e exclui a retirada mesmo sem histórico carregado", async (t) => {
  const original = pedido("retirado", [item("A", 10, { quantidadeSeparada: 0 })], {
    status: "separando", retiradoEm: new Date("2026-10-05T14:00:00Z"),
  });
  t.mock.method(Pedido, "find", (filter) => {
    assert.deepEqual(filter, { status: { $in: ["separando"] } });
    let projected;
    return {
      select(fields) {
        projected = Object.fromEntries(Object.entries(original).filter(([field]) => fields.split(" ").includes(field) || field === "itens"));
        return this;
      },
      lean() { return this; },
      maxTimeMS() { return Promise.resolve([projected]); },
    };
  });
  const response = {
    set(name, value) { assert.equal(name, "Cache-Control"); assert.equal(value, "no-store"); },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await obterNecessidadeProducao({}, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { produtos: [], pedidos: [], resumo: { quantidadePedidos: 0, quantidadeProdutos: 0, quantidadeFaltante: 0 } });
});

test("consolidação não corta a demanda na primeira página, não une nomes iguais e não altera documentos", () => {
  const pedidos = Array.from({ length: 60 }, (_, i) => pedido(String(i), [item(i % 2 ? "A" : "B", 2, { nomeProduto: "Mesmo nome", quantidadeSeparada: 0 })], { status: "separando" }));
  const before = structuredClone(pedidos);
  const result = calcularNecessidadeProducao(pedidos);
  assert.deepEqual(result.resumo, { quantidadePedidos: 60, quantidadeProdutos: 2, quantidadeFaltante: 120 });
  assert.equal(result.produtos[0].quantidadePedidos, 30);
  assert.deepEqual(pedidos, before);
});
