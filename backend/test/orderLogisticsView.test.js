import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Pedido from "../src/models/Pedido.js";
import { buscarPedidoLogistica, atualizarPedidoLogistica } from "../src/controllers/logisticaController.js";
import { enrichInternalOrderDetail } from "../src/utils/pedidoLogistica.js";
import { applyAdminOrderEdit } from "../src/utils/pedidoEdicaoAdmin.js";
import { buildSeparationPdfData } from "../src/services/pdfSeparacaoService.js";

const id = (n) => new mongoose.Types.ObjectId(n.toString(16).padStart(24, "0"));
const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; },
});
const query = (pedido) => ({
  select() { return this; }, lean() { return this; }, maxTimeMS() { return this; },
  then(resolve, reject) { return Promise.resolve(pedido).then(resolve, reject); },
});
const makeOrder = () => ({
  _id: id(1), __v: 2, numeroPedido: "AP-TESTE", status: "separando", versaoOperacional: 1,
  nomeFantasiaCliente: "Distribuidor", clienteId: id(2), tabelaPrecoId: id(3), nomeTabela: "Tabela",
  createdAt: new Date("2026-09-01T12:00:00Z"), valorTotal: 123.45,
  itens: [{ produtoId: id(4), nomeProduto: "Shampoo", quantidade: 5, quantidadeSeparada: 3, valorUnitario: 24.69, subtotal: 123.45 }],
  historicoAlteracoes: [{
    alteradoEm: new Date("2026-09-02T12:00:00Z"), usuarioId: id(5), usuarioNome: "Admin", usuarioTipo: "admin",
    versaoOperacionalAnterior: 1, versaoOperacionalNova: 2, totalAnterior: 74.07, totalNovo: 123.45,
    itens: [{ produtoId: id(4), nomeProduto: "Shampoo", tipo: "quantidade_alterada", quantidadeAnterior: 3, quantidadeNova: 5,
      valorUnitarioAnterior: 24.69, valorUnitarioNovo: 24.69, subtotalAnterior: 74.07, subtotalNovo: 123.45 }],
  }],
  ocorrencias: [{ tipo: "informacao_operacional", criadaEm: new Date("2026-09-02T12:00:00Z"),
    conteudo: "Pedido alterado: 1 alteração(ões) de item; total de R$ 74.07 para R$ 123.45. Separação e conferência foram reconciliadas com a versão atual." }],
});
const assertOperational = (view) => {
  const json = JSON.stringify(view);
  assert.doesNotMatch(json, /valorUnitario|subtotal|valorTotal|totalAnterior|totalNovo|tabelaPrecoId|nomeTabela|R\$|24[.,]69|74[.,]07|123[.,]45/);
  assert.equal(view.itens[0].nomeProduto, "Shampoo");
  assert.equal(view.itens[0].quantidade, 5);
  assert.equal(view.__v, 2);
  assert.ok(view.historicoPedido.some((entry) => entry.detalhes?.includes("3 -> 5")));
};

for (const tipo of ["logistica", "admin"]) {
  test(`GET e PATCH preservam a visibilidade financeira do perfil ${tipo}`, async (t) => {
    const pedido = makeOrder();
    pedido.save = async () => pedido;
    t.mock.method(Pedido, "findById", () => query(pedido));
    const req = { params: { id: String(pedido._id) }, usuario: { _id: id(5), tipo },
      operadorLogistica: { _id: id(6), nome: "Operador" },
      body: { versaoPedido: 2, separacaoItens: [{ produtoId: String(id(4)), quantidadeSeparada: 5 }] } };
    for (const handler of [buscarPedidoLogistica, atualizarPedidoLogistica]) {
      const res = response();
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      if (tipo === "logistica") assertOperational(res.body.pedido);
      else {
        assert.equal(res.body.pedido.valorTotal, 123.45);
        assert.equal(res.body.pedido.itens[0].valorUnitario, 24.69);
        assert.equal(res.body.pedido.historicoAlteracoes[0].totalNovo, 123.45);
        assert.ok(res.body.pedido.historicoPedido.some((entry) => entry.detalhes?.includes("R$")));
      }
    }
    assert.equal(pedido.valorTotal, 123.45);
    assert.equal(pedido.itens[0].valorUnitario, 24.69);
    assert.equal(pedido.historicoAlteracoes[0].totalNovo, 123.45);
  });
}

test("resposta da edição calcula faltante ao adicionar item e ao igualar pedido e separação", () => {
  const pedido = makeOrder();
  const existing = { ...pedido.itens[0], quantidade: 3, subtotal: 74.07 };
  const added = { produtoId: id(7), nomeProduto: "Condicionador", quantidade: 10, valorUnitario: 10, subtotal: 100 };
  applyAdminOrderEdit({ pedido, itensPedido: [existing, added], valorTotal: 174.07, usuario: { _id: id(5), tipo: "admin" } });
  const detail = enrichInternalOrderDetail(pedido);
  assert.equal(detail.itens[0].quantidadeFaltante, 0);
  assert.equal(detail.itens[0].quantidadeFaltanteSeparacao, 0);
  assert.equal(detail.itens[1].quantidadeFaltante, 10);
  assert.equal(detail.itens[1].quantidadeFaltanteSeparacao, 10);
  assert.equal(pedido.itens[1].quantidadeSeparada, 0);
  assert.equal(detail.itens[1].quantidadeSeparada, 0);
  assert.equal(detail.itens[1].situacaoSeparacao, "pendente");
  assert.equal(detail.temItemNaoProcessado, true);
});

test("API calcula faltante pela separação e preserva quantidade final como informação distinta", () => {
  const pedido = makeOrder();
  pedido.itens[0].quantidadeSeparada = 5;
  pedido.itens[0].quantidadeFinal = 4;
  const detail = enrichInternalOrderDetail(pedido);
  assert.equal(detail.itens[0].quantidadeFaltante, 0);
  assert.equal(detail.itens[0].quantidadeFaltanteSeparacao, 0);
  assert.equal(detail.itens[0].quantidadeFinal, 4);
});

test("PDF de separação contém somente produtos e quantidades", () => {
  const data = buildSeparationPdfData(makeOrder());
  assert.deepEqual(data.itens, [{ nomeProduto: "Shampoo", quantidade: 5 }]);
  assert.doesNotMatch(JSON.stringify(data), /valor|subtotal|preco|R\$/i);
});
