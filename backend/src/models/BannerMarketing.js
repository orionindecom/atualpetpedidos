import mongoose from "mongoose";

const bannerMarketingSchema = new mongoose.Schema(
  {
    tituloInterno: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },
    imagemUrl: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2048,
    },
    imagemPublicId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 512,
    },
    link: {
      type: String,
      trim: true,
      maxlength: 2048,
      default: "",
    },
    ativo: {
      type: Boolean,
      default: true,
    },
    ordem: {
      type: Number,
      default: 0,
      min: -100000,
      max: 100000,
    },
    dataInicial: {
      type: Date,
      default: null,
    },
    dataFinal: {
      type: Date,
      default: null,
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
    criadoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Usuario",
      required: true,
    },
  },
  {
    timestamps: true,
    collection: "bannersmarketing",
  }
);

bannerMarketingSchema.index({
  ativo: 1,
  audienciaTipo: 1,
  distribuidoresIds: 1,
  ordem: 1,
  dataInicial: 1,
  dataFinal: 1,
});

export default mongoose.model("BannerMarketing", bannerMarketingSchema);

