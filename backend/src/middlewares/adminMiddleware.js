export const somenteAdmin = (req, res, next) => {
  if (!req.usuario || req.usuario.tipo !== "admin") {
    return res.status(403).json({
      message: "Acesso negado"
    });
  }

  next();
};
