import express from "express";
import {
  listarDistribuidoresMarketing,
  obterDashboardMarketing,
} from "../controllers/marketingController.js";
import { somenteGestorConteudo } from "../middlewares/adminMiddleware.js";
import { proteger } from "../middlewares/authMiddleware.js";
import { adminLimiter } from "../middlewares/rateLimitMiddleware.js";

const router = express.Router();

router.use(proteger, somenteGestorConteudo, adminLimiter);

router.get("/dashboard", obterDashboardMarketing);
router.get("/distribuidores", listarDistribuidoresMarketing);

export default router;
