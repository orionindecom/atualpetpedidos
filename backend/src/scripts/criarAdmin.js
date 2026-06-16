import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import Usuario from "../models/Usuario.js";
import { connectDB } from "../config/db.js";

dotenv.config();

const criarAdmin = async () => {
  try {
    await connectDB();

    const adminExiste = await Usuario.findOne({
      email: "admin@atualpet.com",
    });

    if (adminExiste) {
      console.log("Administrador já existe");
      process.exit();
    }

    const senhaHash = await bcrypt.hash("Admin123", 10);

    await Usuario.create({
      nomeResponsavel: "Administrador",
      email: "admin@atualpet.com",
      senha: senhaHash,
      tipo: "admin",
      ativo: true,
      statusCadastro: "aprovado",
    });

    console.log("Administrador criado com sucesso");

    process.exit();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

criarAdmin();