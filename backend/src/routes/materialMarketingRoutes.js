import { exigirPermissao } from "../middlewares/permissionMiddleware.js";
import express from "express";
import {
  buscarMaterialCliente,
  listarMateriaisCliente,
} from "../controllers/materialMarketingController.js";
import { proteger } from "../middlewares/authMiddleware.js";
import { somentePublicoConteudo } from "../middlewares/clienteMiddleware.js";
import { validateObjectIdParam } from "../utils/validation.js";

const router = express.Router();

router.use(proteger, exigirPermissao("materiais"));
router.get("/", listarMateriaisCliente);
router.get("/:id", validateObjectIdParam(), buscarMaterialCliente);

export default router;
