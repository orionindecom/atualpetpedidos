import mongoose from "mongoose";
import { autorNatalSchema } from "./natalSchemas.js";

// Lote de distribuição: cada operação que entrega cupons a um pet shop já identificado
// (NatalParticipacao). Um cadastro tem um ou mais lotes; cada lote gera N cupons
// individuais (NatalCupom). Nunca é excluído: cancelamentos só mudam o status.
// O nome "lote" no modelo NatalLote continua reservado aos links antigos por pedido.

export const STATUS_DISTRIBUICAO = Object.freeze(["pendente", "aprovado", "rejeitado", "cancelado", "invalidado"]);
export const TIPOS_DISTRIBUICAO = Object.freeze(["cadastro_inicial", "adicional", "legado"]);
export const CANAIS_DISTRIBUICAO = Object.freeze(["link_publico", "painel_distribuidor", "migracao"]);

const eventoDistribuicaoSchema = new mongoose.Schema(
  {
    acao: {
      type: String,
      enum: ["recebido", "aprovado", "rejeitado", "cancelado", "invalidado_revisao", "migrado"],
      required: true,
    },
    em: { type: Date, required: true },
    autor: { type: autorNatalSchema, required: true },
    motivo: { type: String, trim: true, maxlength: 500 },
    detalhes: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false }
);

const origemSaldoResumoSchema = new mongoose.Schema(
  {
    tipo: { type: String, trim: true, maxlength: 40 },
    referencia: { type: String, trim: true, maxlength: 120 },
    movimentoId: { type: mongoose.Schema.Types.ObjectId, ref: "NatalMovimentoCupom" },
    quantidade: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const natalDistribuicaoSchema = new mongoose.Schema(
  {
    campanha: { type: String, required: true, default: "natal-2026", immutable: true },
    clienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", required: true, immutable: true },
    participacaoId: { type: mongoose.Schema.Types.ObjectId, ref: "NatalParticipacao", required: true, immutable: true },
    // Link antigo usado no envio (quando houver), só para acompanhar os contadores dele.
    loteId: { type: mongoose.Schema.Types.ObjectId, ref: "NatalLote", immutable: true },
    protocolo: { type: String, required: true, immutable: true },
    distribuidorNome: { type: String, trim: true, maxlength: 200 },
    vendedorNome: { type: String, required: true, trim: true, maxlength: 120 },
    tipo: { type: String, enum: TIPOS_DISTRIBUICAO, required: true, immutable: true },
    canal: { type: String, enum: CANAIS_DISTRIBUICAO, required: true, immutable: true },
    quantidade: { type: Number, required: true, min: 1, immutable: true },
    status: { type: String, enum: STATUS_DISTRIBUICAO, default: "pendente", required: true },
    recebidoEm: { type: Date, required: true, immutable: true },
    // Chave enviada pelo cliente: repetir a mesma operação devolve este registro.
    chaveIdempotencia: { type: String, trim: true, maxlength: 80, immutable: true },
    compra: {
      data: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
      valor: { type: Number, min: 0.01 },
    },
    comprovante: {
      type: new mongoose.Schema(
        {
          provider: { type: String, required: true },
          chave: { type: String, required: true },
          resourceType: { type: String },
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
    // Dados digitados no envio quando o CNPJ já tinha cadastro neste distribuidor.
    // O cadastro original não é sobrescrito; a gestão compara os dois.
    dadosInformados: {
      type: new mongoose.Schema(
        {
          nomeFantasia: String,
          razaoSocial: String,
          responsavel: String,
          whatsapp: String,
          instagram: String,
          divergente: { type: Boolean, default: false },
        },
        { _id: false }
      ),
      default: undefined,
    },
    // Origem calculada do saldo consumido (ordem de chegada do saldo da conta).
    origensSaldo: { type: [origemSaldoResumoSchema], default: [] },
    contadores: {
      pendentes: { type: Number, default: 0 },
      validos: { type: Number, default: 0 },
      rejeitados: { type: Number, default: 0 },
      cancelados: { type: Number, default: 0 },
      invalidados: { type: Number, default: 0 },
    },
    decisao: {
      type: new mongoose.Schema(
        {
          em: { type: Date, required: true },
          motivo: { type: String, trim: true, maxlength: 500 },
          autor: { type: autorNatalSchema, required: true },
        },
        { _id: false }
      ),
      default: undefined,
    },
    cancelamento: {
      type: new mongoose.Schema(
        {
          em: { type: Date, required: true },
          motivo: { type: String, trim: true, maxlength: 500, required: true },
          autor: { type: autorNatalSchema, required: true },
          statusAnterior: { type: String, enum: STATUS_DISTRIBUICAO, required: true },
          cuponsDevolvidos: { type: Number, default: 0 },
        },
        { _id: false }
      ),
      default: undefined,
    },
    origem: {
      ipHash: { type: String },
      userAgent: { type: String, maxlength: 200 },
    },
    criadoPor: { type: autorNatalSchema, required: true },
    historico: { type: [eventoDistribuicaoSchema], default: [] },
  },
  { timestamps: true }
);

natalDistribuicaoSchema.index({ protocolo: 1 }, { unique: true });
natalDistribuicaoSchema.index(
  { campanha: 1, clienteId: 1, chaveIdempotencia: 1 },
  { unique: true, partialFilterExpression: { chaveIdempotencia: { $type: "string" } } }
);
natalDistribuicaoSchema.index({ participacaoId: 1, recebidoEm: 1 });
natalDistribuicaoSchema.index({ clienteId: 1, status: 1, recebidoEm: 1 });
natalDistribuicaoSchema.index({ status: 1, recebidoEm: 1 });
natalDistribuicaoSchema.index({ "comprovante.sha256": 1 });

export default mongoose.models.NatalDistribuicao || mongoose.model("NatalDistribuicao", natalDistribuicaoSchema);
