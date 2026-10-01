import { hasPermission } from '../utils/permissions.js';
export const exigirPermissao = (...permissions) => function verificarPermissao(req, res, next) {
  if (!permissions.some((permission) => hasPermission(req.usuario, permission))) {
    return res.status(403).json({ message: 'Acesso negado' });
  }
  return next();
};
