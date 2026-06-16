import express from "express";
import {
  definirPrecoProduto,
  listarPrecosPorTabela,
} from "../controllers/precoProdutoController.js";

import { proteger } from "../middlewares/authMiddleware.js";
import { somenteAdmin } from "../middlewares/adminMiddleware.js";

const router = express.Router();

router.post(
  "/",
  proteger,
  somenteAdmin,
  definirPrecoProduto
);

router.get(
  "/tabela/:tabelaPrecoId",
  proteger,
  listarPrecosPorTabela
);

export default router;