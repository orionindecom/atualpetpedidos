import test from "node:test";
import assert from "node:assert/strict";
import Usuario from "../src/models/Usuario.js";
import { cadastrar } from "../src/controllers/authController.js";
import {
  buildDocumentDuplicateCandidates,
  getCadastroDocumentType,
  isValidBrazilianPhone,
  isValidCnpj,
  isValidCpf,
  validateCadastroDocument,
  validateCadastroPayload,
} from "../src/utils/cadastroValidation.js";

const validPayload = () => ({
  nomeResponsavel: "Ana Lima",
  email: " ANA@EXAMPLE.COM ",
  senha: "senha-segura",
  confirmarSenha: "senha-segura",
  razaoSocial: " Pet Comércio Ltda ",
  nomeFantasia: " Pet Centro ",
  cnpj: "11.222.333/0001-81",
  telefone: "(11) 3333-4444",
  whatsapp: "(11) 99999-8888",
});

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const queryResult = (result) => ({
  select() { return this; },
  lean() { return Promise.resolve(result); },
});

test("campos obrigatórios vazios retornam mensagens específicas e simultâneas", () => {
  const result = validateCadastroPayload({
    nomeResponsavel: "",
    email: "",
    senha: "",
    confirmarSenha: "",
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.nomeResponsavel, /responsável/);
  assert.match(result.errors.email, /e-mail válido/);
  assert.match(result.errors.senha, /pelo menos 8/);
  assert.equal(Object.keys(result.errors).length >= 3, true);
});

test("e-mail, CNPJ, telefone e senha inválidos preservam o motivo por campo", () => {
  const result = validateCadastroPayload({
    ...validPayload(),
    email: "email-invalido",
    cnpj: "12.345.678/0001-00",
    telefone: "1234",
    senha: "curta",
    confirmarSenha: "curta",
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.email, /e-mail válido/);
  assert.match(result.errors.cnpj, /CNPJ.*inválido/);
  assert.match(result.errors.telefone, /telefone válido/);
  assert.match(result.errors.senha, /8 caracteres/);
});

test("confirmação diferente da senha é identificada sem persistência", () => {
  const result = validateCadastroPayload({ ...validPayload(), confirmarSenha: "outra-senha" });
  assert.equal(result.valid, false);
  assert.equal(result.errors.confirmarSenha, "As senhas não coincidem.");
});

test("máscaras são normalizadas antes da validação e persistência", () => {
  const result = validateCadastroPayload(validPayload());
  assert.equal(result.valid, true);
  assert.equal(result.data.email, "ana@example.com");
  assert.equal(result.data.cnpj, "11222333000181");
  assert.equal(result.data.telefone, "1133334444");
  assert.equal(result.data.whatsapp, "11999998888");
  assert.equal(result.data.razaoSocial, "Pet Comércio Ltda");
});

test("validadores aceitam documentos e telefones reais e recusam sequências", () => {
  assert.equal(isValidCpf("529.982.247-25"), true);
  assert.equal(isValidCpf("52998224725"), true);
  assert.equal(isValidCpf("529.982.247-24"), false);
  assert.equal(isValidCpf("111.111.111-11"), false);
  assert.equal(isValidCnpj("04.252.011/0001-10"), true);
  assert.equal(isValidCnpj("00.000.000/0000-00"), false);
  assert.equal(isValidBrazilianPhone("(11) 3333-4444"), true);
  assert.equal(isValidBrazilianPhone("(11) 99999-8888"), true);
  assert.equal(isValidBrazilianPhone("(11) 11111-1111"), false);
});

test("payload aceita CPF mascarado ou normalizado e preserva a mensagem por tipo", () => {
  const masked = validateCadastroPayload({ ...validPayload(), cnpj: "529.982.247-25" });
  const normalized = validateCadastroPayload({ ...validPayload(), cnpj: "52998224725" });
  const invalidCpf = validateCadastroPayload({ ...validPayload(), cnpj: "52998224724" });
  const invalidCnpj = validateCadastroPayload({ ...validPayload(), cnpj: "11222333000182" });

  assert.equal(masked.valid, true);
  assert.equal(masked.data.cnpj, "52998224725");
  assert.equal(normalized.valid, true);
  assert.equal(normalized.data.cnpj, "52998224725");
  assert.equal(invalidCpf.errors.cnpj, "O CPF informado é inválido.");
  assert.equal(invalidCnpj.errors.cnpj, "O CNPJ informado é inválido.");
});

test("tipo e mensagens do documento seguem a quantidade normalizada", () => {
  assert.equal(getCadastroDocumentType("529.982.247-25"), "cpf");
  assert.equal(getCadastroDocumentType("11.222.333/0001-81"), "cnpj");
  assert.equal(getCadastroDocumentType("123456789012"), null);
  assert.match(validateCadastroDocument("1234567890").error, /incompleto/);
  assert.match(validateCadastroDocument("123456789012").error, /incompleto/);
  assert.match(validateCadastroDocument("1234567890123").error, /incompleto/);
  assert.match(validateCadastroDocument("123456789012345").error, /máximo 14/);
  assert.equal(validateCadastroDocument("").valid, true);
});

test("candidatos de duplicidade cobrem CPF e CNPJ normalizados ou mascarados", () => {
  assert.deepEqual(buildDocumentDuplicateCandidates("529.982.247-25"), [
    "52998224725",
    "529.982.247-25",
  ]);
  assert.deepEqual(buildDocumentDuplicateCandidates("11.222.333/0001-81"), [
    "11222333000181",
    "11.222.333/0001-81",
  ]);
});

test("API devolve errors por campo sem consultar o banco para payload inválido", async (t) => {
  const originalFind = Usuario.find;
  let queried = false;
  Usuario.find = () => { queried = true; return queryResult([]); };
  t.after(() => { Usuario.find = originalFind; });

  const response = createResponse();
  await cadastrar({ body: { email: "invalido", senha: "1" } }, response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.message, "Dados de cadastro inválidos");
  assert.match(response.body.errors.email, /e-mail válido/);
  assert.equal(queried, false);
});

test("e-mail duplicado recebe conflito específico sem expor outros dados", async (t) => {
  const originalFind = Usuario.find;
  Usuario.find = () => queryResult([{ email: "ana@example.com" }]);
  t.after(() => { Usuario.find = originalFind; });

  const response = createResponse();
  await cadastrar({ body: validPayload() }, response);
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body.errors, { email: "Este e-mail já está cadastrado." });
});

test("CNPJ duplicado mascarado recebe conflito específico", async (t) => {
  const originalFind = Usuario.find;
  Usuario.find = () => queryResult([{
    email: "outro@example.com",
    cnpj: "11.222.333/0001-81",
  }]);
  t.after(() => { Usuario.find = originalFind; });

  const response = createResponse();
  await cadastrar({ body: validPayload() }, response);
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body.errors, { cnpj: "Este CNPJ já está cadastrado." });
});

