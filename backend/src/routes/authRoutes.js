import { effectivePermissions } from "../utils/permissions.js";
import { proteger } from "../middlewares/authMiddleware.js";
import express from "express";
import { cadastrar, cadastrarGroomer, login } from "../controllers/authController.js";
import {
  cadastroLimiter,
  loginLimiter,
} from "../middlewares/rateLimitMiddleware.js";

const router = express.Router();

router.get("/me", proteger, (req, res) => {
  const usuario = req.usuario.toObject ? req.usuario.toObject() : { ...req.usuario };
  delete usuario.tokenVersion;
  return res.json({ usuario: { ...usuario, permissoesEfetivas: effectivePermissions(usuario) } });
});
router.post("/cadastro", cadastroLimiter, cadastrar);
router.post("/cadastro-groomer", cadastroLimiter, cadastrarGroomer);
router.post("/login", loginLimiter, login);

export default router;
