import express from "express";
import { resumoDashboard } from "../controllers/dashboardController.js";
import { proteger } from "../middlewares/authMiddleware.js";
import { somenteAdmin } from "../middlewares/adminMiddleware.js";
import { adminLimiter } from "../middlewares/rateLimitMiddleware.js";

const router = express.Router();

router.get("/", proteger, somenteAdmin, adminLimiter, resumoDashboard);

export default router;
