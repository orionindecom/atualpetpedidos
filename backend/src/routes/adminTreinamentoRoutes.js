import express from "express";
import {
  alterarStatusTreinamento,
  atualizarTreinamento,
  buscarTreinamentoAdmin,
  criarTreinamento,
  excluirTreinamento,
  listarProgressoAdmin,
  listarTreinamentosAdmin,
} from "../controllers/treinamentoController.js";
import { proteger } from "../middlewares/authMiddleware.js";
import { somenteAdmin } from "../middlewares/adminMiddleware.js";
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

router.get("/", listarTreinamentosAdmin);
router.post(
  "/",
  uploadLimiter,
  upload.single("thumbnail"),
  validarAssinaturaImagem,
  criarTreinamento
);
router.get("/:id", validateObjectIdParam(), buscarTreinamentoAdmin);
router.put(
  "/:id",
  validateObjectIdParam(),
  uploadLimiter,
  upload.single("thumbnail"),
  validarAssinaturaImagem,
  atualizarTreinamento
);
router.patch("/:id/status", validateObjectIdParam(), alterarStatusTreinamento);
router.delete("/:id", validateObjectIdParam(), excluirTreinamento);
router.get("/:id/progresso", validateObjectIdParam(), listarProgressoAdmin);

export default router;
