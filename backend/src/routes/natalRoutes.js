import express from "express";
import {
  alterarFechamentoHandler,
  aprovarParticipacaoHandler,
  auditoriaGestao,
  beneficiosMeusPedidos,
  beneficiosPedido,
  buscarCupomHandler,
  cancelarParticipacaoHandler,
  comprovanteParticipacao,
  detalheParticipacao,
  enviarParticipacaoPublica,
  exportacoesGestao,
  exportarCupons,
  lotesGestao,
  middlewaresNatal,
  obterConfigPublica,
  obterLinkPublico,
  painelGestao,
  participacoesDistribuidor,
  participacoesGestao,
  reconciliarHandler,
  rejeitarParticipacaoHandler,
  resumoDistribuidor,
  validarIdParticipacao,
} from "../controllers/natalController.js";
import { proteger } from "../middlewares/authMiddleware.js";
import {
  adminLimiter,
  natalConsultaLimiter,
  natalEnvioLimiter,
  natalEnvioLoteLimiter,
} from "../middlewares/rateLimitMiddleware.js";
import { receberComprovante } from "../middlewares/uploadComprovante.js";
import { validateObjectIdParam } from "../utils/validation.js";

const { exigirAdmin, exigirDistribuidor, exigirGestor } = middlewaresNatal;

// Rotas públicas do formulário (sem autenticação). O código do lote é a única credencial.
export const natalPublicRoutes = express.Router();
natalPublicRoutes.get("/config", natalConsultaLimiter, obterConfigPublica);
natalPublicRoutes.get("/lotes/:codigo", natalConsultaLimiter, obterLinkPublico);
natalPublicRoutes.post(
  "/lotes/:codigo/participacoes",
  natalEnvioLimiter,
  natalEnvioLoteLimiter,
  receberComprovante,
  enviarParticipacaoPublica
);

// Rotas internas: distribuidor (somente os próprios lotes) e gestão (Comercial/Admin).
const router = express.Router();
router.use(proteger, adminLimiter);

router.get("/distribuidor/resumo", exigirDistribuidor, resumoDistribuidor);
router.get("/distribuidor/participacoes", exigirDistribuidor, participacoesDistribuidor);
router.get("/distribuidor/pedidos-beneficios", exigirDistribuidor, beneficiosMeusPedidos);

router.get("/pedidos/:id/beneficios", validateObjectIdParam(), beneficiosPedido);

router.get("/participacoes/:id", validarIdParticipacao, detalheParticipacao);
router.get("/participacoes/:id/comprovante", validarIdParticipacao, comprovanteParticipacao);
router.post("/participacoes/:id/cancelar", validarIdParticipacao, cancelarParticipacaoHandler);
router.post("/participacoes/:id/aprovar", exigirGestor, validarIdParticipacao, aprovarParticipacaoHandler);
router.post("/participacoes/:id/rejeitar", exigirGestor, validarIdParticipacao, rejeitarParticipacaoHandler);

router.get("/gestao/painel", exigirGestor, painelGestao);
router.get("/gestao/lotes", exigirGestor, lotesGestao);
router.get("/gestao/participacoes", exigirGestor, participacoesGestao);
router.get("/gestao/cupons/:numero", exigirGestor, buscarCupomHandler);
router.get("/gestao/auditoria", exigirGestor, auditoriaGestao);
router.get("/gestao/exportacoes", exigirGestor, exportacoesGestao);
router.get("/gestao/exportacoes/pdf-urna", exigirGestor, exportarCupons("pdf_urna"));
router.get("/gestao/exportacoes/lista-numerica", exigirGestor, exportarCupons("csv_numerica"));
router.post("/gestao/fechamento", exigirAdmin, alterarFechamentoHandler);
router.post("/gestao/reconciliar", exigirAdmin, reconciliarHandler);

export default router;
