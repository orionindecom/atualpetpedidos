import Usuario from "../models/Usuario.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  isNonEmptyString,
  isOptionalString,
  isStrongEnoughPassword,
  isValidEmail,
  sendServerError,
} from "../utils/validation.js";
import { measureStage, measureStageSync } from "../utils/performance.js";

const getJwtSecret = () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET ausente ou fraco");
  }

  return process.env.JWT_SECRET;
};

const gerarToken = (usuario) => {
  return jwt.sign(
    {
      id: usuario._id,
      tipo: usuario.tipo,
      tabelaPrecoId: usuario.tabelaPrecoId,
      tokenVersion: usuario.tokenVersion ?? 0,
    },
    getJwtSecret(),
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "8h",
      algorithm: "HS256",
    }
  );
};

export const cadastrar = async (req, res) => {
  try {
    const {
      nomeResponsavel,
      email,
      senha,
      razaoSocial,
      nomeFantasia,
      cnpj,
      telefone,
      whatsapp,
    } = req.body;

    if (
      !isNonEmptyString(nomeResponsavel, 120) ||
      !isValidEmail(email) ||
      !isStrongEnoughPassword(senha) ||
      !isOptionalString(razaoSocial, 160) ||
      !isOptionalString(nomeFantasia, 160) ||
      !isOptionalString(cnpj, 32) ||
      !isOptionalString(telefone, 32) ||
      !isOptionalString(whatsapp, 32)
    ) {
      return res.status(400).json({
        message: "Dados de cadastro inválidos",
      });
    }

    const emailNormalizado = email.trim().toLowerCase();

    const usuarioExiste = await Usuario.findOne({ email: emailNormalizado });

    if (usuarioExiste) {
      return res.status(202).json({
        message: "Solicitação de cadastro recebida. Aguarde aprovação.",
      });
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    const novoUsuario = await Usuario.create({
      nomeResponsavel: nomeResponsavel?.trim(),
      email: emailNormalizado,
      senha: senhaHash,
      razaoSocial: razaoSocial?.trim(),
      nomeFantasia: nomeFantasia?.trim(),
      cnpj: cnpj?.trim(),
      telefone: telefone?.trim(),
      whatsapp: whatsapp?.trim(),
      tipo: "cliente",
      statusCadastro: "pendente",
    });

    return res.status(201).json({
      message: "Cadastro realizado com sucesso. Aguarde aprovação.",
      usuario: {
        id: novoUsuario._id,
        nomeResponsavel: novoUsuario.nomeResponsavel,
        email: novoUsuario.email,
        statusCadastro: novoUsuario.statusCadastro,
      },
    });
  } catch (error) {
    return sendServerError(res);
  }
};

export const login = async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!isValidEmail(email) || typeof senha !== "string") {
      return res.status(401).json({
        message: "E-mail ou senha inválidos",
      });
    }

    const usuario = await measureStage(req, "query.login_usuario", () =>
      Usuario.findOne({
        email: email.trim().toLowerCase(),
      })
    );

    if (!usuario) {
      return res.status(401).json({
        message: "E-mail ou senha inválidos",
      });
    }

    const senhaCorreta = await measureStage(req, "cpu.bcrypt", () =>
      bcrypt.compare(senha, usuario.senha)
    );

    if (!senhaCorreta) {
      return res.status(401).json({
        message: "E-mail ou senha inválidos",
      });
    }

    if (!usuario.ativo) {
      return res.status(403).json({
        message: "Usuário desativado",
      });
    }

    if (usuario.tipo === "cliente" && usuario.statusCadastro !== "aprovado") {
      return res.status(403).json({
        message: "Cadastro ainda não aprovado pelo administrador",
      });
    }

    usuario.ultimoLogin = new Date();
    await measureStage(req, "query.login_atualizar", () => usuario.save());

    const token = measureStageSync(req, "cpu.jwt_sign", () =>
      gerarToken(usuario)
    );

    return res.status(200).json({
      message: "Login realizado com sucesso",
      token,
      usuario: {
        id: usuario._id,
        nomeResponsavel: usuario.nomeResponsavel,
        email: usuario.email,
        tipo: usuario.tipo,
        tabelaPrecoId: usuario.tabelaPrecoId,
        statusCadastro: usuario.statusCadastro,
      },
    });
  } catch (error) {
    return sendServerError(res);
  }
};
