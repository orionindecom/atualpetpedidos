import { effectivePermissions } from "../utils/permissions.js";
import Usuario from "../models/Usuario.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { isValidEmail, sendServerError } from "../utils/validation.js";
import { measureStage, measureStageSync } from "../utils/performance.js";
import { cadastroExternoBloqueiaAcesso } from "../utils/userAccess.js";
import {
  buildDocumentDuplicateCandidates,
  getCadastroDocumentType,
  normalizeDigits,
  validateCadastroGroomerPayload,
  validateCadastroPayload,
} from "../utils/cadastroValidation.js";

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

const cadastrarContaExterna = async (
  req,
  res,
  { tipo, validatePayload, fields, message }
) => {
  try {
    const parsed = validatePayload(req.body);
    if (!parsed.valid) {
      return res.status(400).json({
        message: "Dados de cadastro inválidos",
        errors: parsed.errors,
      });
    }

    const documentCandidates = buildDocumentDuplicateCandidates(parsed.data.cnpj);
    const duplicateConditions = [{ email: parsed.data.email }];
    if (documentCandidates.length > 0) {
      duplicateConditions.push({ cnpj: { $in: documentCandidates } });
    }

    const usuariosExistentes = await Usuario.find({ $or: duplicateConditions })
      .select("email cnpj")
      .lean();
    const duplicateErrors = {};

    for (const usuario of usuariosExistentes) {
      if (usuario.email?.trim().toLowerCase() === parsed.data.email) {
        duplicateErrors.email = "Este e-mail já está cadastrado.";
      }
      if (
        parsed.data.cnpj &&
        normalizeDigits(usuario.cnpj) === parsed.data.cnpj
      ) {
        const documentType = getCadastroDocumentType(parsed.data.cnpj);
        duplicateErrors.cnpj = documentType === "cpf"
          ? "Este CPF já está cadastrado."
          : "Este CNPJ já está cadastrado.";
      }
    }

    if (Object.keys(duplicateErrors).length > 0) {
      return res.status(409).json({
        message: "Não foi possível concluir o cadastro.",
        errors: duplicateErrors,
      });
    }

    const senhaHash = await bcrypt.hash(parsed.data.senha, 10);

    const cadastro = {
      nomeResponsavel: parsed.data.nomeResponsavel,
      email: parsed.data.email,
      senha: senhaHash,
      tipo,
      statusCadastro: "pendente",
    };
    for (const field of fields) {
      if (parsed.data[field]) cadastro[field] = parsed.data[field];
    }

    const novoUsuario = await Usuario.create(cadastro);

    return res.status(201).json({
      message,
      usuario: {
        id: novoUsuario._id,
        nomeResponsavel: novoUsuario.nomeResponsavel,
        email: novoUsuario.email,
        tipo: novoUsuario.tipo,
        statusCadastro: novoUsuario.statusCadastro,
      },
    });
  } catch (error) {
    if (error?.code === 11000) {
      const field = (error.keyPattern?.cnpj || error.keyValue?.cnpj) ? "cnpj" : "email";
      const documentType = getCadastroDocumentType(req.body?.cnpj);
      return res.status(409).json({
        message: "Não foi possível concluir o cadastro.",
        errors: {
          [field]: field === "cnpj"
            ? `Este ${documentType === "cpf" ? "CPF" : "CNPJ"} já está cadastrado.`
            : "Este e-mail já está cadastrado.",
        },
      });
    }
    return sendServerError(res);
  }
};

export const cadastrar = (req, res) => cadastrarContaExterna(req, res, {
  tipo: "cliente",
  validatePayload: validateCadastroPayload,
  fields: ["razaoSocial", "nomeFantasia", "cnpj", "telefone", "whatsapp"],
  message: "Cadastro realizado com sucesso. Aguarde aprovação.",
});

export const cadastrarGroomer = (req, res) => cadastrarContaExterna(req, res, {
  tipo: "groomer",
  validatePayload: validateCadastroGroomerPayload,
  fields: [
    "cnpj",
    "whatsapp",
    "cidade",
    "estado",
    "nomeProfissional",
    "instagram",
    "tiktok",
    "observacaoCadastro",
  ],
  message: "Cadastro de Groomer enviado com sucesso. Aguarde aprovação.",
});

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

    if (cadastroExternoBloqueiaAcesso(usuario)) {
      if (usuario.statusCadastro === 'pendente' || usuario.statusCadastro === 'reprovado') {
        return res.status(403).json({
          code: usuario.statusCadastro === 'pendente' ? 'REGISTRATION_PENDING' : 'REGISTRATION_REJECTED',
          status: usuario.statusCadastro,
          message: usuario.statusCadastro === 'pendente' ? 'Cadastro ainda não aprovado.' : 'Cadastro não aprovado.',
        });
      }
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
        permissoes: usuario.permissoes,
        permissoesEfetivas: effectivePermissions(usuario),
        tabelaPrecoId: usuario.tabelaPrecoId,
        statusCadastro: usuario.statusCadastro,
      },
    });
  } catch (error) {
    return sendServerError(res);
  }
};
