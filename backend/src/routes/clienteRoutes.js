import express from "express";
import {
  listarClientesPendentes,
  aprovarCliente,
  redefinirSenhaCliente,
  listarClientes,
  obterClienteAdmin,
  atualizarClienteAdmin,
  inativarCliente,
  reativarCliente,
  rejeitarCliente,
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
router.get("/:id", validateObjectIdParam(), obterClienteAdmin);
router.patch("/:id", validateObjectIdParam(), atualizarClienteAdmin);
router.put("/:id/aprovar", validateObjectIdParam(), aprovarCliente);
router.put("/:id/rejeitar", validateObjectIdParam(), rejeitarCliente);
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
