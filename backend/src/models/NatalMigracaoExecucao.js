import mongoose from "mongoose";

// Histórico das etapas da ativação do modelo cumulativo. O índice parcial permite
// uma única execução em andamento, o que serve de trava contra execuções simultâneas.

export const ETAPAS_MIGRACAO = Object.freeze(["migracao", "concessao", "ativacao", "reversao"]);

const natalMigracaoExecucaoSchema = new mongoose.Schema(
  {
    campanha: { type: String, required: true, default: "natal-2026", immutable: true },
    execucaoId: { type: String, required: true, immutable: true },
    etapa: { type: String, enum: ETAPAS_MIGRACAO, required: true, immutable: true },
    status: { type: String, enum: ["em_andamento", "concluida", "falhou"], default: "em_andamento", required: true },
    // Presente só enquanto a execução está em andamento.
    emAndamento: { type: Boolean },
    operador: { type: String, required: true, trim: true, maxlength: 160, immutable: true },
    iniciadaEm: { type: Date, required: true, immutable: true },
    concluidaEm: Date,
    resumo: { type: mongoose.Schema.Types.Mixed },
    erro: { type: String, trim: true, maxlength: 500 },
  },
  { versionKey: false }
);

natalMigracaoExecucaoSchema.index({ execucaoId: 1 }, { unique: true });
natalMigracaoExecucaoSchema.index(
  { campanha: 1, emAndamento: 1 },
  { unique: true, partialFilterExpression: { emAndamento: true } }
);
natalMigracaoExecucaoSchema.index({ iniciadaEm: -1 });

export default mongoose.models.NatalMigracaoExecucao || mongoose.model("NatalMigracaoExecucao", natalMigracaoExecucaoSchema);
