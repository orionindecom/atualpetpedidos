import express from "express";
import {
  exportarMetricasPedidosPdfAdmin,
  listarMetricasPedidosAdmin,
} from "../controllers/pedidoMetricasController.js";
import { somenteAdmin } from "../middlewares/adminMiddleware.js";
import { proteger } from "../middlewares/authMiddleware.js";
import { adminLimiter } from "../middlewares/rateLimitMiddleware.js";

const router = express.Router();

router.use(proteger, somenteAdmin, adminLimiter);
router.get("/", listarMetricasPedidosAdmin);
router.get("/pdf", exportarMetricasPedidosPdfAdmin);

export default router;

