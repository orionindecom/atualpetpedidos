import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import TabelaPreco from "../models/TabelaPreco.js";

dotenv.config({ quiet: true });

const possuiCampo = (documento, campo) =>
  Object.prototype.hasOwnProperty.call(documento, campo);

const valorDiagnostico = (documento, campo) =>
  possuiCampo(documento, campo) ? documento[campo] : null;

const executarDiagnostico = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI nao configurada");
  }

  await connectDB();

  const host = [mongoose.connection.host, mongoose.connection.port]
    .filter(Boolean)
    .join(":");
  const tabelas = await TabelaPreco.find({}).lean();
  const porTipo = {};

  for (const tabela of tabelas) {
    if (!possuiCampo(tabela, "tipo")) {
      continue;
    }

    const tipo = String(tabela.tipo);
    porTipo[tipo] = (porTipo[tipo] || 0) + 1;
  }

  console.log("=== DIAGNOSTICO DE TABELAS DE PRECO ===");
  console.log(`NODE_ENV: ${process.env.NODE_ENV || "nao definido"}`);
  console.log(`Banco MongoDB: ${mongoose.connection.name}`);
  console.log(`Host MongoDB: ${host || "nao identificado"}`);
  console.log("\nTabelas encontradas:");

  for (const tabela of tabelas) {
    console.log(
      JSON.stringify(
        {
          _id: String(tabela._id),
          nome: valorDiagnostico(tabela, "nome"),
          tipo: valorDiagnostico(tabela, "tipo"),
          ativa: valorDiagnostico(tabela, "ativa"),
          ativo: valorDiagnostico(tabela, "ativo"),
          descricao: valorDiagnostico(tabela, "descricao"),
          createdAt: valorDiagnostico(tabela, "createdAt"),
          updatedAt: valorDiagnostico(tabela, "updatedAt"),
        },
        null,
        2
      )
    );
  }

  console.log("\nTotais:");
  console.log(`Total de tabelas: ${tabelas.length}`);
  console.log(
    `Tabelas com ativa=true: ${tabelas.filter((tabela) => tabela.ativa === true).length}`
  );
  console.log(
    `Tabelas com ativa=false: ${tabelas.filter((tabela) => tabela.ativa === false).length}`
  );
  console.log(
    `Tabelas sem campo ativa: ${tabelas.filter((tabela) => !possuiCampo(tabela, "ativa")).length}`
  );
  console.log(`Tabelas por tipo: ${JSON.stringify(porTipo, null, 2)}`);
  console.log(
    `Tabelas sem campo tipo: ${tabelas.filter((tabela) => !possuiCampo(tabela, "tipo")).length}`
  );
};

executarDiagnostico()
  .catch((error) => {
    const mensagem = String(error?.message || "Falha no diagnostico").replace(
      process.env.MONGO_URI || "__MONGO_URI_AUSENTE__",
      "[MONGO_URI ocultada]"
    );
    console.error(`Diagnostico interrompido: ${mensagem}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
