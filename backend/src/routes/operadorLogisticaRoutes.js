import express from "express";
import {
  atualizarOperador,
  cadastrarOperador,
  listarOperadoresAdmin,
  redefinirPinOperador,
} from "../controllers/operadorLogisticaController.js";
import { somenteAdmin } from "../middlewares/adminMiddleware.js";
import { proteger } from "../middlewares/authMiddleware.js";
import { adminLimiter } from "../middlewares/rateLimitMiddleware.js";
import { validateObjectIdParam } from "../utils/validation.js";

const router = express.Router();

router.use(proteger, somenteAdmin, adminLimiter);
router.get("/", listarOperadoresAdmin);
router.post("/", cadastrarOperador);
router.patch("/:id", validateObjectIdParam(), atualizarOperador);
router.patch("/:id/pin", validateObjectIdParam(), redefinirPinOperador);

export default router;
