import mongoose from "mongoose";
import { autorNatalSchema } from "./natalSchemas.js";

// Estado administrativo da campanha (fechamento definitivo da lista oficial)
// e histórico das exportações para o sorteio.

const eventoFechamentoSchema = new mongoose.Schema(
  {
    acao: { type: String, enum: ["fechamento", "reabertura"], required: true },
    em: { type: Date, required: true },
    autor: { type: autorNatalSchema, required: true },
    justificativa: { type: String, trim: true, maxlength: 1000 },
    totalCuponsValidos: Number,
  },
  { _id: false }
);

const natalCampanhaEstadoSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    listaFechada: { type: Boolean, default: false, required: true },
    fechadaEm: Date,
    fechadaPor: { type: autorNatalSchema, default: undefined },
    historico: { type: [eventoFechamentoSchema], default: [] },
  },
  { timestamps: true }
);

export const NatalCampanhaEstado = mongoose.models.NatalCampanhaEstado ||
  mongoose.model("NatalCampanhaEstado", natalCampanhaEstadoSchema);

const natalExportacaoSchema = new mongoose.Schema(
  {
    campanha: { type: String, required: true, default: "natal-2026", immutable: true },
    tipo: { type: String, enum: ["pdf_urna", "csv_numerica"], required: true, immutable: true },
    geradaEm: { type: Date, required: true, immutable: true },
    autor: { type: autorNatalSchema, required: true, immutable: true },
    listaFechada: { type: Boolean, required: true, immutable: true },
    totalCupons: { type: Number, required: true, immutable: true },
    nomeArquivo: { type: String, required: true, immutable: true },
    sha256: { type: String, required: true, immutable: true },
    // Números incluídos no arquivo, para conferência posterior da lista exportada.
    numeros: { type: [Number], default: [], select: false, immutable: true },
  },
  { versionKey: false }
);

natalExportacaoSchema.index({ geradaEm: -1 });

export const NatalExportacao = mongoose.models.NatalExportacao ||
  mongoose.model("NatalExportacao", natalExportacaoSchema);
