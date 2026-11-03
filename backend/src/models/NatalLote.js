import mongoose from "mongoose";
import { autorNatalSchema, beneficiosNatalSchema } from "./natalSchemas.js";

// Lote de cupons de um pedido aprovado. Um único lote por pedido; o link
// público é identificado somente pelo código aleatório.

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

const contadoresSchema = new mongoose.Schema(
  {
    aprovados: { type: Number, default: 0 },
    pendentes: { type: Number, default: 0 },
    rejeitados: { type: Number, default: 0 },
    cancelados: { type: Number, default: 0 },
    invalidados: { type: Number, default: 0 },
    invalidadosRevisao: { type: Number, default: 0 },
  },
  { _id: false }
);

// Decisão administrativa tomada ao reduzir o valor de um pedido participante.
const revisaoSchema = new mongoose.Schema(
  {
    em: { type: Date, required: true },
    autor: { type: autorNatalSchema, required: true },
    decisao: { type: String, enum: ["manter", "adequar"], required: true },
    justificativa: { type: String, trim: true, required: true, maxlength: 1000 },
    valorAnterior: { type: Number, required: true },
    valorNovo: { type: Number, required: true },
    faixaAnterior: { type: beneficiosNatalSchema, required: true },
    faixaDoNovoValor: { type: beneficiosNatalSchema, required: true },
    faixaResultante: { type: beneficiosNatalSchema, required: true },
    aprovadasAntes: { type: Number, default: 0 },
    pendentesNoMomento: { type: Number, default: 0 },
    participacoesInvalidadas: {
      type: [new mongoose.Schema(
        {
          participacaoId: { type: mongoose.Schema.Types.ObjectId, required: true },
          protocolo: String,
          cupomNumero: Number,
          cupomCodigo: String,
          recebidoEm: Date,
        },
        { _id: false }
      )],
      default: [],
    },
    // Bonificações já entregues não são desfeitas automaticamente: só sinalizadas.
    ajusteBonificacaoPendente: { type: Boolean, default: false },
  },
  { _id: true }
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
    contadores: { type: contadoresSchema, default: () => ({}) },
    historicoFaixas: { type: [historicoFaixaSchema], default: [] },
    revisoes: { type: [revisaoSchema], default: [] },
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
