import express from "express";
import {
  cadastrarProduto,
  listarProdutos,
} from "../controllers/produtoController.js";

import { proteger } from "../middlewares/authMiddleware.js";
import { somenteAdmin } from "../middlewares/adminMiddleware.js";

const router = express.Router();

router.post(
  "/",
  proteger,
  somenteAdmin,
  cadastrarProduto
);

router.get(
  "/",
  proteger,
  listarProdutos
);

export default router;