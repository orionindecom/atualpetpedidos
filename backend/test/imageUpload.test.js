import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import cloudinary from "../src/config/cloudinary.js";
import Treinamento from "../src/models/Treinamento.js";
import MaterialMarketing from "../src/models/MaterialMarketing.js";
import trainingRouter from "../src/routes/adminTreinamentoRoutes.js";
import materialRouter from "../src/routes/adminMaterialMarketingRoutes.js";
import {
  atualizarTreinamento,
  criarTreinamento,
} from "../src/controllers/treinamentoController.js";
import {
  atualizarMaterial,
  criarMaterial,
} from "../src/controllers/materialMarketingController.js";
import {
  allowedImageMimeTypes,
  hasAllowedImageExtension,
  hasImageSignature,
  IMAGE_UPLOAD_MAX_BYTES,
  validarAssinaturaImagem,
} from "../src/middlewares/uploadProduto.js";
import {
  validateTrainingPayload,
} from "../src/utils/trainingValidation.js";
import {
  validateMaterialPayload,
} from "../src/utils/materialMarketingValidation.js";
import { deleteImageByPublicId } from "../src/utils/cloudinaryUpload.js";

const adminId = "507f1f77bcf86cd799439011";
const trainingId = "507f1f77bcf86cd799439012";
const materialId = "507f1f77bcf86cd799439013";

const validTrainingPayload = {
  titulo: "Treinamento AtualPet",
  resumo: "Conteúdo técnico para distribuidores.",
  descricao: "",
  categoria: "Aplicação de Produtos",
  marca: "AtualPet",
  linha: "Zoom",
  instrutor: "Equipe Técnica",
  duracaoSegundos: "600",
  provider: "youtube",
  videoId: "dQw4w9WgXcQ",
  destaque: "true",
  obrigatorio: "false",
  ordem: "1",
  ativo: "true",
  publicadoEm: "2026-07-22T12:00:00.000Z",
};

const validMaterialPayload = {
  titulo: "Fotos oficiais",
  descricao: "",
  categoria: "Fotos de Produtos",
  tipo: "Imagem",
  marca: "AtualPet",
  linha: "Zoom",
  linkExterno: "https://drive.google.com/example",
  destaque: "true",
  ordem: "1",
  ativo: "true",
};

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

const imageFile = {
  buffer: Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  ]),
  mimetype: "image/jpeg",
  originalname: "thumbnail.jpg",
  size: 12,
};

const mockCloudinary = (
  t,
  {
    destroyResult = { result: "ok" },
    uploadError = null,
    uploadResult = {
      secure_url: "https://res.cloudinary.com/atualpet/image/upload/thumb.jpg",
      public_id: "atualpet/treinamentos/thumb",
    },
  } = {}
) => {
  const originalUpload = cloudinary.uploader.upload_stream;
  const originalDestroy = cloudinary.uploader.destroy;
  const destroyed = [];

  cloudinary.uploader.upload_stream = (options, callback) => {
    const stream = new Writable({
      write(chunk, encoding, done) {
        done();
      },
    });
    stream.on("finish", () => callback(uploadError, uploadResult));
    return stream;
  };
  cloudinary.uploader.destroy = async (publicId) => {
    destroyed.push(publicId);
    return destroyResult;
  };

  t.after(() => {
    cloudinary.uploader.upload_stream = originalUpload;
    cloudinary.uploader.destroy = originalDestroy;
  });

  return destroyed;
};

test("upload aceita somente JPG, PNG e WEBP com limite de 5 MB", () => {
  assert.equal(IMAGE_UPLOAD_MAX_BYTES, 5 * 1024 * 1024);
  assert.deepEqual(
    [...allowedImageMimeTypes].sort(),
    ["image/jpeg", "image/png", "image/webp"]
  );

  assert.equal(hasImageSignature(imageFile), true);
  assert.equal(hasImageSignature({
    mimetype: "image/png",
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
  }), true);
  assert.equal(hasImageSignature({
    mimetype: "image/webp",
    buffer: Buffer.from("RIFF0000WEBP"),
  }), true);
  assert.equal(hasImageSignature({
    mimetype: "image/svg+xml",
    buffer: Buffer.from("<svg></svg>"),
  }), false);
  assert.equal(hasImageSignature({
    mimetype: "image/jpeg",
    buffer: Buffer.from("arquivo corrompido"),
  }), false);
  assert.equal(hasAllowedImageExtension("FOTO.JPEG"), true);
  assert.equal(hasAllowedImageExtension("foto-sem-extensao"), true);
  assert.equal(hasAllowedImageExtension("foto.svg"), false);
});

