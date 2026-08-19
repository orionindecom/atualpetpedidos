import express from "express";
import {
  criarTabela,
  listarTabelas,
  atualizarTabela,
  duplicarTabela,
} from "../controllers/tabelaPrecoController.js";

import { proteger } from "../middlewares/authMiddleware.js";
import { somenteGestorComercial } from "../middlewares/adminMiddleware.js";
import { adminLimiter } from "../middlewares/rateLimitMiddleware.js";
import { validateObjectIdParam } from "../utils/validation.js";

const router = express.Router();

router.post("/", proteger, somenteGestorComercial, adminLimiter, criarTabela);

router.get("/", proteger, somenteGestorComercial, listarTabelas);

router.put(
  "/:id",
  proteger,
  somenteGestorComercial,
  adminLimiter,
  validateObjectIdParam(),
  atualizarTabela
);

router.post(
  "/:id/duplicar",
  proteger,
  somenteGestorComercial,
  adminLimiter,
  validateObjectIdParam(),
  duplicarTabela
);

export default router;
