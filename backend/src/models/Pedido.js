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
      enum: ["pendente", "completo", "parcial", "indisponivel", "excedente"],
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
      enum: ["admin", "vendedor", "comercial", "marketing", "logistica", "cliente"],
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
    acao: { type: String, enum: ["envio_direto_admin", "retirada_admin"] },
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
      enum: ["admin", "vendedor", "comercial"],
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
      enum: ["admin", "vendedor", "comercial", "logistica"],
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
    versaoOperacional: {
      type: Number,
      min: 1,
    },
  },
  { _id: false }
);

// A invalidação decorre da edição do pedido, não da execução da conferência.
const autorInvalidacaoSchema = conferenciaUsuarioSchema.clone();
autorInvalidacaoSchema.add({
  usuarioTipo: { type: String, enum: ["admin", "vendedor", "comercial", "logistica"], required: true },
});

const historicoConferenciaSchema = new mongoose.Schema(
  {
    conferencia: {
      type: conferenciaSchema,
      required: true,
    },
    invalidadaEm: {
      type: Date,
      required: true,
    },
    invalidadaPor: {
      type: autorInvalidacaoSchema,
      required: true,
    },
    motivo: {
      type: String,
      trim: true,
      maxlength: 500,
      required: true,
    },
  },
  { _id: false }
);

const alteracaoItemPedidoSchema = new mongoose.Schema(
  {
    produtoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Produto",
      required: true,
    },
    nomeProduto: {
      type: String,
      trim: true,
      maxlength: 255,
      required: true,
    },
    tipo: {
      type: String,
      enum: ["adicionado", "removido", "quantidade_alterada", "preco_alterado"],
      required: true,
    },
    quantidadeAnterior: Number,
    quantidadeNova: Number,
    valorUnitarioAnterior: Number,
    valorUnitarioNovo: Number,
    subtotalAnterior: Number,
    subtotalNovo: Number,
    quantidadeSeparadaNoMomento: Number,
  },
  { _id: false }
);

const historicoAlteracaoPedidoSchema = new mongoose.Schema(
  {
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
      enum: ["admin", "vendedor", "comercial"],
      required: true,
    },
    versaoOperacionalAnterior: {
      type: Number,
      min: 1,
      required: true,
    },
    versaoOperacionalNova: {
      type: Number,
      min: 1,
      required: true,
    },
    totalAnterior: {
      type: Number,
      min: 0,
      required: true,
    },
    totalNovo: {
      type: Number,
      min: 0,
      required: true,
    },
    itens: {
      type: [alteracaoItemPedidoSchema],
      required: true,
      default: undefined,
    },
  },
  { _id: false }
);

const fechamentoLogisticoSchema = new mongoose.Schema(
  {
    quantidadeVolumes: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "A quantidade de volumes deve ser um número inteiro",
      },
    },
    pesoTotalKg: {
      type: Number,
      required: true,
      min: 0.001,
    },
    observacaoVolumes: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 3000,
    },
    preenchidoEm: {
      type: Date,
      required: true,
    },
    preenchidoPor: {
      type: conferenciaUsuarioSchema,
      required: true,
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

    vendedorResponsavelId: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario" },

    nomeResponsavel: {
      type: String,
      trim: true,
    },

    origem: {
      type: String,
      enum: ["cliente", "comercial"],
      default: "cliente",
      immutable: true,
    },

    criadoPor: {
      type: new mongoose.Schema({
        usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", required: true },
        usuarioNome: { type: String, required: true, trim: true, maxlength: 120 },
        usuarioTipo: { type: String, enum: ["admin", "comercial", "vendedor", "cliente"], required: true },
      }, { _id: false }),
      default: undefined,
      immutable: true,
      required: function () { return this.origem === "comercial"; },
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
        "retirado",
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

    versaoOperacional: {
      type: Number,
      min: 1,
      default: 1,
      required: true,
    },

    historicoConferencias: {
      type: [historicoConferenciaSchema],
      default: undefined,
      select: false,
    },

    historicoAlteracoes: {
      type: [historicoAlteracaoPedidoSchema],
      default: undefined,
      select: false,
    },

    fechamentoLogisticoObrigatorio: {
      type: Boolean,
      default: false,
    },

    fechamentoLogistico: {
      type: fechamentoLogisticoSchema,
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

    retiradoEm: {
      type: Date,
      required: function () { return this.status === "retirado"; },
    },

    retiradoPor: {
      type: new mongoose.Schema({
        usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", required: true },
        usuarioNome: { type: String, trim: true, maxlength: 120 },
        usuarioTipo: { type: String, enum: ["admin"], required: true },
      }, { _id: false }),
      default: undefined,
      required: function () { return this.status === "retirado"; },
    },

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
    optimisticConcurrency: true,
  }
);

pedidoSchema.index({ clienteId: 1, createdAt: -1 });
pedidoSchema.index({ status: 1, createdAt: -1 });
pedidoSchema.index({ createdAt: -1 });
pedidoSchema.index({ "historicoStatus.alteradoEm": -1, "historicoStatus.operadorId": 1 });
pedidoSchema.index({ "ocorrencias.criadaEm": -1, "ocorrencias.operadorId": 1 });
pedidoSchema.index({
  "conferencia.iniciadaEm": -1,
  "conferencia.iniciadoPor.operadorId": 1,
});
pedidoSchema.index({
  "conferencia.concluidaEm": -1,
  "conferencia.concluidoPor.operadorId": 1,
});

export default mongoose.model("Pedido", pedidoSchema);