test("assinatura inválida interrompe a request com 400", () => {
  const res = createResponse();
  let nextCalled = false;

  validarAssinaturaImagem(
    {
      file: {
        mimetype: "image/png",
        buffer: Buffer.from("nao e png"),
      },
    },
    res,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(nextCalled, false);
  assert.equal(res.body.message, "Tipo de arquivo não permitido");
});

test("arquivo acima de 5 MB é recusado mesmo após o parser", () => {
  const res = createResponse();
  let nextCalled = false;

  validarAssinaturaImagem(
    {
      file: {
        ...imageFile,
        size: IMAGE_UPLOAD_MAX_BYTES + 1,
      },
    },
    res,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(nextCalled, false);
  assert.match(res.body.message, /até 5MB/);
});

test("remoção recusa publicId fora da pasta controlada", async (t) => {
  const destroyed = mockCloudinary(t);
  const removed = await deleteImageByPublicId("outra-aplicacao/imagem", {
    allowedFolder: "atualpet/treinamentos",
  });

  assert.equal(removed, false);
  assert.deepEqual(destroyed, []);
});

test("rotas administrativas autenticam antes do upload e aplicam rate limit", () => {
  for (const router of [trainingRouter, materialRouter]) {
    assert.deepEqual(router.stack.slice(0, 2).map((layer) => layer.name), [
      "proteger",
      "somenteAdmin",
    ]);

    const postRoute = router.stack.find(
      (layer) => layer.route?.path === "/" && layer.route.methods.post
    );
    const handlers = postRoute.route.stack.map((layer) => layer.handle.name);
    assert.deepEqual(handlers.slice(1, 3), [
      "multerMiddleware",
      "validarAssinaturaImagem",
    ]);
    assert.equal(handlers[0], "");
  }
});

test("admin cria treinamento com thumbnail e publicId não vaza na resposta", async (t) => {
  mockCloudinary(t);
  const originalCreate = Treinamento.create;
  let received;
  Treinamento.create = async (payload) => {
    received = payload;
    return { _id: trainingId, ...payload };
  };
  t.after(() => {
    Treinamento.create = originalCreate;
  });

  const res = createResponse();
  await criarTreinamento({
    body: validTrainingPayload,
    file: imageFile,
    usuario: { _id: adminId },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.match(received.thumbnailUrl, /^https:\/\/res\.cloudinary\.com\//);
  assert.equal(received.thumbnailPublicId, "atualpet/treinamentos/thumb");
  assert.equal(Object.hasOwn(res.body.treinamento, "thumbnailPublicId"), false);
});

test("treinamento sem upload mantém campo vazio para fallback do YouTube", async (t) => {
  const originalCreate = Treinamento.create;
  let received;
  Treinamento.create = async (payload) => {
    received = payload;
    return { _id: trainingId, ...payload };
  };
  t.after(() => {
    Treinamento.create = originalCreate;
  });

  const res = createResponse();
  await criarTreinamento({
    body: validTrainingPayload,
    usuario: { _id: adminId },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(received.thumbnailUrl, "");
  assert.equal(received.thumbnailPublicId, "");
});

test("admin cria material com imagem e campos internos não vazam", async (t) => {
  mockCloudinary(t, {
    uploadResult: {
      secure_url: "https://res.cloudinary.com/atualpet/image/upload/capa.jpg",
      public_id: "atualpet/materiais-marketing/capa",
    },
  });
  const originalCreate = MaterialMarketing.create;
  let received;
  MaterialMarketing.create = async (payload) => {
    received = payload;
    return { _id: materialId, ...payload };
  };
  t.after(() => {
    MaterialMarketing.create = originalCreate;
  });

  const res = createResponse();
  await criarMaterial({
    body: validMaterialPayload,
    file: imageFile,
    usuario: { _id: adminId },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(received.imagemCapaPublicId, "atualpet/materiais-marketing/capa");
  assert.equal(Object.hasOwn(res.body.material, "imagemCapaPublicId"), false);
});

test("edição sem arquivo preserva a thumbnail e URL legada", async (t) => {
  const originalFindById = Treinamento.findById;
  const document = {
    titulo: "Antigo",
    thumbnailUrl: "https://legacy.example.com/thumbnail.jpg",
    thumbnailPublicId: "",
    save: async () => {},
  };
  Treinamento.findById = async () => document;
  t.after(() => {
    Treinamento.findById = originalFindById;
  });

  const res = createResponse();
  await atualizarTreinamento({
    params: { id: trainingId },
    body: { titulo: "Atualizado" },
    usuario: { _id: adminId },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(document.thumbnailUrl, "https://legacy.example.com/thumbnail.jpg");
});

test("substituição só remove a thumbnail antiga após salvar a nova", async (t) => {
  const destroyed = mockCloudinary(t);
  const originalFindById = Treinamento.findById;
  let saved = false;
  const document = {
    titulo: "Antigo",
    thumbnailUrl: "https://res.cloudinary.com/old.jpg",
    thumbnailPublicId: "atualpet/treinamentos/old",
    async save() {
      saved = true;
      assert.equal(destroyed.length, 0);
    },
  };
  Treinamento.findById = async () => document;
  t.after(() => {
    Treinamento.findById = originalFindById;
  });

  const res = createResponse();
  await atualizarTreinamento({
    params: { id: trainingId },
    body: {},
    file: imageFile,
    usuario: { _id: adminId },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(saved, true);
  assert.equal(document.thumbnailPublicId, "atualpet/treinamentos/thumb");
  assert.deepEqual(destroyed, ["atualpet/treinamentos/old"]);
});

test("falha no Cloudinary retorna erro seguro e mantém imagem anterior", async (t) => {
  mockCloudinary(t, {
    uploadError: {
      name: "CloudinaryError",
      http_code: 500,
      message: "credencial-interna-que-nao-pode-vazar",
    },
  });
  const originalFindById = Treinamento.findById;
  const originalConsoleError = console.error;
  let saveCalled = false;
  const document = {
    thumbnailUrl: "https://res.cloudinary.com/old.jpg",
    thumbnailPublicId: "atualpet/treinamentos/old",
    async save() {
      saveCalled = true;
    },
  };
  Treinamento.findById = async () => document;
  console.error = () => {};
  t.after(() => {
    Treinamento.findById = originalFindById;
    console.error = originalConsoleError;
  });

  const res = createResponse();
  await atualizarTreinamento({
    params: { id: trainingId },
    body: {},
    file: imageFile,
    usuario: { _id: adminId },
  }, res);

  assert.equal(res.statusCode, 502);
  assert.equal(saveCalled, false);
  assert.equal(document.thumbnailUrl, "https://res.cloudinary.com/old.jpg");
  assert.doesNotMatch(JSON.stringify(res.body), /credencial-interna|stack/i);
});

test("URLs externas enviadas no body e campos desconhecidos são ignorados", () => {
  const training = validateTrainingPayload({
    ...validTrainingPayload,
    thumbnailUrl: "https://arbitrario.example.com/imagem.jpg",
    admin: true,
  });
  const material = validateMaterialPayload({
    ...validMaterialPayload,
    imagemCapaUrl: "https://arbitrario.example.com/imagem.jpg",
    tokenVersion: 9,
  });

  assert.equal(training.valid, true);
  assert.equal(material.valid, true);
  assert.equal(Object.hasOwn(training.data, "thumbnailUrl"), false);
  assert.equal(Object.hasOwn(training.data, "admin"), false);
  assert.equal(Object.hasOwn(material.data, "imagemCapaUrl"), false);
  assert.equal(Object.hasOwn(material.data, "tokenVersion"), false);
});

test("edição de material sem novo arquivo preserva imagem existente", async (t) => {
  const originalFindById = MaterialMarketing.findById;
  const document = {
    titulo: "Antigo",
    imagemCapaUrl: "https://legacy.example.com/capa.jpg",
    imagemCapaPublicId: "",
    save: async () => {},
  };
  MaterialMarketing.findById = async () => document;
  t.after(() => {
    MaterialMarketing.findById = originalFindById;
  });

  const res = createResponse();
  await atualizarMaterial({
    params: { id: materialId },
    body: { titulo: "Atualizado" },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(document.imagemCapaUrl, "https://legacy.example.com/capa.jpg");
});
