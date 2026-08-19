import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import BannerMarketing from "../src/models/BannerMarketing.js";
import MaterialMarketing from "../src/models/MaterialMarketing.js";
import Usuario from "../src/models/Usuario.js";
import {
  somenteAdmin,
  somenteGestorConteudo,
} from "../src/middlewares/adminMiddleware.js";
import bannerClientRouter from "../src/routes/bannerMarketingRoutes.js";
import bannerManagementRouter from "../src/routes/marketingBannerRoutes.js";
import marketingRouter from "../src/routes/marketingRoutes.js";
import { buildClientBannerFilter } from "../src/controllers/bannerMarketingController.js";
import {
  alterarStatusBanner,
  atualizarBanner,
  excluirBanner,
} from "../src/controllers/bannerMarketingController.js";
import { buildClientMaterialVisibilityFilter } from "../src/controllers/materialMarketingController.js";
import { validateBannerPayload } from "../src/utils/bannerMarketingValidation.js";
import {
  buildAudienceFilter,
  validateAudiencePayload,
} from "../src/utils/contentAudience.js";

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("schema de usuario aceita o papel marketing", () => {
  const enumValues = Usuario.schema.path("tipo").enumValues;
  assert.deepEqual(enumValues, ["admin", "comercial", "marketing", "logistica", "cliente", "groomer"]);
});

test("marketing acessa somente a gestao de conteudo, nao rotas admin", () => {
  const marketingResponse = createResponse();
  let marketingAllowed = false;
  somenteGestorConteudo(
    { usuario: { tipo: "marketing" } },
    marketingResponse,
    () => { marketingAllowed = true; }
  );
  assert.equal(marketingAllowed, true);

  const adminResponse = createResponse();
  let adminRouteCalled = false;
  somenteAdmin(
    { usuario: { tipo: "marketing" } },
    adminResponse,
    () => { adminRouteCalled = true; }
  );
  assert.equal(adminResponse.statusCode, 403);
  assert.equal(adminRouteCalled, false);

  const clientResponse = createResponse();
  somenteGestorConteudo(
    { usuario: { tipo: "cliente" } },
    clientResponse,
    () => assert.fail("cliente nao pode gerenciar conteudo")
  );
  assert.equal(clientResponse.statusCode, 403);

  const commercialResponse = createResponse();
  somenteGestorConteudo(
    { usuario: { tipo: "comercial" } },
    commercialResponse,
    () => assert.fail("comercial nao pode gerenciar conteudo")
  );
  assert.equal(commercialResponse.statusCode, 403);
});

test("rotas de marketing e banners aplicam os papeis corretos", () => {
  assert.deepEqual(
    marketingRouter.stack.slice(0, 2).map((layer) => layer.name),
    ["proteger", "somenteGestorConteudo"]
  );
  assert.deepEqual(
    bannerManagementRouter.stack.slice(0, 2).map((layer) => layer.name),
    ["proteger", "somenteGestorConteudo"]
  );
  const clientRoute = bannerClientRouter.stack.find((layer) => layer.route?.path === "/");
  assert.deepEqual(
    clientRoute.route.stack.map((layer) => layer.name),
    ["proteger", "somenteCliente", "listarBannersCliente"]
  );
});

test("audiencia especifica exige IDs validos e o filtro inclui apenas o cliente", () => {
  const clientId = new mongoose.Types.ObjectId();
  const valid = validateAudiencePayload({
    audienciaTipo: "especificos",
    distribuidoresIds: JSON.stringify([clientId.toString()]),
  });
  assert.equal(Object.keys(valid.errors).length, 0);
  assert.deepEqual(valid.data.distribuidoresIds, [clientId.toString()]);

  const empty = validateAudiencePayload({
    audienciaTipo: "especificos",
    distribuidoresIds: [],
  });
  assert.equal(Boolean(empty.errors.distribuidoresIds), true);

  const audienceFilter = buildAudienceFilter(clientId);
  assert.equal(audienceFilter.$or.at(-1).distribuidoresIds, clientId);
  assert.equal(audienceFilter.$or.at(-1).audienciaTipo, "especificos");
});

