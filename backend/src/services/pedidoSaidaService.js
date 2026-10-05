import Pedido from "../models/Pedido.js";
import {
  buildStatusHistoryEntry,
  conferenciaConcluida,
  fechamentoLogisticoConcluido,
  getSeparationCompletionBlockers,
  pedidoExigeConferencia,
  pedidoExigeFechamentoLogistico,
  pedidoPossuiEntregaConfirmada,
  PEDIDO_STATUS,
} from "../utils/pedidoLogistica.js";

export class PedidoSaidaError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const validarSaidaAdministrativa = (pedido, destino) => {
  if (!PEDIDO_STATUS.includes(pedido.status)) throw new PedidoSaidaError(409, "Estado atual do pedido inválido");
  if (pedido.status === destino) return;
  if (pedidoPossuiEntregaConfirmada(pedido) || ["cancelado", "enviado"].includes(pedido.status)) {
    throw new PedidoSaidaError(409, "Este pedido já saiu da operação ou foi cancelado");
  }
  if (destino === "retirado") {
    if (!["separado", "faturado"].includes(pedido.status)) {
      throw new PedidoSaidaError(409, "Conclua as etapas de preparação do pedido antes da retirada");
    }
    // Faturados legados mantêm a preparação já encerrada, sem exigir novos campos.
    if (pedido.status === "separado" && (
      getSeparationCompletionBlockers(pedido).length > 0 ||
      (pedidoExigeConferencia(pedido) && !conferenciaConcluida(pedido)) ||
      (pedidoExigeFechamentoLogistico(pedido) && !fechamentoLogisticoConcluido(pedido))
    )) {
      throw new PedidoSaidaError(409, "Conclua a separação, conferência e fechamento necessários antes da retirada");
    }
  }
};

export const registrarSaidaAdministrativa = async ({ pedidoId, destino, usuario }) => {
  if (usuario?.tipo !== "admin") throw new PedidoSaidaError(403, "Ação exclusiva do Admin");
  if (!["enviado", "retirado"].includes(destino)) throw new PedidoSaidaError(400, "Destino inválido");
  const pedido = await Pedido.findById(pedidoId)
    .select("+historicoStatus +ocorrencias +historicoAlteracoes +historicoConferencias");
  if (!pedido) throw new PedidoSaidaError(404, "Pedido não encontrado");
  validarSaidaAdministrativa(pedido, destino);
  if (pedido.status === destino) return pedido;

  const now = new Date();
  const historico = {
    ...buildStatusHistoryEntry({
      statusAnterior: pedido.status,
      novoStatus: destino,
      usuario,
      now,
      observacao: destino === "enviado"
        ? "Admin utilizou o avanço direto para Enviado. Etapas intermediárias ignoradas."
        : "Pedido retirado pelo distribuidor. Operação concluída pelo Admin.",
    }),
    acao: destino === "enviado" ? "envio_direto_admin" : "retirada_admin",
  };
  const campos = destino === "enviado"
    ? { dataEnvio: now }
    : {
      retiradoEm: now,
      retiradoPor: {
        usuarioId: usuario._id,
        usuarioNome: historico.usuarioNome,
        usuarioTipo: usuario.tipo,
      },
    };

  // Status, data e auditoria são gravados juntos. A versão evita perder uma
  // edição concorrente; repetições retornam o registro já persistido.
  const atualizado = await Pedido.findOneAndUpdate({
    _id: pedidoId,
    status: pedido.status,
    ...(pedido.__v === undefined
      ? { $or: [{ __v: { $exists: false } }, { __v: 0 }] }
      : { __v: pedido.__v }),
  }, {
    $set: { status: destino, ...campos },
    $push: { historicoStatus: historico },
    $inc: { __v: 1 },
  }, { returnDocument: "after", runValidators: true })
    .select("+historicoStatus +ocorrencias +historicoAlteracoes +historicoConferencias");
  if (atualizado) return atualizado;
  const atual = await Pedido.findById(pedidoId).select("+historicoStatus");
  if (atual?.status === destino) return atual;
  throw new PedidoSaidaError(409, "Pedido atualizado por outra pessoa. Recarregue antes de continuar");
};
