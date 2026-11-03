import mongoose from "mongoose";
import { autorNatalSchema } from "./natalSchemas.js";

// Número de cupom emitido na aprovação. O índice único em `numero` impede
// repetição e reaproveitamento: cupons cancelados permanecem gravados.

const natalCupomSchema = new mongoose.Schema(
  {
    campanha: { type: String, required: true, default: "natal-2026", immutable: true },
    numero: { type: Number, required: true, immutable: true },
    codigo: { type: String, required: true, immutable: true },
    participacaoId: { type: mongoose.Schema.Types.ObjectId, ref: "NatalParticipacao", required: true, immutable: true },
    loteId: { type: mongoose.Schema.Types.ObjectId, ref: "NatalLote", required: true, immutable: true },
    pedidoId: { type: mongoose.Schema.Types.ObjectId, ref: "Pedido", required: true, immutable: true },
    clienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", required: true, immutable: true },
    status: { type: String, enum: ["valido", "cancelado", "invalidado"], default: "valido", required: true },
    emitidoEm: { type: Date, required: true, immutable: true },
    emitidoPor: { type: autorNatalSchema, required: true },
    encerradoEm: Date,
    motivoEncerramento: { type: String, trim: true, maxlength: 500 },
    revisaoId: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true }
);

natalCupomSchema.index({ campanha: 1, numero: 1 }, { unique: true });
natalCupomSchema.index({ participacaoId: 1 }, { unique: true });
natalCupomSchema.index({ status: 1, numero: 1 });
natalCupomSchema.index({ loteId: 1, status: 1 });

export default mongoose.models.NatalCupom || mongoose.model("NatalCupom", natalCupomSchema);
