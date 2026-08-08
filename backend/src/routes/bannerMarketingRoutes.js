import express from "express";
import { listarBannersCliente } from "../controllers/bannerMarketingController.js";
import { proteger } from "../middlewares/authMiddleware.js";
import { somenteCliente } from "../middlewares/clienteMiddleware.js";

const router = express.Router();

router.get("/", proteger, somenteCliente, listarBannersCliente);

export default router;

