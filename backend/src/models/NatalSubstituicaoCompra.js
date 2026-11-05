import mongoose from "mongoose";
import { autorNatalSchema } from "./natalSchemas.js";

// Troca autorizada da origem de uma compra: o pedido continua no sistema comercial,
// mas deixa de contar para a campanha, e a compra externa passa a contar no lugar dele.
// O índice único por pedido impede somar as duas origens ou repetir a substituição.

const natalSubstituicaoCompraSchema = new mongoose.Schema(
  {
    campanha: { type: String, required: true, default: "natal-2026", immutable: true },
    clienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", required: true, immutable: true },
    pedidoId: { type: mongoose.Schema.Types.ObjectId, ref: "Pedido", required: true, immutable: true },
    numeroPedido: { type: String, required: true, trim: true, immutable: true },
    compraExternaId: { type: mongoose.Schema.Types.ObjectId, ref: "NatalCompraExterna", required: true, immutable: true },
    referenciaChave: { type: String, required: true, immutable: true },
    valorPedido: { type: Number, required: true, immutable: true },
    valorCompra: { type: Number, required: true, immutable: true },
    diferenca: { type: Number, required: true, immutable: true },
    acumuladoAntes: { type: Number, required: true, immutable: true },
    acumuladoDepois: { type: Number, required: true, immutable: true },
    motivo: { type: String, required: true, trim: true, maxlength: 500, immutable: true },
    em: { type: Date, required: true, immutable: true },
    autor: { type: autorNatalSchema, required: true, immutable: true },
  },
  { versionKey: false }
);

natalSubstituicaoCompraSchema.index({ campanha: 1, pedidoId: 1 }, { unique: true });
natalSubstituicaoCompraSchema.index({ clienteId: 1 });

export default mongoose.models.NatalSubstituicaoCompra || mongoose.model("NatalSubstituicaoCompra", natalSubstituicaoCompraSchema);
