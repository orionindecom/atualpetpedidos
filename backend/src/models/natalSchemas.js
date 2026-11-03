import mongoose from "mongoose";

// Subdocumentos compartilhados pelos modelos da campanha Natal Premiado 2026.

export const autorNatalSchema = new mongoose.Schema(
  {
    usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario" },
    usuarioNome: { type: String, trim: true, maxlength: 160 },
    usuarioTipo: {
      type: String,
      enum: ["admin", "comercial", "vendedor", "cliente", "logistica", "sistema", "publico"],
      required: true,
    },
  },
  { _id: false }
);

export const beneficiosNatalSchema = new mongoose.Schema(
  {
    // Nível 0 representa "sem benefícios" (pedido abaixo de R$ 12.000 após revisão).
    nivel: { type: Number, required: true, min: 0 },
    valorMinimo: { type: Number, required: true, min: 0 },
    cupons: { type: Number, required: true, min: 0 },
    marketingPercentual: { type: Number, required: true, min: 0 },
    produtosPercentual: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

export const buildAutorNatal = (usuario, fallbackTipo = "sistema") => {
  if (!usuario) return { usuarioTipo: fallbackTipo, usuarioNome: fallbackTipo === "sistema" ? "Sistema" : undefined };
  return {
    usuarioId: usuario._id,
    usuarioNome: usuario.nomeResponsavel || usuario.nomeFantasia || usuario.nomeProfissional || "Usuário",
    usuarioTipo: usuario.tipo,
  };
};
