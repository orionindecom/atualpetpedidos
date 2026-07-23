import jwt from "jsonwebtoken";
import Usuario from "../models/Usuario.js";
import { measureStage, measureStageSync } from "../utils/performance.js";

const getJwtSecret = () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET ausente ou fraco");
  }

  return process.env.JWT_SECRET;
};

export const proteger = async (req, res, next) => {
  try {
    let token;

    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        message: "Token não informado",
      });
    }

    const decoded = measureStageSync(req, "auth.jwt", () =>
      jwt.verify(token, getJwtSecret(), {
        algorithms: ["HS256"],
      })
    );

    req.usuario = await measureStage(req, "auth.usuario", () =>
      Usuario.findById(decoded.id)
        .select(
          "_id tipo tabelaPrecoId statusCadastro ativo tokenVersion nomeResponsavel nomeFantasia"
        )
    );

    if (!req.usuario) {
      return res.status(401).json({
        message: "Token inválido",
      });
    }

    if (!req.usuario.ativo) {
      return res.status(403).json({
        message: "Usuário desativado",
      });
    }

    if (
      req.usuario.tipo === "cliente" &&
      req.usuario.statusCadastro !== "aprovado"
    ) {
      return res.status(403).json({
        message: "Cadastro não aprovado",
      });
    }

    if (
      decoded.tipo !== req.usuario.tipo ||
      (decoded.tokenVersion ?? 0) !== (req.usuario.tokenVersion ?? 0)
    ) {
      return res.status(401).json({
        message: "Sessão expirada",
      });
    }

    return next();
  } catch (error) {
    return res.status(401).json({
      message: "Token inválido",
    });
  }
};
