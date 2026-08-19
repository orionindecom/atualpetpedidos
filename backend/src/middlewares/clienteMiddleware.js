export const somenteCliente = (req, res, next) => {
  if (!req.usuario || req.usuario.tipo !== "cliente") {
    return res.status(403).json({ message: "Acesso exclusivo para clientes" });
  }

  return next();
};

export const somentePublicoConteudo = (req, res, next) => {
  if (!req.usuario || !["cliente", "groomer"].includes(req.usuario.tipo)) {
    return res.status(403).json({
      message: "Acesso exclusivo para distribuidores e Groomers",
    });
  }

  return next();
};

export const somenteClienteOuAdmin = (req, res, next) => {
  if (!req.usuario || !["cliente", "admin"].includes(req.usuario.tipo)) {
    return res.status(403).json({ message: "Acesso negado" });
  }

  return next();
};
