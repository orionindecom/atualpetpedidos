import express from "express";
import {
  criarTabela,
  listarTabelas,
} from "../controllers/tabelaPrecoController.js";

import { proteger } from "../middlewares/authMiddleware.js";
import { somenteAdmin } from "../middlewares/adminMiddleware.js";

const router = express.Router();

router.post(
  "/",
  proteger,
  somenteAdmin,
  criarTabela
);

router.get(
  "/",
  proteger,
  listarTabelas
);

export default router;