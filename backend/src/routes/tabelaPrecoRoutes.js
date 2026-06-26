import express from "express";
import {
  criarTabela,
  listarTabelas,
  atualizarTabela,
  duplicarTabela,
} from "../controllers/tabelaPrecoController.js";

import { proteger } from "../middlewares/authMiddleware.js";
import { somenteAdmin } from "../middlewares/adminMiddleware.js";
import { adminLimiter } from "../middlewares/rateLimitMiddleware.js";
import { validateObjectIdParam } from "../utils/validation.js";

const router = express.Router();

router.post("/", proteger, somenteAdmin, adminLimiter, criarTabela);

router.get("/", proteger, listarTabelas);

router.put("/:id", proteger, somenteAdmin, adminLimiter, validateObjectIdParam(), atualizarTabela);

router.post("/:id/duplicar", proteger, somenteAdmin, adminLimiter, validateObjectIdParam(), duplicarTabela);

export default router;
