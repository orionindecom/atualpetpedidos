import mongoose from "mongoose";
import { autorNatalSchema } from "./natalSchemas.js";

// Extrato de cupons do distribuidor (quantidades, não números de cupom).
// A chave única impede conceder ou ajustar a mesma coisa duas vezes.

export const TIPOS_MOVIMENTO_CUPOM = Object.freeze(["legado", "conquista", "revisao_adequacao", "ajuste_manual"]);

const natalMovimentoCupomSchema = new mongoose.Schema(
  {
    campanha: { type: String, required: true, default: "natal-2026", immutable: true },
    clienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", required: true, immutable: true },
    chave: { type: String, required: true, immutable: true },
    tipo: { type: String, enum: TIPOS_MOVIMENTO_CUPOM, required: true, immutable: true },
    quantidade: { type: Number, required: true, immutable: true },
    saldoTotalApos: { type: Number, immutable: true },
    motivo: { type: String, trim: true, maxlength: 500, immutable: true },
    origem: {
      tipo: { type: String, trim: true, maxlength: 40 },
      pedidoId: { type: mongoose.Schema.Types.ObjectId, ref: "Pedido" },
      numeroPedido: { type: String, trim: true },
      compraExternaId: { type: mongoose.Schema.Types.ObjectId, ref: "NatalCompraExterna" },
      loteId: { type: mongoose.Schema.Types.ObjectId, ref: "NatalLote" },
      referencia: { type: String, trim: true, maxlength: 120 },
    },
    em: { type: Date, required: true, immutable: true },
    autor: { type: autorNatalSchema, required: true, immutable: true },
  },
  { versionKey: false }
);

natalMovimentoCupomSchema.index({ campanha: 1, chave: 1 }, { unique: true });
natalMovimentoCupomSchema.index({ clienteId: 1, em: -1 });

export default mongoose.models.NatalMovimentoCupom || mongoose.model("NatalMovimentoCupom", natalMovimentoCupomSchema);
