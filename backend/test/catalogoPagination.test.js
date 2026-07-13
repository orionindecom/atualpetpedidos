import test from "node:test";
import assert from "node:assert/strict";
import {
  formatCatalogResponse,
  isLegacyCatalogRequest,
  parseCatalogQuery,
} from "../src/controllers/catalogoController.js";

test("usa paginacao padrao sem parametros", () => {
  assert.deepEqual(parseCatalogQuery({}), {
    pagina: 1,
    limite: 12,
    busca: "",
    linha: "",
    categoria: "",
  });
});

test("normaliza paginacao e filtros validos", () => {
  assert.deepEqual(
    parseCatalogQuery({
      pagina: "2",
      limite: "24",
      busca: "  shampoo  ",
      linha: " Dream Color ",
      categoria: " Shampoo ",
    }),
    {
      pagina: 2,
      limite: 24,
      busca: "shampoo",
      linha: "Dream Color",
      categoria: "Shampoo",
    }
  );
});

test("rejeita limites excessivos e paginas invalidas", () => {
  assert.equal(parseCatalogQuery({ pagina: "0" }), null);
  assert.equal(parseCatalogQuery({ pagina: "abc" }), null);
  assert.equal(parseCatalogQuery({ limite: "49" }), null);
});

test("rejeita filtros acima do tamanho maximo", () => {
  assert.equal(parseCatalogQuery({ busca: "a".repeat(121) }), null);
});

test("mantem resposta legada em array sem parametros de paginacao", () => {
  const produtos = [{ id: "produto-1" }];

  assert.equal(isLegacyCatalogRequest({ busca: "shampoo" }), true);
  assert.deepEqual(formatCatalogResponse({ legacy: true, produtos }), produtos);
});

test("retorna objeto quando pagina ou limite for enviado", () => {
  const produtos = [{ id: "produto-1" }];
  const paginacao = { pagina: 1, limite: 12, total: 1, temMais: false };
  const filtros = { linhas: [], categorias: [] };

  assert.equal(isLegacyCatalogRequest({ pagina: "1" }), false);
  assert.equal(isLegacyCatalogRequest({ limite: "12" }), false);
  assert.deepEqual(
    formatCatalogResponse({ legacy: false, produtos, paginacao, filtros }),
    { produtos, paginacao, filtros }
  );
});
