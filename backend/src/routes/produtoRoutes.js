import express from "express";
import { exigirPermissao } from '../middlewares/permissionMiddleware.js';
import {
  cadastrarProduto,
  listarProdutos,
  atualizarProduto,
  inativarProduto,
} from "../controllers/produtoController.js";
import upload, {
  validarAssinaturaImagem,
} from "../middlewares/uploadProduto.js";

import { proteger } from "../middlewares/authMiddleware.js";
import {
  somenteAdmin,
  somenteGestorComercial,
} from "../middlewares/adminMiddleware.js";
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
  validarAssinaturaImagem,
  cadastrarProduto
);

router.get(
  "/",
  proteger,
  exigirPermissao('comercial', 'pedidosTodos', 'pedidosCarteira'),
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
  validarAssinaturaImagem,
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
