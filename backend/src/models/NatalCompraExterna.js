import mongoose from "mongoose";
import { autorNatalSchema } from "./natalSchemas.js";

// Compra feita fora da Central Comercial. Evita pedidos fictícios no catálogo:
// depois de validada, soma no acumulado do distribuidor como um pedido aprovado.

export const STATUS_COMPRA_EXTERNA = Object.freeze(["pendente", "validada", "rejeitada", "cancelada"]);

const eventoCompraSchema = new mongoose.Schema(
  {
    em: { type: Date, required: true },
    acao: { type: String, enum: ["registrada", "validada", "rejeitada", "cancelada"], required: true },
    motivo: { type: String, trim: true, maxlength: 500 },
    autor: { type: autorNatalSchema, required: true },
  },
  { _id: false }
);

const natalCompraExternaSchema = new mongoose.Schema(
  {
    campanha: { type: String, required: true, default: "natal-2026", immutable: true },
    clienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", required: true, immutable: true },
    distribuidorNome: { type: String, trim: true, maxlength: 200 },
    valor: { type: Number, required: true, min: 0.01, immutable: true },
    data: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, immutable: true },
    referencia: { type: String, required: true, trim: true, maxlength: 120, immutable: true },
    // Comparação sem caixa nem espaços, para barrar a mesma nota registrada duas vezes.
    referenciaChave: { type: String, required: true, immutable: true },
    observacoes: { type: String, trim: true, maxlength: 1000 },
    comprovante: {
      type: new mongoose.Schema(
        {
          provider: { type: String, required: true },
          chave: { type: String, required: true },
          resourceType: String,
          formato: { type: String, trim: true, maxlength: 10 },
          mimetype: { type: String, required: true },
          bytes: { type: Number, required: true },
          sha256: { type: String, required: true },
          nomeOriginal: { type: String, trim: true, maxlength: 200 },
        },
        { _id: false }
      ),
      default: undefined,
    },
    status: { type: String, enum: STATUS_COMPRA_EXTERNA, default: "pendente", required: true },
    // Verdadeiro enquanto pendente ou validada; sustenta o índice de referência única.
    ativa: { type: Boolean, default: true },
    registradoPor: { type: autorNatalSchema, required: true, immutable: true },
    registradoEm: { type: Date, required: true, immutable: true },
    validadoEm: Date,
    // Preenchido quando a compra entra no lugar de um pedido da campanha.
    substituiPedidoId: { type: mongoose.Schema.Types.ObjectId, ref: "Pedido", immutable: true },
    historico: { type: [eventoCompraSchema], default: [] },
  },
  { timestamps: true }
);

natalCompraExternaSchema.index(
  { campanha: 1, clienteId: 1, referenciaChave: 1 },
  { unique: true, partialFilterExpression: { ativa: true } }
);
natalCompraExternaSchema.index({ clienteId: 1, status: 1 });
natalCompraExternaSchema.index({ status: 1, registradoEm: -1 });

export default mongoose.models.NatalCompraExterna || mongoose.model("NatalCompraExterna", natalCompraExternaSchema);
