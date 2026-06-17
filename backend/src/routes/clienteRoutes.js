import express from "express";
import {
  listarClientesPendentes,
  aprovarCliente,
  redefinirSenhaCliente,
  listarClientes,
} from "../controllers/clienteController.js";

import { proteger } from "../middlewares/authMiddleware.js";
import { somenteAdmin } from "../middlewares/adminMiddleware.js";

const router = express.Router();

router.get(
  "/",
  proteger,
  somenteAdmin,
  listarClientes
);
router.get("/pendentes", proteger, somenteAdmin, listarClientesPendentes);
router.put("/:id/aprovar", proteger, somenteAdmin, aprovarCliente);
router.put(
  "/:id/redefinir-senha",
  proteger,
  somenteAdmin,
  redefinirSenhaCliente
);

export default router;