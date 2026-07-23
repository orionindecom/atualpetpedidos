import mongoose from "mongoose";

const treinamentoSchema = new mongoose.Schema(
  {
    titulo: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    descricao: {
      type: String,
      trim: true,
      maxlength: 3000,
      default: "",
    },
    resumo: {
      type: String,
      trim: true,
      maxlength: 300,
      default: "",
    },
    categoria: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    marca: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    linha: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    instrutor: {
      type: String,
      trim: true,
      maxlength: 150,
      default: "",
    },
    duracaoSegundos: {
      type: Number,
      min: 0,
      max: 86400,
      default: 0,
    },
    provider: {
      type: String,
      enum: ["youtube"],
      default: "youtube",
      required: true,
    },
    videoId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20,
    },
    thumbnailUrl: {
      type: String,
      trim: true,
      maxlength: 2048,
      default: "",
    },
    thumbnailPublicId: {
      type: String,
      trim: true,
      maxlength: 512,
      default: "",
    },
    destaque: {
      type: Boolean,
      default: false,
    },
    obrigatorio: {
      type: Boolean,
      default: false,
    },
    ordem: {
      type: Number,
      min: -100000,
      max: 100000,
      default: 0,
    },
    ativo: {
      type: Boolean,
      default: true,
    },
    publicadoEm: {
      type: Date,
      default: null,
    },
    criadoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Usuario",
      required: true,
    },
    atualizadoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Usuario",
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "treinamentos",
  }
);

treinamentoSchema.index({
  ativo: 1,
  destaque: -1,
  obrigatorio: -1,
  ordem: 1,
  publicadoEm: -1,
  _id: 1,
});

export default mongoose.model("Treinamento", treinamentoSchema);
