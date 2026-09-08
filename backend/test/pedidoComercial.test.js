import test from "node:test";
import assert from "node:assert/strict";
import Pedido from "../src/models/Pedido.js";
import Produto from "../src/models/Produto.js";
import PrecoProduto from "../src/models/PrecoProduto.js";
import { atualizarPedidoAdmin, excluirPedidoAdmin, buscarPedidoPorId, listarTodosPedidos } from "../src/controllers/pedidoController.js";

const id = "507f1f77bcf86cd799439011";
const produtoId = "507f1f77bcf86cd799439012";
const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const query = (value) => ({
  select() { return this; }, lean() { return this; }, sort() { return this; },
  maxTimeMS() { return Promise.resolve(value); },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});
const makeOrder = () => new Pedido({
  _id: id, numeroPedido: "PED-COMERCIAL", clienteId: produtoId, tabelaPrecoId: id,
  dia: 8, mes: 9, ano: 2026, status: "separado", valorTotal: 10, __v: 0,
  itens: [{ produtoId, nomeProduto: "Shampoo", quantidade: 1, valorUnitario: 10, subtotal: 10, quantidadeSeparada: 1 }],
  conferenciaObrigatoria: true,
  conferencia: { status: "em_andamento", iniciadaEm: new Date() },
  fechamentoLogistico: { quantidadeVolumes: 1, pesoTotalKg: 2, observacaoVolumes: "Caixa", preenchidoEm: new Date(), preenchidoPor: { usuarioId: id, usuarioTipo: "logistica" } },
});

for (const tipo of ["admin", "comercial"]) {
  const usuario = { _id: id, tipo, nomeResponsavel: `Equipe ${tipo}` };

  test(`${tipo}: consulta lista e detalhes de pedido de outro usuário`, async (t) => {
    const pedido = makeOrder();
    t.mock.method(Pedido, "find", () => query([pedido.toObject()]));
    t.mock.method(Pedido, "findById", () => query(pedido));
    const list = response();
    await listarTodosPedidos({ usuario }, list);
    assert.equal(list.statusCode, 200);
    assert.equal(String(list.body[0]._id), id);
    const detail = response();
    await buscarPedidoPorId({ usuario, params: { id } }, detail);
    assert.equal(detail.statusCode, 200);
    assert.equal(String(detail.body._id), id);
  });

  test(`${tipo}: edição usa preços vigentes e persiste autoria em todos os históricos`, async (t) => {
    const pedido = makeOrder();
    let saved = false;
    t.mock.method(Pedido, "findById", () => query(pedido));
    t.mock.method(Produto, "find", () => query([{ _id: produtoId, nome: "Shampoo" }]));
    t.mock.method(PrecoProduto, "find", () => query([{ produtoId, valor: 10 }]));
    t.mock.method(pedido, "save", async () => { await pedido.validate(); saved = true; });
    const res = response();
    await atualizarPedidoAdmin({ usuario, params: { id }, body: {
      versaoPedido: 0, itens: [{ produtoId, quantidade: 2, valorUnitario: 0, quantidadeSeparada: 999 }],
      status: "faturado", numeroNotaFiscal: "INDEVIDA",
    } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(saved, true);
    assert.equal(pedido.valorTotal, 20);
    assert.equal(pedido.itens[0].quantidadeSeparada, 1);
    assert.equal(pedido.numeroNotaFiscal, undefined);
    assert.equal(pedido.status, "separando"); // Reconciliação já existente ao editar quantidades.
    const authors = [pedido.historicoAlteracoes[0], pedido.historicoConferencias[0].invalidadaPor, ...pedido.historicoStatus, ...pedido.ocorrencias];
    for (const author of authors) {
      assert.equal(author.usuarioTipo, tipo);
      assert.equal(String(author.usuarioId), id);
      assert.equal(author.usuarioNome, usuario.nomeResponsavel);
    }
  });

  test(`${tipo}: edição preserva validação, versão e bloqueio após faturamento`, async (t) => {
    const pedido = makeOrder();
    t.mock.method(Pedido, "findById", () => query(pedido));
    t.mock.method(pedido, "save", () => assert.fail("não deve salvar"));
    for (const [body, status, expected] of [
      [{ itens: [] }, "separado", 400],
      [{ itens: [{ produtoId, quantidade: 1 }], versaoPedido: 2 }, "separado", 409],
      [{ itens: [{ produtoId, quantidade: 1 }], versaoPedido: 0 }, "faturado", 409],
    ]) {
      pedido.status = status;
      const res = response();
      await atualizarPedidoAdmin({ usuario, params: { id }, body }, res);
      assert.equal(res.statusCode, expected);
    }
  });

  test(`${tipo}: exclusão preserva remoção, pedido inexistente e bloqueio de entrega`, async (t) => {
    let pedido = makeOrder();
    let deleted = 0;
    t.mock.method(Pedido, "findById", () => query(pedido));
    t.mock.method(Pedido, "findByIdAndDelete", async (target) => { assert.equal(target, id); deleted++; });
    const success = response();
    await excluirPedidoAdmin({ usuario, params: { id } }, success);
    assert.equal(success.statusCode, 200);
    assert.equal(deleted, 1);
    pedido.status = "entregue";
    const blocked = response();
    await excluirPedidoAdmin({ usuario, params: { id } }, blocked);
    assert.equal(blocked.statusCode, 409);
    pedido = null;
    const missing = response();
    await excluirPedidoAdmin({ usuario, params: { id } }, missing);
    assert.equal(missing.statusCode, 404);
    assert.equal(deleted, 1);
  });
}
