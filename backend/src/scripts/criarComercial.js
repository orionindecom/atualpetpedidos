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
    action: "criar usuário comercial",
    confirmationVariable: "CONFIRM_CREATE_COMERCIAL",
  });

  const email = process.env.COMERCIAL_EMAIL?.trim().toLowerCase();
  const password = process.env.COMERCIAL_PASSWORD;
  const name = process.env.COMERCIAL_NAME?.trim() || "Comercial AtualPet";

  if (!isValidEmail(email) || !isStrongEnoughPassword(password)) {
    throw new Error(
      "Defina COMERCIAL_EMAIL válido e COMERCIAL_PASSWORD com pelo menos 8 caracteres."
    );
  }

  if (name.length > 120) {
    throw new Error("COMERCIAL_NAME deve ter no máximo 120 caracteres.");
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
    tipo: "comercial",
    ativo: true,
    statusCadastro: "aprovado",
  });

  console.log("Usuário comercial criado com sucesso.");
};

run()
  .catch((error) => {
    console.error(error.message || "Falha ao criar usuário comercial.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
