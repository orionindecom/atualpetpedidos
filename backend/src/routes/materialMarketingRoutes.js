import express from "express";
import { listarMateriaisCliente } from "../controllers/materialMarketingController.js";
import { proteger } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", proteger, listarMateriaisCliente);

export default router;
