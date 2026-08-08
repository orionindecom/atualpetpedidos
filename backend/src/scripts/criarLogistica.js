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
    action: "criar usuario de logistica",
    confirmationVariable: "CONFIRM_CREATE_LOGISTICA",
  });

  const email = process.env.LOGISTICA_EMAIL?.trim().toLowerCase();
  const password = process.env.LOGISTICA_PASSWORD;
  const name = process.env.LOGISTICA_NAME?.trim() || "Logistica AtualPet";

  if (!isValidEmail(email) || !isStrongEnoughPassword(password)) {
    throw new Error(
      "Defina LOGISTICA_EMAIL valido e LOGISTICA_PASSWORD com pelo menos 8 caracteres."
    );
  }

  if (name.length > 120) {
    throw new Error("LOGISTICA_NAME deve ter no maximo 120 caracteres.");
  }

  await connectDB();

  const existing = await Usuario.findOne({ email }).select("_id tipo").lean();
  if (existing) {
    throw new Error("Ja existe um usuario com o e-mail informado.");
  }

  await Usuario.create({
    nomeResponsavel: name,
    email,
    senha: await bcrypt.hash(password, 10),
    tipo: "logistica",
    ativo: true,
    statusCadastro: "aprovado",
  });

  console.log("Usuario de logistica criado com sucesso.");
};

run()
  .catch((error) => {
    console.error(error.message || "Falha ao criar usuario de logistica.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
