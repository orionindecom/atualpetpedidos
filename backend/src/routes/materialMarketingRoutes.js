import express from "express";
import { listarMateriaisCliente } from "../controllers/materialMarketingController.js";
import { proteger } from "../middlewares/authMiddleware.js";
import { somenteCliente } from "../middlewares/clienteMiddleware.js";

const router = express.Router();

router.get("/", proteger, somenteCliente, listarMateriaisCliente);

export default router;
