import express from "express";
import { listarCatalogoCliente } from "../controllers/catalogoController.js";
import { proteger } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", proteger, listarCatalogoCliente);

export default router;