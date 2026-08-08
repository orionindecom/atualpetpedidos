import mongoose from "mongoose";

const materialMarketingSchema = new mongoose.Schema(
  {
    titulo: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },
    descricao: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    categoria: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    tipo: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
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
    linkExterno: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2048,
    },
    imagemCapaUrl: {
      type: String,
      trim: true,
      maxlength: 2048,
      default: "",
    },
    imagemCapaPublicId: {
      type: String,
      trim: true,
      maxlength: 512,
      default: "",
    },
    audienciaTipo: {
      type: String,
      enum: ["todos", "especificos"],
      default: "todos",
    },
    distribuidoresIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Usuario",
    }],
    dataPublicacao: {
      type: Date,
      default: Date.now,
    },
    destaque: {
      type: Boolean,
      default: false,
    },
    ordem: {
      type: Number,
      default: 0,
      min: -100000,
      max: 100000,
    },
    ativo: {
      type: Boolean,
      default: true,
    },
    criadoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Usuario",
      required: true,
    },
  },
  {
    timestamps: true,
    collection: "materiaismarketing",
  }
);

materialMarketingSchema.index({
  ativo: 1,
  destaque: -1,
  ordem: 1,
  createdAt: -1,
  _id: 1,
});
materialMarketingSchema.index({
  ativo: 1,
  audienciaTipo: 1,
  distribuidoresIds: 1,
  dataPublicacao: -1,
  ordem: 1,
});

export default mongoose.model("MaterialMarketing", materialMarketingSchema);
