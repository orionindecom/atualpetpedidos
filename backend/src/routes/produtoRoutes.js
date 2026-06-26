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
import {
  adminLimiter,
  uploadLimiter,
} from "../middlewares/rateLimitMiddleware.js";
import { validateObjectIdParam } from "../utils/validation.js";

const router = express.Router();

router.post(
  "/",
  proteger,
  somenteAdmin,
  adminLimiter,
  uploadLimiter,
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
  adminLimiter,
  uploadLimiter,
  validateObjectIdParam(),
  upload.single("foto"),
  atualizarProduto
);

router.delete(
  "/:id",
  proteger,
  somenteAdmin,
  adminLimiter,
  validateObjectIdParam(),
  inativarProduto
);

export default router;
