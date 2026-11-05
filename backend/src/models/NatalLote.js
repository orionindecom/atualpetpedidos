import mongoose from "mongoose";
import { autorNatalSchema, beneficiosNatalSchema, contadoresNatalSchema, revisaoNatalSchema } from "./natalSchemas.js";

// Registro de um link público criado no modelo antigo (um lote por pedido aprovado).
// O código nunca muda. Desde o modelo cumulativo o saldo pertence à NatalConta do
// distribuidor e novos lotes não são criados; cuponsConcedidos fica como foto do
// que o pedido liberou, reconhecida na conta como cupons legados.

const historicoFaixaSchema = new mongoose.Schema(
  {
    em: { type: Date, required: true },
    tipo: {
      type: String,
      enum: ["criacao", "aumento_faixa", "valor_atualizado", "invalidacao", "revisao_mantida", "revisao_adequada", "reducao_sem_revisao"],
      required: true,
    },
    origem: { type: String, trim: true, maxlength: 60 },
    valorPedido: { type: Number, min: 0 },
    valorAnterior: { type: Number, min: 0 },
    nivelAnterior: Number,
    nivelNovo: Number,
    cuponsAnterior: Number,
    cuponsNovo: Number,
    acrescimo: Number,
    autor: { type: autorNatalSchema, required: true },
  },
  { _id: false }
);

const natalLoteSchema = new mongoose.Schema(
  {
    campanha: { type: String, required: true, default: "natal-2026", immutable: true },
    pedidoId: { type: mongoose.Schema.Types.ObjectId, ref: "Pedido", required: true, immutable: true },
    numeroPedido: { type: String, required: true, trim: true },
    clienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", required: true, immutable: true },
    distribuidorNome: { type: String, trim: true, maxlength: 200 },
    distribuidorRazaoSocial: { type: String, trim: true, maxlength: 200 },
    codigoPublico: { type: String, required: true, immutable: true },
    status: { type: String, enum: ["ativo", "invalidado"], default: "ativo", required: true },
    pedidoAprovadoEm: Date,
    valorAprovadoInicial: { type: Number, required: true, min: 0, immutable: true },
    valorAtual: { type: Number, required: true, min: 0 },
    faixaMaxima: { type: beneficiosNatalSchema, required: true },
    cuponsConcedidos: { type: Number, required: true, min: 0 },
    contadores: { type: contadoresNatalSchema, default: () => ({}) },
    historicoFaixas: { type: [historicoFaixaSchema], default: [] },
    revisoes: { type: [revisaoNatalSchema], default: [] },
    // Redução de valor detectada sem decisão administrativa (fora da edição instrumentada).
    revisaoPendente: {
      type: new mongoose.Schema(
        { detectadaEm: Date, valorAnterior: Number, valorNovo: Number },
        { _id: false }
      ),
      default: undefined,
    },
    criadoPor: { type: autorNatalSchema, required: true },
    invalidacao: {
      type: new mongoose.Schema(
        {
          em: { type: Date, required: true },
          motivo: { type: String, trim: true, maxlength: 300, required: true },
          autor: { type: autorNatalSchema, required: true },
        },
        { _id: false }
      ),
      default: undefined,
    },
  },
  { timestamps: true }
);

natalLoteSchema.index({ pedidoId: 1 }, { unique: true });
natalLoteSchema.index({ codigoPublico: 1 }, { unique: true });
natalLoteSchema.index({ clienteId: 1, createdAt: -1 });
natalLoteSchema.index({ status: 1, createdAt: -1 });

export default mongoose.models.NatalLote || mongoose.model("NatalLote", natalLoteSchema);
