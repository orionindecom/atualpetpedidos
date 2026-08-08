import express from "express";
import {
  alterarStatusBanner,
  atualizarBanner,
  criarBanner,
  excluirBanner,
  listarBannersGestao,
} from "../controllers/bannerMarketingController.js";
import { somenteGestorConteudo } from "../middlewares/adminMiddleware.js";
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

router.use(proteger, somenteGestorConteudo, adminLimiter);

router.get("/", listarBannersGestao);
router.post(
  "/",
  uploadLimiter,
  upload.single("imagem"),
  validarAssinaturaImagem,
  criarBanner
);
router.put(
  "/:id",
  validateObjectIdParam(),
  uploadLimiter,
  upload.single("imagem"),
  validarAssinaturaImagem,
  atualizarBanner
);
router.patch("/:id/status", validateObjectIdParam(), alterarStatusBanner);
router.delete("/:id", validateObjectIdParam(), excluirBanner);

export default router;

