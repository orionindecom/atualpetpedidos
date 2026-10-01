import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Usuario from '../src/models/Usuario.js';
import { login } from '../src/controllers/authController.js';
const password = 'SenhaValida123!';
const hash = await bcrypt.hash(password, 4);
const account = (statusCadastro, extra = {}) => ({ _id: '507f1f77bcf86cd799439011', nomeResponsavel: 'Pessoa', email: 'pessoa@example.com', senha: hash,
  tipo: 'cliente', ativo: true, statusCadastro, tokenVersion: 0, motivoReprovacao: 'Somente interno', save: async () => {}, ...extra });
async function run(t, user, senha = password) {
  t.mock.method(Usuario, 'findOne', async () => user);
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await login({ body: { email: 'pessoa@example.com', senha } }, res);
  return res;
}
for (const tipo of ['cliente', 'groomer']) for (const [status, code, message] of [['pendente', 'REGISTRATION_PENDING', 'Cadastro ainda não aprovado.'], ['reprovado', 'REGISTRATION_REJECTED', 'Cadastro não aprovado.']]) {
  test(`login ${tipo} ${status}: status somente após credenciais corretas`, async (t) => {
    const res = await run(t, account(status, { tipo }));
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { code, status, message });
  });
}
for (const status of ['pendente', 'reprovado', 'aprovado']) test(`senha incorreta não revela ${status}`, async (t) => {
  const res = await run(t, account(status), 'incorreta');
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { message: 'E-mail ou senha inválidos' });
});
test('conta inexistente mantém resposta de credencial inválida', async (t) => {
  const res = await run(t, null);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { message: 'E-mail ou senha inválidos' });
});
test('desativado mantém contrato e precedência sobre reprovação', async (t) => {
  const res = await run(t, account('reprovado', { ativo: false }));
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { message: 'Usuário desativado' });
});
test('aprovado preserva token e sessão sem dados internos', async (t) => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'segredo-local-exclusivo-teste-32-caracteres';
  t.after(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
  let saved = 0;
  const user = account('aprovado', { save: async () => { saved += 1; } });
  const res = await run(t, user);
  assert.equal(res.statusCode, 200);
  assert.equal(jwt.verify(res.body.token, process.env.JWT_SECRET).id, user._id);
  assert.equal(saved, 1);
  assert.equal(res.body.usuario.statusCadastro, 'aprovado');
  assert.equal(res.body.usuario.senha, undefined);
  assert.equal(res.body.usuario.motivoReprovacao, undefined);
});
