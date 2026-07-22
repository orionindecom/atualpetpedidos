import { measureStageSync } from "../utils/performance.js";

export const somenteAdmin = (req, res, next) => {
  const isAdmin = measureStageSync(
    req,
    "auth.admin",
    () => Boolean(req.usuario && req.usuario.tipo === "admin")
  );

  if (!isAdmin) {
    return res.status(403).json({ message: "Acesso negado" });
  }

  return next();
};
