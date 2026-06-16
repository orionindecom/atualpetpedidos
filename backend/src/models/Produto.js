import mongoose from "mongoose";

const produtoSchema = new mongoose.Schema(
  {
    nome: {
      type: String,
      required: true,
      trim: true,
    },

    descricao: {
      type: String,
      trim: true,
    },

    linha: {
      type: String,
      required: true,
      trim: true,
    },

    categoria: {
      type: String,
      required: true,
      trim: true,
    },

    fotoUrl: {
      type: String,
      trim: true,
    },

    ativo: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Produto", produtoSchema);