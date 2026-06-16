import jwt from "jsonwebtoken";
import Usuario from "../models/Usuario.js";

export const proteger = async (req, res, next) => {
  try {
    let token;

    const authHeader = req.headers.authorization;

    if (
      authHeader &&
      authHeader.startsWith("Bearer ")
    ) {
      token = authHeader.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        message: "Token não informado"
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    req.usuario = await Usuario.findById(decoded.id)
      .select("-senha");

    next();

  } catch (error) {
    return res.status(401).json({
      message: "Token inválido"
    });
  }
};