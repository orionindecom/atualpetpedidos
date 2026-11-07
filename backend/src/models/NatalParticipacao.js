import mongoose from "mongoose";
import { PARTICIPACAO_STATUS } from "../utils/natalCampanha.js";
import { autorNatalSchema } from "./natalSchemas.js";

// Cadastro de um pet shop dentro de um distribuidor (identidade + estado de aprovação).
// Links antigos preenchem loteId e pedidoId; o link próprio do distribuidor não tem
// nenhum dos dois. Nunca é excluído: cancelamentos e invalidações apenas mudam o status.
//
// Desde os múltiplos cupons, os cupons vêm de lotes de distribuição (NatalDistribuicao).
// "compra" e "comprovante" guardam o primeiro envio; cada lote guarda os seus.
// O campo "cupom" só existe nos cadastros de 1 cupom aprovados antes dessa mudança.

const eventoSchema = new mongoose.Schema(
  {
    acao: {
      type: String,
      enum: [
        "recebido", "aprovado", "rejeitado", "cancelado", "invalidado_pedido", "invalidado_revisao", "alerta_duplicidade",
        "ajuste_apos_fechamento", "lote_recebido", "lote_aprovado", "lote_rejeitado", "lote_cancelado", "cupons_invalidados_revisao",
      ],
      required: true,
    },
    em: { type: Date, required: true },
    autor: { type: autorNatalSchema, required: true },
    motivo: { type: String, trim: true, maxlength: 500 },
    detalhes: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false }
);

const alertaSchema = new mongoose.Schema(
  {
    tipo: { type: String, enum: ["mesmo_comprovante", "mesma_compra", "mesmo_cnpj_data", "mesmo_documento_distribuidor"], required: true },
    participacaoId: { type: mongoose.Schema.Types.ObjectId, ref: "NatalParticipacao", required: true },
    distribuicaoId: { type: mongoose.Schema.Types.ObjectId, ref: "NatalDistribuicao" },
    protocolo: { type: String, trim: true },
    detectadoEm: { type: Date, required: true },
  },
  { _id: false }
);

const decisaoSchema = new mongoose.Schema(
  {
    em: { type: Date, required: true },
    motivo: { type: String, trim: true, maxlength: 500 },
    autor: { type: autorNatalSchema, required: true },
  },
  { _id: false }
);

