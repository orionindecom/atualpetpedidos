import express from "express";
import {
  cadastrarProduto,
  listarProdutos,
  atualizarProduto,
  inativarProduto,
} from "../controllers/produtoController.js";
import upload from "../middlewares/uploadProduto.js";

import { proteger } from "../middlewares/authMiddleware.js";
import { somenteAdmin } from "../middlewares/adminMiddleware.js";

const router = express.Router();

router.post(
  "/",
  proteger,
  somenteAdmin,
  upload.single("foto"),
  cadastrarProduto
);

router.get(
  "/",
  proteger,
  listarProdutos
);

router.put(
  "/:id",
  proteger,
  somenteAdmin,
  upload.single("foto"),
  atualizarProduto
);

router.delete(
  "/:id",
  proteger,
  somenteAdmin,
  inativarProduto
);

export default router;