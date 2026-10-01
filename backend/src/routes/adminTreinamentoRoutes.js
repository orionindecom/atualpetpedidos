import express from "express";
import {
  alterarStatusTreinamento,
  atualizarTreinamento,
  buscarTreinamentoAdmin,
  criarTreinamento,
  excluirTreinamento,
  listarProgressoAdmin,
  listarNaoIniciadosAdmin,
  listarTreinamentosAdmin,
} from "../controllers/treinamentoController.js";
import { proteger } from "../middlewares/authMiddleware.js";
import { exigirPermissao } from "../middlewares/permissionMiddleware.js";
import {
  adminLimiter,
  uploadLimiter,
} from "../middlewares/rateLimitMiddleware.js";
import upload, {
  validarAssinaturaImagem,
} from "../middlewares/uploadProduto.js";
import { validateObjectIdParam } from "../utils/validation.js";

const router = express.Router();

router.use(proteger, adminLimiter);

router.get("/", exigirPermissao("acompanharTreinamentos"), listarTreinamentosAdmin);
router.post(
  "/",
  exigirPermissao("criarTreinamentos"),
  uploadLimiter,
  upload.single("thumbnail"),
  validarAssinaturaImagem,
  criarTreinamento
);
router.get("/:id", exigirPermissao("acompanharTreinamentos"), validateObjectIdParam(), buscarTreinamentoAdmin);
router.put(
  "/:id",
  exigirPermissao("editarTreinamentos"),
  validateObjectIdParam(),
  uploadLimiter,
  upload.single("thumbnail"),
  validarAssinaturaImagem,
  atualizarTreinamento
);
router.patch("/:id/status", exigirPermissao("editarTreinamentos"), validateObjectIdParam(), alterarStatusTreinamento);
router.delete("/:id", exigirPermissao("excluirTreinamentos"), validateObjectIdParam(), excluirTreinamento);
router.get("/:id/progresso", exigirPermissao("acompanharTreinamentos"), validateObjectIdParam(), listarProgressoAdmin);
router.get("/:id/nao-iniciados", exigirPermissao("acompanharTreinamentos"), validateObjectIdParam(), listarNaoIniciadosAdmin);

export default router;
