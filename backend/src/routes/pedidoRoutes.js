import express from "express";

import {
  criarPedido,
  listarMeusPedidos,
  listarTodosPedidos,
  buscarPedidoPorId,
  gerarPdf,
  atualizarStatusPedido,
} from "../controllers/pedidoController.js";

import { proteger } from "../middlewares/authMiddleware.js";
import { somenteAdmin } from "../middlewares/adminMiddleware.js";

const router = express.Router();

router.post(
  "/",
  proteger,
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
  listarTodosPedidos
);

router.get(
  "/:id/pdf",
  proteger,
  gerarPdf
);

router.get(
  "/:id",
  proteger,
  buscarPedidoPorId
);

router.put(
  "/:id/status",
  proteger,
  somenteAdmin,
  atualizarStatusPedido
);

export default router;