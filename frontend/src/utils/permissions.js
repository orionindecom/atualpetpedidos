export { hasPermission, hasGlobalScope, PERMISSIONS, ROLE_PERMISSIONS } from './permissionPolicy.js';
import { hasPermission } from './permissionPolicy.js';
const trainingTracking = ['acompanharTreinamentos', 'criarTreinamentos', 'editarTreinamentos', 'excluirTreinamentos'];
export const routePermissions = {
  '/usuarios': ['usuarios'], '/carteira': ['clientes'], '/vendas': ['clientes', 'pedidosTodos', 'pedidosCarteira'],
  '/pedidos/novo': ['criarPedidos'], '/pedidos': ['pedidosTodos', 'pedidosCarteira'],
  '/precos': ['comercial'], '/tabelas': ['comercial'],
  '/treinamentos': ['treinamentos'], '/materiais-marketing': ['materiais'],
  '/necessidade-producao': ['producao'],
  '/logistica': ['logistica'], '/marketing': ['conteudo'],
  '/admin/treinamentos': trainingTracking, '/admin/materiais-marketing': ['conteudo'], '/admin/banners': ['conteudo'],
};
export const canOpenRoute = (user, path, roles = []) => {
  const key = Object.keys(routePermissions).sort((a, b) => b.length - a.length)
    .find((route) => path === route || path.startsWith(route + '/'));
  return key ? routePermissions[key].some((permission) => hasPermission(user, permission)) : roles.includes(user?.tipo);
};
