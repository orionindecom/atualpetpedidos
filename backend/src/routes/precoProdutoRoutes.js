import express from "express";
import {
  definirPrecoProduto,
  listarPrecosPorTabela,
} from "../controllers/precoProdutoController.js";

import { proteger } from "../middlewares/authMiddleware.js";
import { somenteGestorComercial } from "../middlewares/adminMiddleware.js";
import { adminLimiter } from "../middlewares/rateLimitMiddleware.js";
import { validateObjectIdParam } from "../utils/validation.js";

const router = express.Router();

router.post(
  "/",
  proteger,
  somenteGestorComercial,
  adminLimiter,
  definirPrecoProduto
);

router.get(
  "/tabela/:tabelaPrecoId",
  proteger,
  somenteGestorComercial,
  validateObjectIdParam("tabelaPrecoId"),
  listarPrecosPorTabela
);

export default router;
