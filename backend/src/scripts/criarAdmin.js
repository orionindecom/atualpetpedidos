import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import Usuario from "../models/Usuario.js";
import { connectDB } from "../config/db.js";
import {
  isStrongEnoughPassword,
  isValidEmail,
} from "../utils/validation.js";

dotenv.config();

const criarAdmin = async () => {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!isValidEmail(adminEmail) || !isStrongEnoughPassword(adminPassword)) {
      console.error(
        "Defina ADMIN_EMAIL válido e ADMIN_PASSWORD com pelo menos 8 caracteres."
      );
      process.exit(1);
    }

    await connectDB();

    const emailNormalizado = adminEmail.trim().toLowerCase();

    const adminExiste = await Usuario.findOne({
      email: emailNormalizado,
    });

    if (adminExiste) {
      console.log("Administrador já existe");
      process.exit();
    }

    const senhaHash = await bcrypt.hash(adminPassword, 10);

    await Usuario.create({
      nomeResponsavel: "Administrador",
      email: emailNormalizado,
      senha: senhaHash,
      tipo: "admin",
      ativo: true,
      statusCadastro: "aprovado",
    });

    console.log("Administrador criado com sucesso");

    process.exit();
  } catch (error) {
    console.error("Erro ao criar administrador");
    process.exit(1);
  }
};

criarAdmin();
