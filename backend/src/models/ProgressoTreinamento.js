import mongoose from "mongoose";

const progressoTreinamentoSchema = new mongoose.Schema(
  {
    treinamentoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Treinamento",
      required: true,
    },
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Usuario",
      required: true,
    },
    ultimaPosicaoSegundos: {
      type: Number,
      min: 0,
      default: 0,
    },
    duracaoSegundos: {
      type: Number,
      min: 0,
      max: 86400,
      default: 0,
    },
    percentualAssistido: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    iniciadoEm: {
      type: Date,
      default: null,
    },
    ultimoAcessoEm: {
      type: Date,
      default: null,
    },
    concluidoEm: {
      type: Date,
      default: null,
    },
    concluido: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    collection: "progressostreinamentos",
  }
);

progressoTreinamentoSchema.index(
  { treinamentoId: 1, usuarioId: 1 },
  { unique: true }
);

export default mongoose.model("ProgressoTreinamento", progressoTreinamentoSchema);
