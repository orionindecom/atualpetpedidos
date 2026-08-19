import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatRegistrationDocument,
  formatRegistrationCnpj,
  formatRegistrationPhone,
  getRegistrationDocumentType,
  getRegistrationApiFieldErrors,
  isValidRegistrationCnpj,
  isValidRegistrationCpf,
  validateRegistrationDocument,
  validateRegistrationForm,
} from "../src/utils/registrationValidation.js";

const readSource = (relativePath) => (
  readFileSync(new URL(relativePath, import.meta.url), "utf8")
);

const validForm = () => ({
  nomeResponsavel: "Ana Lima",
  email: "ana@example.com",
  senha: "senha-segura",
  confirmarSenha: "senha-segura",
  razaoSocial: "Pet Comércio Ltda",
  nomeFantasia: "Pet Centro",
  cnpj: "11.222.333/0001-81",
  telefone: "(11) 3333-4444",
  whatsapp: "(11) 99999-8888",
});

test("campo obrigatório vazio apresenta mensagem específica", () => {
  const form = validForm();
  form.nomeResponsavel = "";
  const errors = validateRegistrationForm(form);
  assert.equal(errors.nomeResponsavel, "Informe o nome do responsável em até 120 caracteres.");
});

test("e-mail inválido apresenta erro específico", () => {
  const errors = validateRegistrationForm({ ...validForm(), email: "ana@invalido" });
  assert.equal(errors.email, "Informe um e-mail válido.");
});

test("CNPJ inválido apresenta erro específico sem rejeitar máscara válida", () => {
  assert.equal(isValidRegistrationCnpj("11.222.333/0001-81"), true);
  const errors = validateRegistrationForm({ ...validForm(), cnpj: "12.345.678/0001-00" });
  assert.equal(errors.cnpj, "O CNPJ informado é inválido.");
});

test("CPF válido com ou sem máscara é aceito e CPF inválido tem mensagem específica", () => {
  assert.equal(isValidRegistrationCpf("529.982.247-25"), true);
  assert.equal(isValidRegistrationCpf("52998224725"), true);
  assert.equal(isValidRegistrationCpf("529.982.247-24"), false);
  assert.equal(isValidRegistrationCpf("111.111.111-11"), false);
  assert.deepEqual(validateRegistrationForm({ ...validForm(), cnpj: "529.982.247-25" }), {});
  assert.equal(
    validateRegistrationForm({ ...validForm(), cnpj: "529.982.247-24" }).cnpj,
    "O CPF informado é inválido."
  );
});

test("documento é classificado por 11 ou 14 dígitos e rejeita outros comprimentos", () => {
  assert.equal(getRegistrationDocumentType("529.982.247-25"), "cpf");
  assert.equal(getRegistrationDocumentType("11.222.333/0001-81"), "cnpj");
  assert.match(validateRegistrationDocument("1234567890"), /incompleto/);
  assert.match(validateRegistrationDocument("123456789012"), /incompleto/);
  assert.match(validateRegistrationDocument("1234567890123"), /incompleto/);
  assert.match(validateRegistrationDocument("123456789012345"), /máximo 14/);
  assert.equal(validateRegistrationDocument(""), null);
});

test("senha curta informa o mínimo exigido", () => {
  const errors = validateRegistrationForm({
    ...validForm(),
    senha: "123",
    confirmarSenha: "123",
  });
  assert.match(errors.senha, /pelo menos 8 caracteres/);
});

test("confirmação de senha diferente apresenta erro específico", () => {
  const errors = validateRegistrationForm({ ...validForm(), confirmarSenha: "outra-senha" });
  assert.equal(errors.confirmarSenha, "As senhas não coincidem.");
});

