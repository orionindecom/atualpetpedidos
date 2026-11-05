import mongoose from "mongoose";
import { autorNatalSchema, contadoresNatalSchema, revisaoNatalSchema } from "./natalSchemas.js";

// Saldo único do distribuidor na campanha. Todos os links dele, antigos ou novos,
// consomem esta conta. Movimentos detalhados ficam em NatalMovimentoCupom.

const cuponsContaSchema = new mongoose.Schema(
  {
    // Concedidos pelos lotes antigos, reconhecidos sem recalcular nem renumerar nada.
    legado: { type: Number, default: 0, min: 0 },
    // Diferenças liberadas pelo cálculo cumulativo.
    conquistados: { type: Number, default: 0, min: 0 },
    // Retirados por decisão de adequação.
    reduzidos: { type: Number, default: 0, min: 0 },
    // Soma dos ajustes manuais: o recálculo automático nunca altera este campo.
    ajustes: { type: Number, default: 0 },
    // legado + conquistados - reduzidos + ajustes.
    total: { type: Number, default: 0 },
  },
  { _id: false }
);

const acumuladoContaSchema = new mongoose.Schema(
  {
    totalCompras: { type: Number, default: 0 },
    ciclosConcluidos: { type: Number, default: 0 },
    cicloAtual: { type: Number, default: 1 },
    acumuladoCiclo: { type: Number, default: 0 },
    nivelFaixa: { type: Number, default: 0 },
    cuponsDevidos: { type: Number, default: 0 },
    atualizadoEm: Date,
  },
  { _id: false }
);

const natalContaSchema = new mongoose.Schema(
  {
    campanha: { type: String, required: true, default: "natal-2026", immutable: true },
    clienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", required: true, immutable: true },
    distribuidorNome: { type: String, trim: true, maxlength: 200 },
    distribuidorRazaoSocial: { type: String, trim: true, maxlength: 200 },
    // Só distribuidores sem link antigo recebem um código próprio.
    codigoPublico: { type: String, immutable: true },
    cupons: { type: cuponsContaSchema, default: () => ({}) },
    contadores: { type: contadoresNatalSchema, default: () => ({}) },
    acumulado: { type: acumuladoContaSchema, default: () => ({}) },
    lotesImportados: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    // Muda a cada adequação, para a mesma faixa poder ser reconquistada depois.
    geracao: { type: Number, default: 0 },
    // Total aceito por decisão de manter ou pela migração. Benefícios acima do
    // cálculo só voltam a pedir revisão se o total cair abaixo desta referência.
    revisaoReferenciaCentavos: Number,
    revisaoPendente: {
      type: new mongoose.Schema(
        {
          detectadaEm: { type: Date, required: true },
          origem: { type: String, trim: true, maxlength: 60 },
          numeroPedido: { type: String, trim: true },
          valorAnterior: Number,
          valorNovo: Number,
          cuponsConcedidos: Number,
          cuponsDevidos: Number,
        },
        { _id: false }
      ),
      default: undefined,
    },
    revisoes: { type: [revisaoNatalSchema], default: [] },
    criadoPor: { type: autorNatalSchema, required: true },
  },
  { timestamps: true }
);

natalContaSchema.index({ campanha: 1, clienteId: 1 }, { unique: true });
natalContaSchema.index({ codigoPublico: 1 }, { unique: true, sparse: true });

export default mongoose.models.NatalConta || mongoose.model("NatalConta", natalContaSchema);
