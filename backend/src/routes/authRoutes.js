import express from "express";
import { cadastrar, cadastrarGroomer, login } from "../controllers/authController.js";
import {
  cadastroLimiter,
  loginLimiter,
} from "../middlewares/rateLimitMiddleware.js";

const router = express.Router();

router.post("/cadastro", cadastroLimiter, cadastrar);
router.post("/cadastro-groomer", cadastroLimiter, cadastrarGroomer);
router.post("/login", loginLimiter, login);

export default router;
