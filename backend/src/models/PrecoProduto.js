import mongoose from "mongoose";

const precoProdutoSchema = new mongoose.Schema(
  {
    produtoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Produto",
      required: true,
    },

    tabelaPrecoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TabelaPreco",
      required: true,
    },

    valor: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model(
  "PrecoProduto",
  precoProdutoSchema
);