import express from "express";
import {
  alterarStatusMaterial,
  atualizarMaterial,
  buscarMaterialAdmin,
  criarMaterial,
  excluirMaterial,
  listarMateriaisAdmin,
} from "../controllers/materialMarketingController.js";
import { somenteAdmin } from "../middlewares/adminMiddleware.js";
import { proteger } from "../middlewares/authMiddleware.js";
import { adminLimiter } from "../middlewares/rateLimitMiddleware.js";
import { validateObjectIdParam } from "../utils/validation.js";

const router = express.Router();

router.use(proteger, somenteAdmin, adminLimiter);

router.get("/", listarMateriaisAdmin);
router.post("/", criarMaterial);
router.get("/:id", validateObjectIdParam(), buscarMaterialAdmin);
router.put("/:id", validateObjectIdParam(), atualizarMaterial);
router.patch("/:id/status", validateObjectIdParam(), alterarStatusMaterial);
router.delete("/:id", validateObjectIdParam(), excluirMaterial);

export default router;
