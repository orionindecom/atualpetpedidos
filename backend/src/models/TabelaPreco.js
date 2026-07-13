import mongoose from "mongoose";

const tabelaPrecoSchema = new mongoose.Schema(
  {
    nome: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    descricao: {
      type: String,
      trim: true,
    },

    tipo: {
      type: String,
      enum: ["distribuidor", "cliente_final_internet", "cliente_final_loja"],
      default: "distribuidor",
    },

    ativa: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

tabelaPrecoSchema.index({ tipo: 1, ativa: 1, updatedAt: -1 });

export default mongoose.model(
  "TabelaPreco",
  tabelaPrecoSchema
);
