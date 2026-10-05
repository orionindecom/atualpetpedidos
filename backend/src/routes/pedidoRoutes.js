import { exigirPermissao } from "../middlewares/permissionMiddleware.js";
import express from "express";

import {
  criarPedido,
  confirmarRecebimento,
  listarMeusPedidos,
  listarTodosPedidos,
  buscarPedidoPorId,
  gerarPdf,
  gerarRelatorioPedidoAdmin,
  atualizarStatusPedido,
  aprovarPedidoAdmin,
  atualizarPedidoAdmin,
  excluirPedidoAdmin,
} from "../controllers/pedidoController.js";

import { proteger } from "../middlewares/authMiddleware.js";
import { somenteAdmin } from "../middlewares/adminMiddleware.js";
import { marcarPedidoEnviadoAdmin, marcarPedidoRetiradoAdmin } from "../controllers/pedidoSaidaController.js";
import { listarCatalogoDistribuidor, listarDistribuidoresPedido } from "../controllers/pedidoComercialController.js";
import {
  somenteCliente,
} from "../middlewares/clienteMiddleware.js";
import {
  adminLimiter,
  pedidoLimiter,
} from "../middlewares/rateLimitMiddleware.js";
import { validateObjectIdParam } from "../utils/validation.js";

const router = express.Router();

router.patch("/:id/marcar-enviado", proteger, somenteAdmin, adminLimiter, validateObjectIdParam(), marcarPedidoEnviadoAdmin);
router.patch("/:id/retirar", proteger, somenteAdmin, adminLimiter, validateObjectIdParam(), marcarPedidoRetiradoAdmin);

router.get("/comercial/distribuidores", proteger, exigirPermissao("clientes"), adminLimiter, listarDistribuidoresPedido);
router.get("/comercial/distribuidores/:id/catalogo", proteger, exigirPermissao("clientes"), adminLimiter, validateObjectIdParam(), listarCatalogoDistribuidor);
router.post("/comercial", proteger, exigirPermissao("criarPedidos"), pedidoLimiter, criarPedido);

router.post(
  "/",
  proteger,
  somenteCliente,
  pedidoLimiter,
  criarPedido
);

router.get(
  "/meus",
  proteger,
  somenteCliente,
  listarMeusPedidos
);

router.get(
  "/",
  proteger,
  exigirPermissao("pedidosTodos", "pedidosCarteira"),
  adminLimiter,
  listarTodosPedidos
);

router.patch(
  "/:id/confirmar-recebimento",
  proteger,
  somenteCliente,
  pedidoLimiter,
  validateObjectIdParam(),
  confirmarRecebimento
);

router.patch(
  "/:id/aprovar",
  proteger,
  exigirPermissao("pedidosTodos", "pedidosCarteira"),
  adminLimiter,
  validateObjectIdParam(),
  exigirPermissao("aprovarPedidos"),
  aprovarPedidoAdmin
);

router.get(
  "/:id/aprovacao",
  proteger,
  exigirPermissao("pedidosTodos", "pedidosCarteira"),
  validateObjectIdParam(),
  buscarPedidoPorId
);

router.get(
  "/:id/pdf",
  proteger,
  (req, res, next) => req.usuario.tipo === "cliente" ? next() : exigirPermissao("pedidosTodos", "pedidosCarteira")(req, res, next),
  validateObjectIdParam(),
  gerarPdf
);

router.get(
  "/:id/relatorio",
  proteger,
  somenteAdmin,
  adminLimiter,
  validateObjectIdParam(),
  gerarRelatorioPedidoAdmin
);

router.put(
  "/:id",
  proteger,
  exigirPermissao("pedidosTodos", "pedidosCarteira"),
  adminLimiter,
  validateObjectIdParam(),
  exigirPermissao("editarPedidos"),
  atualizarPedidoAdmin
);

router.delete(
  "/:id",
  proteger,
  exigirPermissao("pedidosTodos", "pedidosCarteira"),
  adminLimiter,
  validateObjectIdParam(),
  exigirPermissao("excluirPedidos"),
  excluirPedidoAdmin
);

router.get(
  "/:id",
  proteger,
  (req, res, next) => req.usuario.tipo === "cliente" ? next() : exigirPermissao("pedidosTodos", "pedidosCarteira")(req, res, next),
  validateObjectIdParam(),
  buscarPedidoPorId
);

router.put(
  "/:id/status",
  proteger,
  somenteAdmin,
  adminLimiter,
  validateObjectIdParam(),
  atualizarStatusPedido
);



export default router;
