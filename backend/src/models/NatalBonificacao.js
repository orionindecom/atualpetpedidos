import mongoose from "mongoose";
import { autorNatalSchema } from "./natalSchemas.js";

// Controle da bonificação de um ciclo, separado por tipo (produtos ou marketing).
// Só registra valores: não gera financeiro, nota fiscal nem altera pedidos.
// Calculado nunca significa entregue: a entrega é sempre um registro próprio.

export const TIPOS_BONIFICACAO = Object.freeze(["produtos", "marketing"]);

const eventoBonificacaoSchema = new mongoose.Schema(
  {
    em: { type: Date, required: true },
    tipo: { type: String, enum: ["complemento", "recalculo", "adequacao", "entrega"], required: true },
    nivelFaixa: Number,
    valorAcumulado: Number,
    percentual: Number,
    valorDevido: Number,
    valorAnterior: Number,
    complemento: Number,
    valorEntregue: Number,
    origem: {
      tipo: { type: String, trim: true, maxlength: 40 },
      pedidoId: { type: mongoose.Schema.Types.ObjectId },
      numeroPedido: { type: String, trim: true },
      compraExternaId: { type: mongoose.Schema.Types.ObjectId },
      referencia: { type: String, trim: true, maxlength: 120 },
    },
    observacao: { type: String, trim: true, maxlength: 500 },
    autor: { type: autorNatalSchema, required: true },
  },
  { _id: false }
);

const natalBonificacaoSchema = new mongoose.Schema(
  {
    campanha: { type: String, required: true, default: "natal-2026", immutable: true },
    clienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", required: true, immutable: true },
    ciclo: { type: Number, required: true, min: 1, immutable: true },
    tipo: { type: String, enum: TIPOS_BONIFICACAO, required: true, immutable: true },
    nivelFaixa: { type: Number, default: 0 },
    percentual: { type: Number, default: 0 },
    valorAcumulado: { type: Number, default: 0 },
    // Devido pelo cálculo atual do ciclo.
    valorDevido: { type: Number, default: 0, min: 0 },
    // Soma dos complementos reconhecidos. Só cai por decisão de adequação.
    valorConcedido: { type: Number, default: 0, min: 0 },
    // Informado pela equipe ao entregar ou utilizar a bonificação.
    valorEntregue: { type: Number, default: 0, min: 0 },
    saldoPendente: { type: Number, default: 0 },
    historico: { type: [eventoBonificacaoSchema], default: [] },
  },
  { timestamps: true }
);

natalBonificacaoSchema.index({ campanha: 1, clienteId: 1, ciclo: 1, tipo: 1 }, { unique: true });

export default mongoose.models.NatalBonificacao || mongoose.model("NatalBonificacao", natalBonificacaoSchema);
