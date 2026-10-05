import { registrarSaidaAdministrativa, PedidoSaidaError } from "../services/pedidoSaidaService.js";
import { enrichInternalOrderDetail, transicoesPermitidasParaPedido } from "../utils/pedidoLogistica.js";
import { sendServerError } from "../utils/validation.js";

const registrar = (destino) => async (req, res) => {
  try {
    const pedido = await registrarSaidaAdministrativa({ pedidoId: req.params.id, destino, usuario: req.usuario });
    return res.status(200).json({
      message: destino === "enviado" ? "Pedido marcado como enviado pelo Admin" : "Pedido retirado pelo distribuidor",
      pedido: enrichInternalOrderDetail(pedido),
      transicoesPermitidas: transicoesPermitidasParaPedido(pedido, { admin: true }),
    });
  } catch (error) {
    if (error instanceof PedidoSaidaError) return res.status(error.statusCode).json({ message: error.message });
    return sendServerError(res);
  }
};

export const marcarPedidoEnviadoAdmin = registrar("enviado");
export const marcarPedidoRetiradoAdmin = registrar("retirado");
