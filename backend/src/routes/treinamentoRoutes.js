import express from "express";
import {
  atualizarProgresso,
  buscarTreinamentoCliente,
  listarTreinamentosCliente,
} from "../controllers/treinamentoController.js";
import { proteger } from "../middlewares/authMiddleware.js";
import { somentePublicoConteudo } from "../middlewares/clienteMiddleware.js";
import { validateObjectIdParam } from "../utils/validation.js";

const router = express.Router();

router.use(proteger, somentePublicoConteudo);
router.get("/", listarTreinamentosCliente);
router.get("/:id", validateObjectIdParam(), buscarTreinamentoCliente);
router.put("/:id/progresso", validateObjectIdParam(), atualizarProgresso);

export default router;
