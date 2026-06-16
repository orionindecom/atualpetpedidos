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

    ativa: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model(
  "TabelaPreco",
  tabelaPrecoSchema
);