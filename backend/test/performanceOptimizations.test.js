import test from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";
import { criarPipelineClientes } from "../src/controllers/clienteController.js";
import { executarConsultasEmLotes } from "../src/controllers/dashboardController.js";
import { criarPipelinePrecosPorTabela } from "../src/controllers/precoProdutoController.js";
import { sanitizePerformancePath } from "../src/utils/performance.js";

test("instrumentacao remove query strings e ids dos caminhos", () => {
  assert.equal(
    sanitizePerformancePath(
      "/api/precos/tabela/6a30776bb1e48bd024a5db13?interno=segredo"
    ),
    "/api/precos/tabela/:id"
  );
});

test("pipeline de clientes preserva defaults e remove dados sensiveis", () => {
  const pipeline = criarPipelineClientes();
  const serialized = JSON.stringify(pipeline);
  const lookup = pipeline.find((stage) => stage.$lookup).$lookup;
  const unset = pipeline.find((stage) => stage.$unset).$unset;

  assert.equal(lookup.from, "tabelaprecos");
  assert.equal(lookup.as, "tabelaPrecoRelacionada");
  assert.match(serialized, /distribuidor/);
  assert.match(serialized, /statusCadastro/);
  assert.match(serialized, /pendente/);
  assert.deepEqual(unset, [
    "senha",
    "tokenVersion",
    "tabelaPrecoRelacionada",
  ]);
});

test("pipeline de clientes pendentes mantem o filtro administrativo", () => {
  assert.deepEqual(criarPipelineClientes({ pendentes: true })[0], {
    $match: { tipo: "cliente", statusCadastro: "pendente" },
  });
});

test("pipeline de precos converte o id e faz lookup dos produtos", () => {
  const tabelaPrecoId = new Types.ObjectId();
  const pipeline = criarPipelinePrecosPorTabela(String(tabelaPrecoId));

  assert.equal(
    String(pipeline[0].$match.tabelaPrecoId),
    String(tabelaPrecoId)
  );
  assert.equal(pipeline[1].$lookup.from, "produtos");
  assert.equal(pipeline[1].$lookup.as, "produto");
  assert.match(JSON.stringify(pipeline), /ativo/);
});

test("dashboard limita concorrencia e preserva a ordem dos resultados", async () => {
  let concorrencia = 0;
  let concorrenciaMaxima = 0;
  const consultas = Array.from({ length: 7 }, (_, indice) => async () => {
    concorrencia += 1;
    concorrenciaMaxima = Math.max(concorrenciaMaxima, concorrencia);
    await new Promise((resolve) => setTimeout(resolve, 2));
    concorrencia -= 1;
    return indice;
  });

  const resultados = await executarConsultasEmLotes(consultas, 2);

  assert.deepEqual(resultados, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(concorrenciaMaxima, 2);
});
