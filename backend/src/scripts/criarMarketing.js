import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Usuario from "../models/Usuario.js";
import { assertMutationAllowed } from "../utils/scriptSafety.js";
import {
  isStrongEnoughPassword,
  isValidEmail,
} from "../utils/validation.js";

dotenv.config({ quiet: true });

const run = async () => {
  assertMutationAllowed({
    action: "criar usuário de marketing",
    confirmationVariable: "CONFIRM_CREATE_MARKETING",
  });

  const email = process.env.MARKETING_EMAIL?.trim().toLowerCase();
  const password = process.env.MARKETING_PASSWORD;
  const name = process.env.MARKETING_NAME?.trim() || "Marketing AtualPet";

  if (!isValidEmail(email) || !isStrongEnoughPassword(password)) {
    throw new Error(
      "Defina MARKETING_EMAIL válido e MARKETING_PASSWORD com pelo menos 8 caracteres."
    );
  }

  if (name.length > 120) {
    throw new Error("MARKETING_NAME deve ter no máximo 120 caracteres.");
  }

  await connectDB();

  const existing = await Usuario.findOne({ email }).select("_id tipo").lean();
  if (existing) {
    throw new Error("Já existe um usuário com o e-mail informado.");
  }

  await Usuario.create({
    nomeResponsavel: name,
    email,
    senha: await bcrypt.hash(password, 10),
    tipo: "marketing",
    ativo: true,
    statusCadastro: "aprovado",
  });

  console.log("Usuário de marketing criado com sucesso.");
};

run()
  .catch((error) => {
    console.error(error.message || "Falha ao criar usuário de marketing.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
