import express from "express";
import { resumoDashboard } from "../controllers/dashboardController.js";
import { proteger } from "../middlewares/authMiddleware.js";
import { somenteAdmin } from "../middlewares/adminMiddleware.js";

const router = express.Router();

router.get("/", proteger, somenteAdmin, resumoDashboard);

export default router;