import { hasPermission } from "../utils/permissions.js";
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
    () => hasPermission(req.usuario, "conteudo")
  );

  if (!isContentManager) {
    return res.status(403).json({ message: "Acesso negado" });
  }

  return next();
};

export const somenteGestorComercial = (req, res, next) => {
  const isCommercialManager = measureStageSync(
    req,
    "auth.gestor_comercial",
    () => hasPermission(req.usuario, "comercial")
  );

  if (!isCommercialManager) {
    return res.status(403).json({ message: "Acesso negado" });
  }

  return next();
};

export const somenteOperacaoLogistica = (req, res, next) => {
  const isLogisticsOperator = measureStageSync(
    req,
    "auth.operacao_logistica",
    () => hasPermission(req.usuario, "logistica")
  );

  if (!isLogisticsOperator) {
    return res.status(403).json({ message: "Acesso negado" });
  }

  return next();
};

export const somenteLogistica = (req, res, next) => {
  const isLogisticsAccount = measureStageSync(
    req,
    "auth.logistica",
    () => temPapel(req.usuario, ["logistica"])
  );

  if (!isLogisticsAccount) {
    return res.status(403).json({ message: "Acesso exclusivo da Logística" });
  }

  return next();
};

export const somenteComercial = (req, res, next) => {
  if (!temPapel(req.usuario, ["comercial"])) {
    return res.status(403).json({ message: "Acesso exclusivo do Comercial" });
  }
  return next();
};
