import express from "express";
import {
  criarTabela,
  listarTabelas,
  atualizarTabela,
  duplicarTabela,
} from "../controllers/tabelaPrecoController.js";

import { proteger } from "../middlewares/authMiddleware.js";
import { somenteAdmin } from "../middlewares/adminMiddleware.js";

const router = express.Router();

router.post("/", proteger, somenteAdmin, criarTabela);

router.get("/", proteger, listarTabelas);

router.put("/:id", proteger, somenteAdmin, atualizarTabela);

router.post("/:id/duplicar", proteger, somenteAdmin, duplicarTabela);

export default router;