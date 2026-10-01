import Usuario from '../models/Usuario.js';
import { hasGlobalScope, hasPermission } from '../utils/permissions.js';
export const filtroCarteira = (usuario) => hasGlobalScope(usuario)
  ? {} : { vendedorResponsavelId: usuario._id };
export const podeAcessarPedido = async (usuario, pedido) => {
  if (usuario.tipo === 'cliente') return String(pedido.clienteId) === String(usuario._id);
  if (!hasPermission(usuario, 'pedidosCarteira') && !hasGlobalScope(usuario)) return false;
  if (hasGlobalScope(usuario)) return true;
  const cliente = await Usuario.findById(pedido.clienteId).select('_id vendedorResponsavelId').lean();
  return Boolean(cliente && String(cliente.vendedorResponsavelId || '') === String(usuario._id));
};
export const filtroPedidos = async (usuario) => {
  if (hasGlobalScope(usuario)) return {};
  if (!hasPermission(usuario, 'pedidosCarteira')) return { clienteId: { $in: [] } };
  const clientes = await Usuario.find({ tipo: 'cliente', ...filtroCarteira(usuario) }).select('_id').lean();
  return { clienteId: { $in: clientes.map((cliente) => cliente._id) } };
};
