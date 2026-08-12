import mongoose from "mongoose";

const operadorLogisticaSchema = new mongoose.Schema(
  {
    nome: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    pinHash: {
      type: String,
      required: true,
      select: false,
    },
    ativo: {
      type: Boolean,
      default: true,
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Usuario",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Usuario",
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_document, result) => {
        delete result.pinHash;
        return result;
      },
    },
    toObject: {
      transform: (_document, result) => {
        delete result.pinHash;
        return result;
      },
    },
  }
);

operadorLogisticaSchema.index({ ativo: -1, nome: 1 });

export default mongoose.model("OperadorLogistica", operadorLogisticaSchema);