test("CPF duplicado com outra máscara recebe conflito específico", async (t) => {
  const originalFind = Usuario.find;
  Usuario.find = () => queryResult([{
    email: "outro@example.com",
    cnpj: "529.982.247-25",
  }]);
  t.after(() => { Usuario.find = originalFind; });

  const response = createResponse();
  await cadastrar({ body: { ...validPayload(), cnpj: "52998224725" } }, response);
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body.errors, { cnpj: "Este CPF já está cadastrado." });
});

test("cadastro com CPF persiste o documento normalizado no campo legado", async (t) => {
  const originalFind = Usuario.find;
  const originalCreate = Usuario.create;
  let created;
  Usuario.find = () => queryResult([]);
  Usuario.create = async (data) => {
    created = data;
    return { _id: "cliente-cpf", ...data };
  };
  t.after(() => {
    Usuario.find = originalFind;
    Usuario.create = originalCreate;
  });

  const response = createResponse();
  await cadastrar({ body: { ...validPayload(), cnpj: "529.982.247-25" } }, response);
  assert.equal(response.statusCode, 201);
  assert.equal(created.cnpj, "52998224725");
});

test("cadastro válido cria cliente normalizado e mantém o fluxo de sucesso", async (t) => {
  const originalFind = Usuario.find;
  const originalCreate = Usuario.create;
  let created;
  Usuario.find = () => queryResult([]);
  Usuario.create = async (data) => {
    created = data;
    return { _id: "cliente-1", ...data };
  };
  t.after(() => {
    Usuario.find = originalFind;
    Usuario.create = originalCreate;
  });

  const response = createResponse();
  await cadastrar({ body: validPayload() }, response);
  assert.equal(response.statusCode, 201);
  assert.equal(created.email, "ana@example.com");
  assert.equal(created.cnpj, "11222333000181");
  assert.equal(created.telefone, "1133334444");
  assert.notEqual(created.senha, "senha-segura");
  assert.equal(Object.hasOwn(created, "confirmarSenha"), false);
  assert.equal(response.body.usuario.statusCadastro, "pendente");
});

test("campos opcionais vazios não são gravados e não colidem no índice sparse", async (t) => {
  const originalFind = Usuario.find;
  const originalCreate = Usuario.create;
  let created;
  Usuario.find = () => queryResult([]);
  Usuario.create = async (data) => {
    created = data;
    return { _id: "cliente-2", ...data };
  };
  t.after(() => {
    Usuario.find = originalFind;
    Usuario.create = originalCreate;
  });

  const payload = validPayload();
  payload.cnpj = "";
  payload.telefone = "";
  payload.whatsapp = "";
  const response = createResponse();
  await cadastrar({ body: payload }, response);
  assert.equal(response.statusCode, 201);
  assert.equal(Object.hasOwn(created, "cnpj"), false);
  assert.equal(Object.hasOwn(created, "telefone"), false);
  assert.equal(Object.hasOwn(created, "whatsapp"), false);
});

test("conflito de índice durante criação mantém mensagem específica", async (t) => {
  const originalFind = Usuario.find;
  const originalCreate = Usuario.create;
  Usuario.find = () => queryResult([]);
  Usuario.create = async () => {
    const error = new Error("duplicate key");
    error.code = 11000;
    error.keyPattern = { cnpj: 1 };
    throw error;
  };
  t.after(() => {
    Usuario.find = originalFind;
    Usuario.create = originalCreate;
  });

  const response = createResponse();
  await cadastrar({ body: validPayload() }, response);
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.errors.cnpj, "Este CNPJ já está cadastrado.");
});

test("erro inesperado continua usando fallback seguro", async (t) => {
  const originalFind = Usuario.find;
  Usuario.find = () => ({
    select() { throw new Error("falha inesperada"); },
  });
  t.after(() => { Usuario.find = originalFind; });

  const response = createResponse();
  await cadastrar({ body: validPayload() }, response);
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.message, "Erro interno do servidor");
  assert.equal(Object.hasOwn(response.body, "errors"), false);
});
