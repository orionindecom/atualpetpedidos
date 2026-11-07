import express from "express";
import {
  adicionarCuponsHandler,
  ajustarCuponsHandler,
  aprovarDistribuicaoHandler,
  cancelarDistribuicaoHandler,
  comprovanteDistribuicao,
  detalheDistribuicaoHandler,
  rejeitarDistribuicaoHandler,
  resultadoSorteioHandler,
  alterarFechamentoHandler,
  aplicarSubstituicaoHandler,
  aprovarParticipacaoHandler,
  auditoriaGestao,
  beneficiosMeusPedidos,
  beneficiosPedido,
  buscarClientesGestao,
  buscarCupomHandler,
  cancelarCompraExternaHandler,
  cancelarParticipacaoHandler,
  comprasExternasGestao,
  comprovanteCompraExterna,
  comprovanteParticipacao,
  detalheDistribuidorGestao,
  detalheParticipacao,
  distribuidoresGestao,
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
  previaRevisaoHandler,
  previaSubstituicaoHandler,
  reconciliarHandler,
  registrarCompraExternaHandler,
  registrarEntregaHandler,
  rejeitarCompraExternaHandler,
  rejeitarParticipacaoHandler,
  resolverRevisaoHandler,
  resumoDistribuidor,
  validarCompraExternaHandler,
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
// Lotes de cupons: o distribuidor dono adiciona; só a gestão valida, rejeita ou cancela.
router.post("/participacoes/:id/distribuicoes", exigirDistribuidor, validarIdParticipacao, natalEnvioLimiter, receberComprovante, adicionarCuponsHandler);
router.get("/distribuicoes/:id", validarIdParticipacao, detalheDistribuicaoHandler);
router.get("/distribuicoes/:id/comprovante", validarIdParticipacao, comprovanteDistribuicao);
router.post("/distribuicoes/:id/aprovar", exigirGestor, validarIdParticipacao, aprovarDistribuicaoHandler);
router.post("/distribuicoes/:id/rejeitar", exigirGestor, validarIdParticipacao, rejeitarDistribuicaoHandler);
router.post("/distribuicoes/:id/cancelar", exigirGestor, validarIdParticipacao, cancelarDistribuicaoHandler);

router.get("/gestao/painel", exigirGestor, painelGestao);
router.get("/gestao/lotes", exigirGestor, lotesGestao);
router.get("/gestao/distribuidores", exigirGestor, distribuidoresGestao);
router.get("/gestao/distribuidores-busca", exigirGestor, buscarClientesGestao);
router.get("/gestao/distribuidores/:id", exigirGestor, validateObjectIdParam(), detalheDistribuidorGestao);
router.post("/gestao/distribuidores/:id/ajustes-cupons", exigirGestor, validateObjectIdParam(), ajustarCuponsHandler);
router.get("/gestao/distribuidores/:id/revisao", exigirGestor, validateObjectIdParam(), previaRevisaoHandler);
router.post("/gestao/distribuidores/:id/revisao", exigirGestor, validateObjectIdParam(), resolverRevisaoHandler);
router.post("/gestao/distribuidores/:id/compras-externas", exigirGestor, receberComprovante, registrarCompraExternaHandler);
router.get("/gestao/compras-externas", exigirGestor, comprasExternasGestao);
router.post("/gestao/compras-externas/:id/validar", exigirGestor, validateObjectIdParam(), validarCompraExternaHandler);
router.post("/gestao/compras-externas/:id/rejeitar", exigirGestor, validateObjectIdParam(), rejeitarCompraExternaHandler);
router.post("/gestao/compras-externas/:id/cancelar", exigirGestor, validateObjectIdParam(), cancelarCompraExternaHandler);
router.get("/gestao/compras-externas/:id/comprovante", exigirGestor, validateObjectIdParam(), comprovanteCompraExterna);
router.post("/gestao/bonificacoes/:id/entregas", exigirGestor, validateObjectIdParam(), registrarEntregaHandler);
router.get("/gestao/participacoes", exigirGestor, participacoesGestao);
router.get("/gestao/cupons/:numero", exigirGestor, buscarCupomHandler);
router.get("/gestao/cupons/:numero/resultado", exigirGestor, resultadoSorteioHandler);
router.get("/gestao/auditoria", exigirGestor, auditoriaGestao);
router.get("/gestao/exportacoes", exigirGestor, exportacoesGestao);
router.get("/gestao/exportacoes/pdf-urna", exigirGestor, exportarCupons("pdf_urna"));
router.get("/gestao/exportacoes/lista-numerica", exigirGestor, exportarCupons("csv_numerica"));
router.get("/gestao/exportacoes/pdf-auditoria", exigirGestor, exportarCupons("pdf_auditoria"));
router.get("/gestao/exportacoes/pdf-auditoria-publica", exigirGestor, exportarCupons("pdf_auditoria_publica"));
router.post("/gestao/pedidos/:id/substituicao/previa", exigirAdmin, validateObjectIdParam(), previaSubstituicaoHandler);
router.post("/gestao/pedidos/:id/substituicao", exigirAdmin, validateObjectIdParam(), aplicarSubstituicaoHandler);
router.post("/gestao/fechamento", exigirAdmin, alterarFechamentoHandler);
router.post("/gestao/reconciliar", exigirAdmin, reconciliarHandler);

export default router;
