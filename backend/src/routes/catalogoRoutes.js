import express from "express";
import {
  listarCatalogoCliente,
  listarPrecosClienteFinal,
} from "../controllers/catalogoController.js";
import { proteger } from "../middlewares/authMiddleware.js";
import { somenteCliente } from "../middlewares/clienteMiddleware.js";

const router = express.Router();

router.get("/", proteger, somenteCliente, listarCatalogoCliente);
router.get("/cliente-final", proteger, somenteCliente, listarPrecosClienteFinal);

export default router;
