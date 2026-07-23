import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildImageFormData,
  IMAGE_UPLOAD_MAX_BYTES,
  validateImageFile,
} from "../src/utils/imageUpload.js";

const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const createFile = (overrides = {}) => ({
  name: "imagem.jpg",
  type: "image/jpeg",
  size: 1024,
  ...overrides,
});

class FormDataSpy {
  constructor() {
    this.values = [];
  }

  append(name, value) {
    this.values.push([name, value]);
  }
}

test("campo aceita JPG, PNG e WEBP", () => {
  assert.equal(validateImageFile(createFile()).valid, true);
  assert.equal(
    validateImageFile(createFile({ name: "imagem.png", type: "image/png" })).valid,
    true
  );
  assert.equal(
    validateImageFile(createFile({ name: "imagem.webp", type: "image/webp" })).valid,
    true
  );
});

test("campo rejeita formato inválido, extensão falsa e arquivo grande", () => {
  assert.equal(
    validateImageFile(createFile({ name: "imagem.svg", type: "image/svg+xml" })).valid,
    false
  );
  assert.equal(
    validateImageFile(createFile({ name: "imagem.svg", type: "image/png" })).valid,
    false
  );
  assert.equal(
    validateImageFile(createFile({ size: IMAGE_UPLOAD_MAX_BYTES + 1 })).valid,
    false
  );
});

test("FormData inclui o arquivo somente quando selecionado", () => {
  const file = createFile();
  const withFile = buildImageFormData(
    { titulo: "Treinamento", ativo: true },
    {
      file,
      fileField: "thumbnail",
      formData: new FormDataSpy(),
      removeField: "removerThumbnail",
    }
  );
  assert.deepEqual(withFile.values, [
    ["titulo", "Treinamento"],
    ["ativo", "true"],
    ["thumbnail", file],
  ]);

  const withoutFile = buildImageFormData(
    { titulo: "Treinamento" },
    {
      fileField: "thumbnail",
      formData: new FormDataSpy(),
      removeField: "removerThumbnail",
    }
  );
  assert.equal(
    withoutFile.values.some(([name]) => name === "thumbnail"),
    false
  );
});

test("FormData sinaliza remoção sem apagar imagem durante substituição", () => {
  const remove = buildImageFormData(
    { titulo: "Treinamento" },
    {
      fileField: "thumbnail",
      formData: new FormDataSpy(),
      remove: true,
      removeField: "removerThumbnail",
    }
  );
  assert.deepEqual(remove.values.at(-1), ["removerThumbnail", "true"]);

  const replace = buildImageFormData(
    { titulo: "Treinamento" },
    {
      file: createFile(),
      fileField: "thumbnail",
      formData: new FormDataSpy(),
      remove: true,
      removeField: "removerThumbnail",
    }
  );
  assert.equal(
    replace.values.some(([name]) => name === "removerThumbnail"),
    false
  );
});

test("preview cria URL temporária e revoga a anterior e no unmount", () => {
  const source = readSource(
    "../src/components/ImageUploadField/ImageUploadField.jsx"
  );

  assert.match(source, /URL\.createObjectURL\(nextFile\)/);
  assert.ok((source.match(/URL\.revokeObjectURL/g) || []).length >= 3);
  assert.match(source, /currentUrl/);
  assert.match(source, /fallbackUrl/);
});

test("formulários usam FormData sem definir Content-Type manualmente", () => {
  const training = readSource(
    "../src/pages/AdminTreinamentos/AdminTreinamentos.jsx"
  );
  const material = readSource(
    "../src/pages/AdminMateriaisMarketing/AdminMateriaisMarketing.jsx"
  );

  assert.match(training, /buildImageFormData/);
  assert.match(material, /buildImageFormData/);
  assert.match(training, /fileField: "thumbnail"/);
  assert.match(material, /fileField: "imagemCapa"/);
  assert.doesNotMatch(`${training}\n${material}`, /Content-Type/);
  assert.doesNotMatch(training, /URL personalizada da thumbnail/);
  assert.doesNotMatch(material, /URL da imagem de capa/);
});

test("todas as listagens auditadas usam a toolbar compartilhada", () => {
  const pages = [
    "Catalogo/Catalogo.jsx",
    "PrecosClienteFinal/PrecosClienteFinal.jsx",
    "MateriaisMarketing/MateriaisMarketing.jsx",
    "Treinamentos/Treinamentos.jsx",
    "AdminProdutos/AdminProdutos.jsx",
    "AdminClientes/AdminClientes.jsx",
    "AdminPedidos/AdminPedidos.jsx",
    "AdminPrecos/AdminPrecos.jsx",
    "AdminMateriaisMarketing/AdminMateriaisMarketing.jsx",
    "AdminTreinamentos/AdminTreinamentos.jsx",
  ];

  for (const page of pages) {
    const source = readSource(`../src/pages/${page}`);
    assert.match(source, /FilterToolbar/, page);
    assert.doesNotMatch(
      source,
      /styles\.(filtros|filters|toolbar|filterControls|filterActions)/,
      page
    );
  }
});

test("toolbar móvel expõe contador, aria e fechamento por Escape", () => {
  const source = readSource(
    "../src/components/ListControls/ListControls.jsx"
  );
  const css = readSource(
    "../src/components/ListControls/ListControls.module.css"
  );

  assert.match(source, /activeFilterCount/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /aria-controls/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, />\s*Limpar\s*</);
  assert.match(css, /max-width: 760px/);
  assert.match(css, /filterControls\[data-open="false"\]/);
});
