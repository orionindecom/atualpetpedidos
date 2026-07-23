export const somenteCliente = (req, res, next) => {
  if (!req.usuario || req.usuario.tipo !== "cliente") {
    return res.status(403).json({ message: "Acesso exclusivo para clientes" });
  }

  return next();
};
