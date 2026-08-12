import jwt from "jsonwebtoken";

export const OPERADOR_CONTEXT_HEADER = "x-operador-contexto";
export const OPERADOR_CONTEXT_PURPOSE = "operacao_logistica_pedido";
export const OPERADOR_CONTEXT_DURATION_SECONDS = 15 * 60;

const getJwtSecret = () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET ausente ou fraco");
  }

  return process.env.JWT_SECRET;
};

export const isValidOperatorPin = (pin) => (
  typeof pin === "string" && /^\d{4,6}$/.test(pin)
);

export const buildOperatorSnapshot = (operador) => ({
  operadorId: operador._id,
  operadorNome: operador.nome,
});

export const signOperatorContext = ({ operadorId, pedidoId, usuarioId }) => (
  jwt.sign(
    {
      purpose: OPERADOR_CONTEXT_PURPOSE,
      operadorId: String(operadorId),
      pedidoId: String(pedidoId),
      usuarioId: String(usuarioId),
    },
    getJwtSecret(),
    {
      algorithm: "HS256",
      expiresIn: OPERADOR_CONTEXT_DURATION_SECONDS,
    }
  )
);

export const verifyOperatorContext = (token) => (
  jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] })
);
