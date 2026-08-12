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

    quantidadeSeparada: {
      type: Number,
      min: 0,
      default: undefined,
    },

    situacaoSeparacao: {
      type: String,
      enum: ["pendente", "completo", "parcial", "indisponivel"],
      default: undefined,
    },

    quantidadeConferida: {
      type: Number,
      min: 0,
      default: undefined,
    },

    quantidadeFinal: {
      type: Number,
      min: 0,
      default: undefined,
    },

    situacaoFinal: {
      type: String,
      enum: ["completo", "parcial", "indisponivel"],
      default: undefined,
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

const historicoStatusSchema = new mongoose.Schema(
  {
    statusAnterior: {
      type: String,
      required: true,
    },
    novoStatus: {
      type: String,
      required: true,
    },
    alteradoEm: {
      type: Date,
      default: Date.now,
      required: true,
    },
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Usuario",
      required: true,
    },
    usuarioNome: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    usuarioTipo: {
      type: String,
      enum: ["admin", "marketing", "logistica", "cliente"],
      required: true,
    },
    operadorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OperadorLogistica",
    },
    operadorNome: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    observacao: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  { _id: false }
);

const aprovacaoSchema = new mongoose.Schema(
  {
    aprovadoEm: {
      type: Date,
      required: true,
    },
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Usuario",
      required: true,
    },
    usuarioNome: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    usuarioTipo: {
      type: String,
      enum: ["admin"],
      required: true,
    },
  },
  { _id: false }
);

const ocorrenciaSchema = new mongoose.Schema(
  {
    conteudo: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    criadaEm: {
      type: Date,
      default: Date.now,
      required: true,
    },
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Usuario",
      required: true,
    },
    usuarioNome: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    usuarioTipo: {
      type: String,
      enum: ["admin", "logistica"],
      required: true,
    },
    operadorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OperadorLogistica",
    },
    operadorNome: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    tipo: {
      type: String,
      enum: ["observacao", "falta_produto", "informacao_operacional"],
      default: "observacao",
      required: true,
    },
    visibilidade: {
      type: String,
      enum: ["interna", "cliente"],
      default: "interna",
      required: true,
    },
    produtoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Produto",
    },
    nomeProduto: {
      type: String,
      trim: true,
      maxlength: 255,
    },
  },
  { _id: false }
);

const conferenciaUsuarioSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Usuario",
      required: true,
    },
    usuarioNome: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    usuarioTipo: {
      type: String,
      enum: ["admin", "logistica"],
      required: true,
    },
    operadorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OperadorLogistica",
    },
    operadorNome: {
      type: String,
      trim: true,
      maxlength: 120,
    },
  },
  { _id: false }
);

const conferenciaItemSchema = new mongoose.Schema(
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
      maxlength: 255,
    },
    quantidadeSolicitada: {
      type: Number,
      required: true,
      min: 0,
    },
    quantidadeSeparada: {
      type: Number,
      required: true,
      min: 0,
    },
    quantidadeFaltanteSeparacao: {
      type: Number,
      required: true,
      min: 0,
    },
    quantidadeConferida: {
      type: Number,
      required: true,
      min: 0,
    },
    diferenca: {
      type: Number,
      required: true,
    },
    situacaoFinal: {
      type: String,
      enum: ["completo", "parcial", "indisponivel"],
      required: true,
    },
  },
  { _id: false }
);

const conferenciaSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: [
        "pendente",
        "em_andamento",
        "concluida",
        "concluida_com_divergencia",
      ],
      default: "pendente",
      required: true,
    },
    iniciadaEm: Date,
    iniciadoPor: {
      type: conferenciaUsuarioSchema,
      default: undefined,
    },
    concluidaEm: Date,
    concluidoPor: {
      type: conferenciaUsuarioSchema,
      default: undefined,
    },
    observacao: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    itens: {
      type: [conferenciaItemSchema],
      default: undefined,
    },
    totalItens: {
      type: Number,
      min: 0,
    },
    totalDivergencias: {
      type: Number,
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
      enum: [
        "aguardando_aprovacao",
        "aprovado",
        "novo",
        "em_analise",
        "separando",
        "separado",
        "faturado",
        "enviado",
        "entregue",
        "cancelado",
      ],
      default: "aguardando_aprovacao",
    },

    aprovacao: {
      type: aprovacaoSchema,
      default: undefined,
    },

    conferenciaObrigatoria: {
      type: Boolean,
      default: false,
    },

    conferencia: {
      type: conferenciaSchema,
      default: undefined,
    },

    observacao: {
      type: String,
      trim: true,
    },

    numeroNotaFiscal: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    dataFaturamento: Date,

    transportadora: {
      type: String,
      trim: true,
      maxlength: 120,
    },

    codigoRastreio: {
      type: String,
      trim: true,
      maxlength: 120,
    },

    linkRastreio: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    dataEnvio: Date,

    dataEntrega: Date,

    observacaoLogistica: {
      type: String,
      trim: true,
      maxlength: 1000,
      select: false,
    },

    historicoStatus: {
      type: [historicoStatusSchema],
      default: undefined,
      select: false,
    },

    ocorrencias: {
      type: [ocorrenciaSchema],
      default: undefined,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

pedidoSchema.index({ clienteId: 1, createdAt: -1 });
pedidoSchema.index({ status: 1, createdAt: -1 });
pedidoSchema.index({ createdAt: -1 });

export default mongoose.model("Pedido", pedidoSchema);
