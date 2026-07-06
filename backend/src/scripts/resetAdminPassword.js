import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import Usuario from "../models/Usuario.js";
import { connectDB } from "../config/db.js";
import {
  isStrongEnoughPassword,
  isValidEmail,
} from "../utils/validation.js";

dotenv.config();

const resetAdminPassword = async () => {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!isValidEmail(adminEmail)) {
      console.error("ADMIN_EMAIL inválido.");
      process.exit(1);
    }

    if (!isStrongEnoughPassword(adminPassword)) {
      console.error(
        "ADMIN_PASSWORD deve possuir pelo menos 8 caracteres."
      );
      process.exit(1);
    }

    await connectDB();

    const admin = await Usuario.findOne({
      email: adminEmail.trim().toLowerCase(),
      tipo: "admin",
    });

    if (!admin) {
      console.error("Administrador não encontrado.");
      process.exit(1);
    }

    const senhaHash = await bcrypt.hash(adminPassword, 10);

    admin.senha = senhaHash;

    // Invalida todos os tokens antigos
    admin.tokenVersion = (admin.tokenVersion || 0) + 1;

    await admin.save();

    console.log("✅ Senha do administrador atualizada com sucesso.");
    console.log("✅ Todos os tokens antigos foram invalidados.");

    process.exit(0);
  } catch (error) {
    console.error("Erro ao atualizar senha:", error);
    process.exit(1);
  }
};

resetAdminPassword();