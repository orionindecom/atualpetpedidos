import express from "express";
import {
  listarCatalogoCliente,
  listarPrecosClienteFinal,
} from "../controllers/catalogoController.js";
import { proteger } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", proteger, listarCatalogoCliente);
router.get("/cliente-final", proteger, listarPrecosClienteFinal);

export default router;
