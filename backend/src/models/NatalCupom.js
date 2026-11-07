import mongoose from "mongoose";
import { autorNatalSchema } from "./natalSchemas.js";

// Cupom individual: cada registro é uma chance independente no sorteio.
// O índice único em `numero` impede repetição e reaproveitamento: cupons
// cancelados, rejeitados ou invalidados permanecem gravados.
//
// Um cadastro (participacaoId) pode ter vários cupons, distribuídos em lotes
// (distribuicaoId). Cupons emitidos antes dos múltiplos cupons não têm lote: a
// migração os associa a um lote histórico de 1 cupom quando isso é comprovável.
//
// Situações:
//   pendente   — emitido no envio, aguardando a validação do cadastro ou do lote
//   valido     — validado; é o único estado que entra no sorteio
//   rejeitado  — lote ou cadastro rejeitado na validação (saldo devolvido)
//   cancelado  — cancelado por pessoa autorizada
//   invalidado — retirado por revisão de benefícios ou cancelamento de origem

export const STATUS_CUPOM = Object.freeze(["pendente", "valido", "rejeitado", "cancelado", "invalidado"]);

const origemSaldoSchema = new mongoose.Schema(
  {
    // Movimento do extrato da conta que cobre a posição deste cupom no saldo.
    movimentoId: { type: mongoose.Schema.Types.ObjectId, ref: "NatalMovimentoCupom" },
    tipo: { type: String, trim: true, maxlength: 40 },
    pedidoId: { type: mongoose.Schema.Types.ObjectId, ref: "Pedido" },
    numeroPedido: { type: String, trim: true },
    loteId: { type: mongoose.Schema.Types.ObjectId, ref: "NatalLote" },
    compraExternaId: { type: mongoose.Schema.Types.ObjectId, ref: "NatalCompraExterna" },
    referencia: { type: String, trim: true, maxlength: 120 },
    // Posição do cupom no saldo do distribuidor no momento da emissão (1 = primeiro).
    posicao: Number,
    calculadaEm: Date,
  },
  { _id: false }
);

const natalCupomSchema = new mongoose.Schema(
  {
    campanha: { type: String, required: true, default: "natal-2026", immutable: true },
    numero: { type: Number, required: true, immutable: true },
    codigo: { type: String, required: true, immutable: true },
    participacaoId: { type: mongoose.Schema.Types.ObjectId, ref: "NatalParticipacao", required: true, immutable: true },
    // Ausente nos cupons anteriores aos múltiplos cupons até a migração preenchê-lo.
    distribuicaoId: { type: mongoose.Schema.Types.ObjectId, ref: "NatalDistribuicao" },
    loteId: { type: mongoose.Schema.Types.ObjectId, ref: "NatalLote", immutable: true },
    pedidoId: { type: mongoose.Schema.Types.ObjectId, ref: "Pedido", immutable: true },
    clienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", required: true, immutable: true },
    status: { type: String, enum: STATUS_CUPOM, default: "valido", required: true },
    emitidoEm: { type: Date, required: true, immutable: true },
    emitidoPor: { type: autorNatalSchema, required: true },
    // Recebimento do lote: define a antiguidade usada na revisão de benefícios.
    recebidoEm: Date,
    validadoEm: Date,
    validadoPor: { type: autorNatalSchema, default: undefined },
    origemSaldo: { type: origemSaldoSchema, default: undefined },
    encerradoEm: Date,
    motivoEncerramento: { type: String, trim: true, maxlength: 500 },
    encerradoPor: { type: autorNatalSchema, default: undefined },
    revisaoId: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true }
);

natalCupomSchema.index({ campanha: 1, numero: 1 }, { unique: true });
// Não é único: um cadastro pode ter vários cupons. A migração remove o índice único
// antigo "participacaoId_1" antes de liberar os múltiplos cupons.
natalCupomSchema.index({ participacaoId: 1, status: 1 });
natalCupomSchema.index({ distribuicaoId: 1, status: 1 });
natalCupomSchema.index({ status: 1, numero: 1 });
natalCupomSchema.index({ loteId: 1, status: 1 });
natalCupomSchema.index({ clienteId: 1, status: 1 });

export default mongoose.models.NatalCupom || mongoose.model("NatalCupom", natalCupomSchema);
