import test from "node:test";
import assert from "node:assert/strict";
import {
  appendUniqueMaterials,
  copyMaterialLink,
  isSafeMaterialLink,
  normalizeMaterialResponse,
  openMaterialLink,
} from "../src/utils/materialMarketing.js";

test("normaliza resposta paginada e valores ausentes", () => {
  const response = normalizeMaterialResponse({
    materiais: [{ _id: "1" }],
    paginacao: { paginaAtual: 2, totalItens: 13, temProximaPagina: true },
    filtros: { categorias: ["Fotos"] },
  });

  assert.equal(response.materiais.length, 1);
  assert.equal(response.paginacao.paginaAtual, 2);
  assert.equal(response.paginacao.temProximaPagina, true);
  assert.deepEqual(response.filtros.tipos, []);
});

test("mostrar mais acrescenta sem repetir materiais", () => {
  const current = [{ _id: "1" }, { _id: "2" }];
  const next = [{ _id: "2" }, { _id: "3" }];

  assert.deepEqual(appendUniqueMaterials(current, next), [
    { _id: "1" },
    { _id: "2" },
    { _id: "3" },
  ]);
});

test("abertura externa usa nova aba, noopener e noreferrer", () => {
  const calls = [];
  const openedWindow = { opener: "origin" };
  const result = openMaterialLink("https://drive.google.com/example", (...args) => {
    calls.push(args);
    return openedWindow;
  });

  assert.equal(result, true);
  assert.deepEqual(calls[0], [
    "https://drive.google.com/example",
    "_blank",
    "noopener,noreferrer",
  ]);
  assert.equal(openedWindow.opener, null);
});

test("frontend recusa links com protocolo inseguro", () => {
  assert.equal(isSafeMaterialLink("javascript:alert(1)"), false);
  assert.equal(isSafeMaterialLink("data:text/plain,teste"), false);
  assert.equal(isSafeMaterialLink("https://example.com"), true);
});

test("copia link com fallback quando Clipboard API falha", async () => {
  const textarea = {
    style: {},
    setAttribute() {},
    select() {},
  };
  const appended = [];
  const documentRef = {
    createElement: () => textarea,
    execCommand: (command) => command === "copy",
    body: {
      appendChild: (element) => appended.push(element),
      removeChild: (element) => appended.splice(appended.indexOf(element), 1),
    },
  };

  const copied = await copyMaterialLink("https://example.com/material", {
    clipboard: { writeText: async () => { throw new Error("negado"); } },
    documentRef,
  });

  assert.equal(copied, true);
  assert.equal(appended.length, 0);
});
