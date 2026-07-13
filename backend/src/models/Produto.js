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
      maxlength: 300,
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

produtoSchema.index({ ativo: 1, linha: 1, categoria: 1, nome: 1 });

export default mongoose.model("Produto", produtoSchema);
