import express from "express";
import {
  listarClientesPendentes,
  aprovarCliente,
} from "../controllers/clienteController.js";

import { proteger } from "../middlewares/authMiddleware.js";
import { somenteAdmin } from "../middlewares/adminMiddleware.js";

const router = express.Router();

router.get("/pendentes", proteger, somenteAdmin, listarClientesPendentes);
router.put("/:id/aprovar", proteger, somenteAdmin, aprovarCliente);

export default router;