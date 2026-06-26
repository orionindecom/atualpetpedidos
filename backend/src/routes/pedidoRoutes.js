import express from "express";

import {
  criarPedido,
  listarMeusPedidos,
  listarTodosPedidos,
  buscarPedidoPorId,
  gerarPdf,
  atualizarStatusPedido,
  atualizarPedidoAdmin,
  excluirPedidoAdmin,
} from "../controllers/pedidoController.js";

import { proteger } from "../middlewares/authMiddleware.js";
import { somenteAdmin } from "../middlewares/adminMiddleware.js";
import {
  adminLimiter,
  pedidoLimiter,
} from "../middlewares/rateLimitMiddleware.js";
import { validateObjectIdParam } from "../utils/validation.js";

const router = express.Router();

router.post(
  "/",
  proteger,
  pedidoLimiter,
  criarPedido
);

router.get(
  "/meus",
  proteger,
  listarMeusPedidos
);

router.get(
  "/",
  proteger,
  somenteAdmin,
  adminLimiter,
  listarTodosPedidos
);

router.get(
  "/:id/pdf",
  proteger,
  validateObjectIdParam(),
  gerarPdf
);

router.put(
  "/:id",
  proteger,
  somenteAdmin,
  adminLimiter,
  validateObjectIdParam(),
  atualizarPedidoAdmin
);

router.delete(
  "/:id",
  proteger,
  somenteAdmin,
  adminLimiter,
  validateObjectIdParam(),
  excluirPedidoAdmin
);

router.get(
  "/:id",
  proteger,
  validateObjectIdParam(),
  buscarPedidoPorId
);

router.put(
  "/:id/status",
  proteger,
  somenteAdmin,
  adminLimiter,
  validateObjectIdParam(),
  atualizarStatusPedido
);



export default router;
