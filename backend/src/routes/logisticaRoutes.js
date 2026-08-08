import express from "express";
import {
  atualizarPedidoLogistica,
  buscarPedidoLogistica,
  gerarPdfSeparacao,
  listarPedidosLogistica,
  obterDashboardLogistica,
} from "../controllers/logisticaController.js";
import { somenteOperacaoLogistica } from "../middlewares/adminMiddleware.js";
import { proteger } from "../middlewares/authMiddleware.js";
import { adminLimiter } from "../middlewares/rateLimitMiddleware.js";
import { validateObjectIdParam } from "../utils/validation.js";

const router = express.Router();

router.use(proteger, somenteOperacaoLogistica, adminLimiter);

router.get("/dashboard", obterDashboardLogistica);
router.get("/pedidos", listarPedidosLogistica);
router.get("/pedidos/:id/pdf-separacao", validateObjectIdParam(), gerarPdfSeparacao);
router.get("/pedidos/:id", validateObjectIdParam(), buscarPedidoLogistica);
router.patch("/pedidos/:id", validateObjectIdParam(), atualizarPedidoLogistica);

export default router;
