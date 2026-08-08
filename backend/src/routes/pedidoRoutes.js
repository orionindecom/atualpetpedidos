import express from "express";

import {
  criarPedido,
  confirmarRecebimento,
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
import { somenteCliente } from "../middlewares/clienteMiddleware.js";
import {
  adminLimiter,
  pedidoLimiter,
} from "../middlewares/rateLimitMiddleware.js";
import { validateObjectIdParam } from "../utils/validation.js";

const router = express.Router();

router.post(
  "/",
  proteger,
  somenteCliente,
  pedidoLimiter,
  criarPedido
);

router.get(
  "/meus",
  proteger,
  somenteCliente,
  listarMeusPedidos
);

router.get(
  "/",
  proteger,
  somenteAdmin,
  adminLimiter,
  listarTodosPedidos
);

router.patch(
  "/:id/confirmar-recebimento",
  proteger,
  somenteCliente,
  pedidoLimiter,
  validateObjectIdParam(),
  confirmarRecebimento
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
