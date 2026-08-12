import express from "express";
import {
  atualizarPedidoLogistica,
  buscarPedidoLogistica,
  gerarPdfSeparacao,
  listarPedidosLogistica,
  obterDashboardLogistica,
} from "../controllers/logisticaController.js";
import {
  identificarOperadorPedido,
  listarOperadoresAtivos,
} from "../controllers/operadorLogisticaController.js";
import {
  somenteLogistica,
  somenteOperacaoLogistica,
} from "../middlewares/adminMiddleware.js";
import { proteger } from "../middlewares/authMiddleware.js";
import { exigirContextoOperador } from "../middlewares/operadorLogisticaMiddleware.js";
import {
  adminLimiter,
  pinOperadorLimiter,
} from "../middlewares/rateLimitMiddleware.js";
import { validateObjectIdParam } from "../utils/validation.js";

const router = express.Router();

router.use(proteger, somenteOperacaoLogistica, adminLimiter);

router.get("/dashboard", obterDashboardLogistica);
router.get("/pedidos", listarPedidosLogistica);
router.get("/operadores", somenteLogistica, listarOperadoresAtivos);
router.post(
  "/pedidos/:id/identificar",
  somenteLogistica,
  pinOperadorLimiter,
  validateObjectIdParam(),
  identificarOperadorPedido
);
router.get(
  "/pedidos/:id/pdf-separacao",
  validateObjectIdParam(),
  exigirContextoOperador,
  gerarPdfSeparacao
);
router.get(
  "/pedidos/:id",
  validateObjectIdParam(),
  exigirContextoOperador,
  buscarPedidoLogistica
);
router.patch(
  "/pedidos/:id",
  validateObjectIdParam(),
  exigirContextoOperador,
  atualizarPedidoLogistica
);

export default router;
