import mongoose from "mongoose";
import { autorNatalSchema } from "./natalSchemas.js";

// Trilha de auditoria da campanha. Somente inserção: qualquer tentativa de
// alterar ou excluir registros pelo Mongoose é bloqueada.

export const ACOES_AUDITORIA_NATAL = Object.freeze([
  "lote_criado",
  "lote_faixa_aumentada",
  "lote_valor_atualizado",
  "lote_invalidado",
  "beneficios_revisados",
  "lote_reducao_sem_revisao",
  "participacao_recebida",
  "participacao_aprovada",
  "participacao_rejeitada",
  "participacao_cancelada",
  "participacao_invalidada",
  "participacao_invalidada_revisao",
  "cupom_emitido",
  "cupom_cancelado",
  "cupom_invalidado",
  "lista_fechada",
  "lista_reaberta",
  "exportacao_gerada",
  "contadores_reconciliados",
]);

const natalAuditoriaSchema = new mongoose.Schema(
  {
    campanha: { type: String, required: true, default: "natal-2026", immutable: true },
    acao: { type: String, enum: ACOES_AUDITORIA_NATAL, required: true, immutable: true },
    em: { type: Date, required: true, immutable: true },
    autor: { type: autorNatalSchema, required: true, immutable: true },
    loteId: { type: mongoose.Schema.Types.ObjectId, ref: "NatalLote", immutable: true },
    pedidoId: { type: mongoose.Schema.Types.ObjectId, ref: "Pedido", immutable: true },
    participacaoId: { type: mongoose.Schema.Types.ObjectId, ref: "NatalParticipacao", immutable: true },
    cupomNumero: { type: Number, immutable: true },
    aposFechamento: { type: Boolean, default: false, immutable: true },
    detalhes: { type: mongoose.Schema.Types.Mixed, immutable: true },
  },
  { versionKey: false }
);

const bloquear = function bloquearAlteracao() {
  throw new Error("Registros de auditoria da campanha são imutáveis");
};

for (const operacao of [
  "updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace",
  "deleteOne", "deleteMany", "findOneAndDelete",
]) {
  natalAuditoriaSchema.pre(operacao, bloquear);
}

natalAuditoriaSchema.pre("save", function bloquearRegravacao() {
  if (!this.isNew) throw new Error("Registros de auditoria da campanha são imutáveis");
});

natalAuditoriaSchema.index({ em: -1 });
natalAuditoriaSchema.index({ loteId: 1, em: -1 });
natalAuditoriaSchema.index({ participacaoId: 1, em: -1 });
natalAuditoriaSchema.index({ acao: 1, em: -1 });

export default mongoose.models.NatalAuditoria || mongoose.model("NatalAuditoria", natalAuditoriaSchema);
