import OperadorLogistica from "../models/OperadorLogistica.js";
import {
  OPERADOR_CONTEXT_HEADER,
  OPERADOR_CONTEXT_PURPOSE,
  verifyOperatorContext,
} from "../utils/operadorLogistica.js";

const contextError = (res, message, code = "OPERADOR_CONTEXT_INVALIDO") => (
  res.status(428).json({ message, code })
);

export const exigirContextoOperador = async (req, res, next) => {
  if (req.usuario?.tipo === "admin") return next();

  const token = req.headers[OPERADOR_CONTEXT_HEADER];
  if (typeof token !== "string" || !token) {
    return contextError(
      res,
      "Identifique o operador para continuar",
      "OPERADOR_CONTEXT_NAO_INFORMADO"
    );
  }

  try {
    const payload = verifyOperatorContext(token);
    if (
      payload.purpose !== OPERADOR_CONTEXT_PURPOSE ||
      String(payload.usuarioId) !== String(req.usuario?._id) ||
      String(payload.pedidoId) !== String(req.params.id)
    ) {
      return contextError(res, "A identificação do operador não pertence a este pedido");
    }

    const operador = await OperadorLogistica.findById(payload.operadorId)
      .select("_id nome ativo")
      .maxTimeMS(5000);
    if (!operador || !operador.ativo) {
      return contextError(res, "O operador não está disponível para novas operações");
    }

    req.operadorLogistica = operador;
    return next();
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      return contextError(
        res,
        "A identificação do operador expirou. Identifique-se novamente.",
        "OPERADOR_CONTEXT_EXPIRADO"
      );
    }

    return contextError(res, "Identificação do operador inválida");
  }
};
