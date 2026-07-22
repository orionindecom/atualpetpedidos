import test from "node:test";
import assert from "node:assert/strict";
import MaterialMarketing from "../src/models/MaterialMarketing.js";
import adminRouter from "../src/routes/adminMaterialMarketingRoutes.js";
import clientRouter from "../src/routes/materialMarketingRoutes.js";
import { proteger } from "../src/middlewares/authMiddleware.js";
import { somenteAdmin } from "../src/middlewares/adminMiddleware.js";
import {
  alterarStatusMaterial,
  atualizarMaterial,
  criarMaterial,
} from "../src/controllers/materialMarketingController.js";
import {
  buildMaterialFilter,
  isSafeExternalUrl,
  MATERIAL_SORT,
  parseMaterialQuery,
  validateMaterialPayload,
} from "../src/utils/materialMarketingValidation.js";

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const validPayload = {
  titulo: "Fotos Linha Zoom",
  descricao: "Imagens oficiais para redes sociais",
  categoria: "Fotos de Produtos",
  tipo: "Imagem",
  marca: "AtualPet",
  linha: "Zoom",
  linkExterno: "https://drive.google.com/example",
  imagemCapaUrl: "https://images.example.com/zoom.jpg",
  destaque: true,
  ordem: 2,
  ativo: true,
};

test("rota do cliente exige autenticacao", async () => {
  const res = createResponse();
  let nextCalled = false;

  await proteger({ headers: {} }, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
  const clientRoute = clientRouter.stack.find((layer) => layer.route?.path === "/");
  assert.deepEqual(
    clientRoute.route.stack.map((layer) => layer.name),
    ["proteger", "listarMateriaisCliente"]
  );
});

test("cliente nao passa pelo middleware administrativo", () => {
  const res = createResponse();
  let nextCalled = false;

  somenteAdmin({ usuario: { tipo: "cliente" } }, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
  assert.deepEqual(
    adminRouter.stack.slice(0, 2).map((layer) => layer.name),
    ["proteger", "somenteAdmin"]
  );
});

test("cliente consulta somente materiais ativos", () => {
  const query = parseMaterialQuery({ categoria: "Catalogos", ativo: "false" });
  const filter = buildMaterialFilter(query, { onlyActive: true });

  assert.equal(filter.ativo, true);
  assert.equal(filter.categoria, "Catalogos");
});

test("valida URLs e recusa protocolos inseguros", () => {
  assert.equal(isSafeExternalUrl("https://example.com", { nodeEnv: "production" }), true);
  assert.equal(isSafeExternalUrl("http://localhost:5173", { nodeEnv: "development" }), true);
  assert.equal(isSafeExternalUrl("http://example.com", { nodeEnv: "production" }), false);
  assert.equal(isSafeExternalUrl("javascript:alert(1)", { nodeEnv: "development" }), false);
  assert.equal(isSafeExternalUrl("data:text/plain,teste", { nodeEnv: "development" }), false);
});

test("valida obrigatorios, limite e campos desconhecidos", () => {
  const empty = validateMaterialPayload({}, { nodeEnv: "production" });
  const nullBody = validateMaterialPayload(null, { nodeEnv: "production" });
  assert.equal(empty.valid, false);
  assert.equal(nullBody.valid, false);
  assert.deepEqual(Object.keys(empty.errors).sort(), [
    "categoria",
    "linkExterno",
    "tipo",
    "titulo",
  ]);

  const validated = validateMaterialPayload(
    { ...validPayload, admin: true, criadoPor: "forjado", campoInterno: "x" },
    { nodeEnv: "production" }
  );
  assert.equal(validated.valid, true);
  assert.equal(Object.hasOwn(validated.data, "admin"), false);
  assert.equal(Object.hasOwn(validated.data, "criadoPor"), false);
  assert.equal(Object.hasOwn(validated.data, "campoInterno"), false);
  assert.equal(parseMaterialQuery({ limite: "101" }), null);
});

test("busca, filtros e ordenacao usam os criterios esperados", () => {
  const query = parseMaterialQuery({
    busca: "Zoom (2026)",
    categoria: "Fotos de Produtos",
    tipo: "Imagem",
    marca: "AtualPet",
    linha: "Zoom",
    destaque: "true",
  });
  const filter = buildMaterialFilter(query, { onlyActive: true });

  assert.equal(filter.ativo, true);
  assert.equal(filter.destaque, true);
  assert.equal(filter.$or.length, 6);
  assert.equal(filter.$or[0].titulo.test("Zoom (2026)"), true);
  assert.deepEqual(MATERIAL_SORT, {
    destaque: -1,
    ordem: 1,
    createdAt: -1,
    _id: 1,
  });
  assert.equal(
    MaterialMarketing.schema.indexes().some(([fields]) =>
      JSON.stringify(fields) === JSON.stringify({
        ativo: 1,
        destaque: -1,
        ordem: 1,
        createdAt: -1,
        _id: 1,
      })
    ),
    true
  );
});

test("administrador cria material valido com autoria do token", async (t) => {
  const originalCreate = MaterialMarketing.create;
  let received;
  MaterialMarketing.create = async (payload) => {
    received = payload;
    return { _id: "material-1", ...payload };
  };
  t.after(() => {
    MaterialMarketing.create = originalCreate;
  });

  const req = {
    body: { ...validPayload, criadoPor: "forjado", tokenVersion: 99 },
    usuario: { _id: "admin-1" },
  };
  const res = createResponse();

  await criarMaterial(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(received.criadoPor, "admin-1");
  assert.equal(Object.hasOwn(received, "tokenVersion"), false);
});

test("administrador edita apenas campos permitidos", async (t) => {
  const originalFindById = MaterialMarketing.findById;
  const document = { titulo: "Antigo", ativo: true, saveCalled: false };
  document.save = async () => {
    document.saveCalled = true;
  };
  MaterialMarketing.findById = async () => document;
  t.after(() => {
    MaterialMarketing.findById = originalFindById;
  });

  const res = createResponse();
  await atualizarMaterial(
    {
      params: { id: "material-1" },
      body: { titulo: "Novo titulo", criadoPor: "forjado", admin: true },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(document.titulo, "Novo titulo");
  assert.equal(Object.hasOwn(document, "criadoPor"), false);
  assert.equal(Object.hasOwn(document, "admin"), false);
  assert.equal(document.saveCalled, true);
});

test("administrador ativa e desativa um material", async (t) => {
  const originalFindById = MaterialMarketing.findById;
  const document = { ativo: true, save: async () => {} };
  MaterialMarketing.findById = async () => document;
  t.after(() => {
    MaterialMarketing.findById = originalFindById;
  });

  const disableResponse = createResponse();
  await alterarStatusMaterial(
    { params: { id: "material-1" }, body: { ativo: false } },
    disableResponse
  );
  assert.equal(disableResponse.statusCode, 200);
  assert.equal(document.ativo, false);

  const enableResponse = createResponse();
  await alterarStatusMaterial(
    { params: { id: "material-1" }, body: { ativo: true } },
    enableResponse
  );
  assert.equal(enableResponse.statusCode, 200);
  assert.equal(document.ativo, true);
});
