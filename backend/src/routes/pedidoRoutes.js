import express from "express";

import {
  criarPedido,
  confirmarRecebimento,
  listarMeusPedidos,
  listarTodosPedidos,
  buscarPedidoPorId,
  gerarPdf,
  gerarRelatorioPedidoAdmin,
  atualizarStatusPedido,
  aprovarPedidoAdmin,
  atualizarPedidoAdmin,
  excluirPedidoAdmin,
} from "../controllers/pedidoController.js";

import { proteger } from "../middlewares/authMiddleware.js";
import { somenteAdmin, somenteGestorComercial } from "../middlewares/adminMiddleware.js";
import {
  somenteCliente,
  somenteClienteOuAdmin,
} from "../middlewares/clienteMiddleware.js";
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
  somenteGestorComercial,
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

router.patch(
  "/:id/aprovar",
  proteger,
  somenteGestorComercial,
  adminLimiter,
  validateObjectIdParam(),
  aprovarPedidoAdmin
);

router.get(
  "/:id/aprovacao",
  proteger,
  somenteGestorComercial,
  validateObjectIdParam(),
  buscarPedidoPorId
);

router.get(
  "/:id/pdf",
  proteger,
  somenteClienteOuAdmin,
  validateObjectIdParam(),
  gerarPdf
);

router.get(
  "/:id/relatorio",
  proteger,
  somenteAdmin,
  adminLimiter,
  validateObjectIdParam(),
  gerarRelatorioPedidoAdmin
);

router.put(
  "/:id",
  proteger,
  somenteGestorComercial,
  adminLimiter,
  validateObjectIdParam(),
  atualizarPedidoAdmin
);

router.delete(
  "/:id",
  proteger,
  somenteGestorComercial,
  adminLimiter,
  validateObjectIdParam(),
  excluirPedidoAdmin
);

router.get(
  "/:id",
  proteger,
  somenteClienteOuAdmin,
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