test("filtros do cliente exigem status, data e audiencia", () => {
  const clientId = new mongoose.Types.ObjectId();
  const now = new Date("2026-08-07T12:00:00.000Z");
  const materials = buildClientMaterialVisibilityFilter(clientId, now);
  const banners = buildClientBannerFilter(clientId, now);

  assert.equal(materials.ativo, true);
  assert.equal(materials.$and.length, 2);
  assert.equal(banners.ativo, true);
  assert.equal(banners.$and.length, 3);
  assert.equal(banners.$and.at(-1).$or.at(-1).distribuidoresIds, clientId);
});

test("banner valida datas, audiencia e ignora campos internos", () => {
  const valid = validateBannerPayload({
    tituloInterno: "Campanha de inverno",
    link: "https://drive.google.com/example",
    ativo: true,
    ordem: 1,
    audienciaTipo: "todos",
    distribuidoresIds: [],
    imagemUrl: "https://forjado.example/imagem.jpg",
    criadoPor: "forjado",
  }, { nodeEnv: "production" });

  assert.equal(valid.valid, true);
  assert.equal(Object.hasOwn(valid.data, "imagemUrl"), false);
  assert.equal(Object.hasOwn(valid.data, "criadoPor"), false);

  const invalidDates = validateBannerPayload({
    tituloInterno: "Campanha",
    dataInicial: "2026-08-10",
    dataFinal: "2026-08-01",
    audienciaTipo: "todos",
  });
  assert.equal(Boolean(invalidDates.errors.dataFinal), true);
});

test("materiais continuam usando link do Drive sem upload de documento", () => {
  assert.equal(MaterialMarketing.schema.path("linkExterno").isRequired, true);
  assert.equal(MaterialMarketing.schema.path("arquivoUrl"), undefined);
  assert.equal(MaterialMarketing.schema.path("arquivoPublicId"), undefined);
  assert.equal(BannerMarketing.schema.path("imagemUrl").isRequired, true);
});

test("edicao de banner preserva imagem e ignora autoria enviada", async (t) => {
  const originalFindById = BannerMarketing.findById;
  const document = {
    tituloInterno: "Anterior",
    audienciaTipo: "todos",
    distribuidoresIds: [],
    imagemUrl: "https://example.com/banner.jpg",
    imagemPublicId: "atualpet/banners/banner",
    criadoPor: "autor-original",
    save: async () => {},
  };
  BannerMarketing.findById = async () => document;
  t.after(() => { BannerMarketing.findById = originalFindById; });

  const res = createResponse();
  await atualizarBanner({
    params: { id: "banner-1" },
    body: { tituloInterno: "Atualizado", criadoPor: "forjado" },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(document.tituloInterno, "Atualizado");
  assert.equal(document.imagemUrl, "https://example.com/banner.jpg");
  assert.equal(document.criadoPor, "autor-original");
});

test("status e exclusao de banner usam somente o registro localizado", async (t) => {
  const originalFindById = BannerMarketing.findById;
  const originalFindByIdAndDelete = BannerMarketing.findByIdAndDelete;
  const document = { ativo: true, imagemPublicId: "", save: async () => {} };
  BannerMarketing.findById = async () => document;
  BannerMarketing.findByIdAndDelete = async () => document;
  t.after(() => {
    BannerMarketing.findById = originalFindById;
    BannerMarketing.findByIdAndDelete = originalFindByIdAndDelete;
  });

  const statusResponse = createResponse();
  await alterarStatusBanner({
    params: { id: "banner-1" },
    body: { ativo: false },
  }, statusResponse);
  assert.equal(statusResponse.statusCode, 200);
  assert.equal(document.ativo, false);

  const deleteResponse = createResponse();
  await excluirBanner({ params: { id: "banner-1" } }, deleteResponse);
  assert.equal(deleteResponse.statusCode, 200);
});
