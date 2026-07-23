import express from "express";
import {
  atualizarProgresso,
  buscarTreinamentoCliente,
  listarTreinamentosCliente,
} from "../controllers/treinamentoController.js";
import { proteger } from "../middlewares/authMiddleware.js";
import { somenteCliente } from "../middlewares/clienteMiddleware.js";
import { validateObjectIdParam } from "../utils/validation.js";

const router = express.Router();

router.use(proteger, somenteCliente);
router.get("/", listarTreinamentosCliente);
router.get("/:id", validateObjectIdParam(), buscarTreinamentoCliente);
router.put("/:id/progresso", validateObjectIdParam(), atualizarProgresso);

export default router;