test("múltiplos erros são retornados juntos e cadastro válido permanece válido", () => {
  const errors = validateRegistrationForm({
    ...validForm(),
    nomeResponsavel: "",
    email: "inválido",
    senha: "1",
    confirmarSenha: "2",
    telefone: "123",
  });
  assert.deepEqual(Object.keys(errors), [
    "nomeResponsavel",
    "email",
    "senha",
    "confirmarSenha",
    "telefone",
  ]);
  assert.deepEqual(validateRegistrationForm(validForm()), {});
});

test("máscara progressiva transita de CPF para CNPJ e limita o documento", () => {
  assert.equal(formatRegistrationDocument("52998224725"), "529.982.247-25");
  assert.equal(formatRegistrationDocument("529.982.247-251"), "52.998.224/7251");
  assert.equal(formatRegistrationDocument("11222333000181"), "11.222.333/0001-81");
  assert.equal(formatRegistrationDocument("11222333000181999"), "11.222.333/0001-81");
  assert.equal(formatRegistrationCnpj("11222333000181"), "11.222.333/0001-81");
  assert.equal(formatRegistrationPhone("1133334444"), "(11) 3333-4444");
  assert.equal(formatRegistrationPhone("11999998888"), "(11) 99999-8888");
});

test("erros de duplicidade do backend são associados aos campos corretos", () => {
  assert.deepEqual(getRegistrationApiFieldErrors({
    message: "Não foi possível concluir o cadastro.",
    errors: {
      email: "Este e-mail já está cadastrado.",
      cnpj: "Este CNPJ já está cadastrado.",
    },
  }), {
    email: "Este e-mail já está cadastrado.",
    cnpj: "Este CNPJ já está cadastrado.",
  });
});

test("campos desconhecidos do backend não são injetados na interface", () => {
  assert.deepEqual(getRegistrationApiFieldErrors({
    errors: { stack: "segredo", email: "E-mail inválido." },
  }), { email: "E-mail inválido." });
  assert.deepEqual(getRegistrationApiFieldErrors({ message: "Falha" }), {});
});

test("formulário associa erros aos inputs e não depende somente de cor", () => {
  const page = readSource("../src/pages/Cadastro/Cadastro.jsx");
  const css = readSource("../src/pages/Cadastro/Cadastro.module.css");
  assert.match(page, /"aria-invalid": Boolean\(errors\[name\]\)/);
  assert.match(page, /"aria-describedby": errors\[name\]/);
  assert.match(page, /id=\{`\$\{name\}-error`\}/);
  assert.match(page, /className=\{styles\.fieldError\}/);
  assert.match(page, /role="alert"/);
  assert.match(css, /input\[aria-invalid="true"\]/);
  assert.match(css, /\.fieldError/);
});

test("erro mantém formulário, associa resposta da API e oferece fallback amigável", () => {
  const page = readSource("../src/pages/Cadastro/Cadastro.jsx");
  const catchBlock = page.match(/} catch \(error\) \{([\s\S]*?)} finally/)?.[1] || "";
  assert.match(catchBlock, /getRegistrationApiFieldErrors/);
  assert.match(catchBlock, /setErrors\(apiErrors\)/);
  assert.match(catchBlock, /Não foi possível enviar o cadastro\. Tente novamente\./);
  assert.doesNotMatch(catchBlock, /setForm/);
  assert.match(page, /focusFirstError\(formElement, apiErrors\)/);
  assert.match(page, /value=\{form\.cnpj\}/);
});

test("cadastro válido continua usando o endpoint e fluxo de sucesso existentes", () => {
  const page = readSource("../src/pages/Cadastro/Cadastro.jsx");
  assert.match(page, /await api\.post\("\/auth\/cadastro", form\)/);
  assert.match(page, /Cadastro enviado com sucesso\. Aguarde aprovação\./);
  assert.match(page, /navigate\("\/login"\)/);
  assert.match(page, /name="confirmarSenha"/);
  assert.match(page, /CPF ou CNPJ/);
  assert.match(page, /formatRegistrationDocument/);
  assert.match(page, /noValidate/);
});
