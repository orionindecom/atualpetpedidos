import express from "express";
import {
  listarClientesPendentes,
  aprovarCliente,
  redefinirSenhaCliente,
  listarClientes,
  inativarCliente,
   reativarCliente
} from "../controllers/clienteController.js";

import { proteger } from "../middlewares/authMiddleware.js";
import { somenteAdmin } from "../middlewares/adminMiddleware.js";
import { adminLimiter } from "../middlewares/rateLimitMiddleware.js";
import { validateObjectIdParam } from "../utils/validation.js";

const router = express.Router();

router.use(proteger, somenteAdmin, adminLimiter);

router.get(
  "/",
  listarClientes
);
router.get("/pendentes", listarClientesPendentes);
router.put("/:id/aprovar", validateObjectIdParam(), aprovarCliente);
router.put(
  "/:id/redefinir-senha",
  validateObjectIdParam(),
  redefinirSenhaCliente
);
router.put(
  "/:id/desativar",
  validateObjectIdParam(),
  inativarCliente
);
router.put(
  "/:id/reativar",
  validateObjectIdParam(),
  reativarCliente
);
export default router;
