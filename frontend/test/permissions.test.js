import test from 'node:test';
import assert from 'node:assert/strict';
import { canOpenRoute } from '../src/utils/permissions.js';
import { hasPermission, canAccessClient } from '../src/utils/permissionPolicy.js';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../src/utils/permissionPolicy.js';
import * as backendPolicy from '../../backend/src/utils/permissions.js';

test('Políticas permanecem iguais nos pacotes independentes de frontend e backend', () => {
  assert.deepEqual(PERMISSIONS, backendPolicy.PERMISSIONS);
  assert.deepEqual(ROLE_PERMISSIONS, backendPolicy.ROLE_PERMISSIONS);
  for (const tipo of Object.keys(ROLE_PERMISSIONS)) {
    for (const permission of Object.keys(PERMISSIONS)) {
      for (const permissoes of [undefined, { [permission]: true }, { [permission]: false }]) {
        assert.equal(hasPermission({ tipo, permissoes }, permission), backendPolicy.hasPermission({ tipo, permissoes }, permission));
      }
    }
  }
});

test('Vendedor e Comercial compartilham permissões e respeitam overrides', () => {
  for (const tipo of ['vendedor', 'comercial']) {
    assert.equal(canOpenRoute({ tipo }, '/carteira'), true);
    assert.equal(canOpenRoute({ tipo }, '/pedidos/novo'), true);
    assert.equal(canOpenRoute({ tipo, permissoes: { criarPedidos: false } }, '/pedidos/novo'), false);
    assert.equal(canOpenRoute({ tipo }, '/produtos', ['admin']), false);
  }
  assert.equal(hasPermission({ tipo: 'comercial' }, 'treinamentos'), true);
  assert.equal(hasPermission({ tipo: 'comercial' }, 'comercial'), true);
  assert.equal(hasPermission({ tipo: 'vendedor' }, 'comercial'), false);
});
test('Treinamentos e atalhos respeitam permissão individual, inclusive em sessão legada', () => {
  assert.equal(canOpenRoute({ tipo: 'cliente' }, '/treinamentos/123'), true);
  assert.equal(canOpenRoute({ tipo: 'cliente', permissoes: { treinamentos: false } }, '/treinamentos/123'), false);
  assert.equal(canOpenRoute({ tipo: 'vendedor', permissoes: { treinamentos: true } }, '/treinamentos'), true);
});
test('Carteira é obrigatória para vendedor e cliente; Admin tem escopo global', () => {
  const client = { _id: 'cliente', vendedorResponsavelId: 'vendedor' };
  assert.equal(canAccessClient({ _id: 'vendedor', tipo: 'vendedor' }, client), true);
  assert.equal(canAccessClient({ _id: 'outro', tipo: 'vendedor', permissoes: { pedidosTodos: true } }, client), false);
  assert.equal(canAccessClient({ _id: 'cliente', tipo: 'cliente' }, client), true);
  assert.equal(canAccessClient({ _id: 'outro', tipo: 'cliente' }, client), false);
  assert.equal(canAccessClient({ tipo: 'admin' }, client), true);
  assert.equal(hasPermission({ tipo: 'vendedor', ativo: false }, 'clientes'), false);
});
