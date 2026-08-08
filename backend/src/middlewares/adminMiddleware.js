import { measureStageSync } from "../utils/performance.js";

export const temPapel = (usuario, papeis) =>
  Boolean(usuario && papeis.includes(usuario.tipo));

export const somenteAdmin = (req, res, next) => {
  const isAdmin = measureStageSync(
    req,
    "auth.admin",
    () => temPapel(req.usuario, ["admin"])
  );

  if (!isAdmin) {
    return res.status(403).json({ message: "Acesso negado" });
  }

  return next();
};

export const somenteGestorConteudo = (req, res, next) => {
  const isContentManager = measureStageSync(
    req,
    "auth.gestor_conteudo",
    () => temPapel(req.usuario, ["admin", "marketing"])
  );

  if (!isContentManager) {
    return res.status(403).json({ message: "Acesso negado" });
  }

  return next();
};

export const somenteOperacaoLogistica = (req, res, next) => {
  const isLogisticsOperator = measureStageSync(
    req,
    "auth.operacao_logistica",
    () => temPapel(req.usuario, ["admin", "logistica"])
  );

  if (!isLogisticsOperator) {
    return res.status(403).json({ message: "Acesso negado" });
  }

  return next();
};
