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
import {
  adminLimiter,
  uploadLimiter,
} from "../middlewares/rateLimitMiddleware.js";
import upload, {
  validarAssinaturaImagem,
} from "../middlewares/uploadProduto.js";
import { validateObjectIdParam } from "../utils/validation.js";

const router = express.Router();

router.use(proteger, somenteAdmin, adminLimiter);

router.get("/", listarMateriaisAdmin);
router.post(
  "/",
  uploadLimiter,
  upload.single("imagemCapa"),
  validarAssinaturaImagem,
  criarMaterial
);
router.get("/:id", validateObjectIdParam(), buscarMaterialAdmin);
router.put(
  "/:id",
  validateObjectIdParam(),
  uploadLimiter,
  upload.single("imagemCapa"),
  validarAssinaturaImagem,
  atualizarMaterial
);
router.patch("/:id/status", validateObjectIdParam(), alterarStatusMaterial);
router.delete("/:id", validateObjectIdParam(), excluirMaterial);

export default router;