const natalParticipacaoSchema = new mongoose.Schema(
  {
    campanha: { type: String, required: true, default: "natal-2026", immutable: true },
    loteId: { type: mongoose.Schema.Types.ObjectId, ref: "NatalLote", immutable: true },
    pedidoId: { type: mongoose.Schema.Types.ObjectId, ref: "Pedido", immutable: true },
    numeroPedido: { type: String, trim: true },
    clienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", required: true, immutable: true },
    distribuidorNome: { type: String, trim: true, maxlength: 200 },
    protocolo: { type: String, required: true, immutable: true },
    vendedorNome: { type: String, required: true, trim: true, maxlength: 120 },
    petshop: {
      nomeFantasia: { type: String, required: true, trim: true, maxlength: 160 },
      razaoSocial: { type: String, required: true, trim: true, maxlength: 200 },
      // CPF (11) ou CNPJ (14) normalizado. "cnpj" guarda os primeiros cadastros.
      documento: {
        type: String,
        match: /^(\d{11}|\d{14})$/,
        required: function documentoObrigatorio() { return !this.petshop?.cnpj; },
      },
      tipoDocumento: { type: String, enum: ["cpf", "cnpj"] },
      cnpj: { type: String, match: /^\d{14}$/ },
      responsavel: { type: String, required: true, trim: true, maxlength: 120 },
      whatsapp: { type: String, required: true, match: /^\d{10,11}$/ },
      instagram: { type: String, required: true, trim: true, maxlength: 30 },
    },
    compra: {
      data: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
      valor: { type: Number, required: true, min: 0.01 },
    },
    comprovante: {
      provider: { type: String, required: true },
      chave: { type: String, required: true },
      resourceType: { type: String },
      formato: { type: String, trim: true, maxlength: 10 },
      mimetype: { type: String, required: true },
      bytes: { type: Number, required: true },
      sha256: { type: String, required: true },
      nomeOriginal: { type: String, trim: true, maxlength: 200 },
    },
    status: { type: String, enum: PARTICIPACAO_STATUS, default: "pendente", required: true },
    // Documento do pet shop enquanto o cadastro está ativo (pendente ou aprovado). O índice
    // único parcial impede dois cadastros ativos do mesmo CPF/CNPJ no mesmo distribuidor;
    // rejeição e cancelamento removem a chave. Duplicidades antigas ficam sem ela.
    chaveCadastro: { type: String, match: /^(\d{11}|\d{14})$/ },
    // Quantidades de cupons por situação (os cupons individuais ficam em NatalCupom).
    // Ausente nos cadastros antigos até a migração ou a primeira operação nova.
    cupons: {
      type: new mongoose.Schema(
        {
          total: { type: Number, default: 0 },
          pendentes: { type: Number, default: 0 },
          validos: { type: Number, default: 0 },
          rejeitados: { type: Number, default: 0 },
          cancelados: { type: Number, default: 0 },
          invalidados: { type: Number, default: 0 },
        },
        { _id: false }
      ),
      default: undefined,
    },
    // Cadastro antigo com o mesmo documento de outro cadastro ativo do distribuidor.
    duplicidadeLegada: { type: Boolean, default: undefined },
    recebidoEm: { type: Date, required: true, immutable: true },
    cupom: {
      type: new mongoose.Schema(
        {
          numero: { type: Number, required: true },
          codigo: { type: String, required: true },
          emitidoEm: { type: Date, required: true },
        },
        { _id: false }
      ),
      default: undefined,
    },
    decisao: { type: decisaoSchema, default: undefined },
    cancelamento: {
      type: new mongoose.Schema(
        {
          em: { type: Date, required: true },
          motivo: { type: String, trim: true, maxlength: 500, required: true },
          autor: { type: autorNatalSchema, required: true },
          statusAnterior: { type: String, enum: PARTICIPACAO_STATUS, required: true },
        },
        { _id: false }
      ),
      default: undefined,
    },
    invalidacao: {
      type: new mongoose.Schema(
        {
          em: { type: Date, required: true },
          motivo: { type: String, trim: true, maxlength: 300 },
          statusAnterior: { type: String, enum: PARTICIPACAO_STATUS },
          tipo: { type: String, enum: ["cancelamento_pedido", "revisao_faixa"] },
          revisaoId: { type: mongoose.Schema.Types.ObjectId },
        },
        { _id: false }
      ),
      default: undefined,
    },
    alertas: { type: [alertaSchema], default: [] },
    origem: {
      ipHash: { type: String },
      userAgent: { type: String, maxlength: 200 },
    },
    historico: { type: [eventoSchema], default: [] },
  },
  { timestamps: true }
);

natalParticipacaoSchema.index({ protocolo: 1 }, { unique: true });
natalParticipacaoSchema.index({ loteId: 1, status: 1, recebidoEm: 1 });
natalParticipacaoSchema.index({ clienteId: 1, recebidoEm: -1 });
natalParticipacaoSchema.index({ clienteId: 1, status: 1, recebidoEm: 1 });
natalParticipacaoSchema.index({ status: 1, recebidoEm: -1 });
natalParticipacaoSchema.index({ "petshop.cnpj": 1, "compra.data": 1 });
natalParticipacaoSchema.index({ "petshop.documento": 1, "compra.data": 1 });
natalParticipacaoSchema.index({ "comprovante.sha256": 1 });
natalParticipacaoSchema.index({ "cupom.numero": 1 }, { sparse: true });
natalParticipacaoSchema.index(
  { campanha: 1, clienteId: 1, chaveCadastro: 1 },
  { unique: true, partialFilterExpression: { chaveCadastro: { $type: "string" } } }
);
natalParticipacaoSchema.index({ clienteId: 1, "cupons.pendentes": 1 });

export default mongoose.models.NatalParticipacao || mongoose.model("NatalParticipacao", natalParticipacaoSchema);
