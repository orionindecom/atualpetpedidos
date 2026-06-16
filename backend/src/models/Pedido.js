import mongoose from "mongoose";

const itemPedidoSchema = new mongoose.Schema(
  {
    produtoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Produto",
      required: true,
    },

    nomeProduto: {
      type: String,
      required: true,
      trim: true,
    },

    quantidade: {
      type: Number,
      required: true,
      min: 1,
    },

    valorUnitario: {
      type: Number,
      required: true,
      min: 0,
    },

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const pedidoSchema = new mongoose.Schema(
  {
    numeroPedido: {
      type: String,
      required: true,
      unique: true,
    },

    clienteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Usuario",
      required: true,
    },

    nomeResponsavel: {
      type: String,
      trim: true,
    },

    nomeFantasiaCliente: {
      type: String,
      trim: true,
    },

    razaoSocialCliente: {
      type: String,
      trim: true,
    },

    cnpjCliente: {
      type: String,
      trim: true,
    },

    emailCliente: {
      type: String,
      trim: true,
    },

    telefoneCliente: {
      type: String,
      trim: true,
    },

    whatsappCliente: {
      type: String,
      trim: true,
    },

    tabelaPrecoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TabelaPreco",
      required: true,
    },

    nomeTabela: {
      type: String,
      trim: true,
    },

    dataPedido: {
      type: Date,
      default: Date.now,
    },

    dia: {
      type: Number,
      required: true,
    },

    mes: {
      type: Number,
      required: true,
    },

    ano: {
      type: Number,
      required: true,
    },

    itens: {
      type: [itemPedidoSchema],
      required: true,
      validate: {
        validator: function (itens) {
          return itens.length > 0;
        },
        message: "O pedido precisa ter pelo menos um item",
      },
    },

    valorTotal: {
      type: Number,
      required: true,
      min: 0,
    },

    status: {
      type: String,
      enum: ["novo", "processando", "faturado", "cancelado"],
      default: "novo",
    },

    observacao: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Pedido", pedidoSchema);