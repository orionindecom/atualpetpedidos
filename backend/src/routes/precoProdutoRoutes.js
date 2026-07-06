import express from "express";
import {
  definirPrecoProduto,
  listarPrecosPorTabela,
} from "../controllers/precoProdutoController.js";

import { proteger } from "../middlewares/authMiddleware.js";
import { somenteAdmin } from "../middlewares/adminMiddleware.js";
import { adminLimiter } from "../middlewares/rateLimitMiddleware.js";

const router = express.Router();

router.post(
  "/",
  proteger,
  somenteAdmin,
  adminLimiter,
  definirPrecoProduto
);

router.get(
  "/tabela/:tabelaPrecoId",
  proteger,
  somenteAdmin,
  listarPrecosPorTabela
);

export default router;
