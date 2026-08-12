import bcrypt from "bcryptjs";
import OperadorLogistica from "../models/OperadorLogistica.js";
import Pedido from "../models/Pedido.js";
import {
  isValidOperatorPin,
  OPERADOR_CONTEXT_DURATION_SECONDS,
  signOperatorContext,
} from "../utils/operadorLogistica.js";
import { pedidoAguardandoAprovacao } from "../utils/pedidoLogistica.js";
import { isNonEmptyString, sendServerError } from "../utils/validation.js";

const normalizeName = (value) => (
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
);

const serializeOperator = (operador) => ({
  _id: operador._id,
  nome: operador.nome,
  ativo: operador.ativo,
  createdAt: operador.createdAt,
  updatedAt: operador.updatedAt,
});

export const listarOperadoresAdmin = async (req, res) => {
  try {
    const operadores = await OperadorLogistica.find()
      .select("_id nome ativo createdAt updatedAt")
      .sort({ ativo: -1, nome: 1 })
      .lean()
      .maxTimeMS(5000);
    return res.status(200).json(operadores);
  } catch {
    return sendServerError(res);
  }
};

export const cadastrarOperador = async (req, res) => {
  try {
    const nome = normalizeName(req.body?.nome);
    const pin = req.body?.pin;
    if (!isNonEmptyString(nome, 120) || !isValidOperatorPin(pin)) {
      return res.status(400).json({
        message: "Informe um nome e um PIN de 4 a 6 dígitos",
      });
    }

    const pinHash = await bcrypt.hash(pin, 10);
    const operador = await OperadorLogistica.create({
      nome,
      pinHash,
      ativo: req.body?.ativo !== false,
      createdBy: req.usuario._id,
      updatedBy: req.usuario._id,
    });

    return res.status(201).json({
      message: "Operador cadastrado com sucesso",
      operador: serializeOperator(operador),
    });
  } catch {
    return sendServerError(res);
  }
};

export const atualizarOperador = async (req, res) => {
  try {
    const fields = Object.keys(req.body || {});
    if (
      fields.length === 0 ||
      fields.some((field) => !["nome", "ativo"].includes(field))
    ) {
      return res.status(400).json({ message: "Informe nome e/ou status válidos" });
    }

    const updates = { updatedBy: req.usuario._id };
    if (Object.hasOwn(req.body, "nome")) {
      const nome = normalizeName(req.body.nome);
      if (!isNonEmptyString(nome, 120)) {
        return res.status(400).json({ message: "Informe um nome válido" });
      }
      updates.nome = nome;
    }
    if (Object.hasOwn(req.body, "ativo")) {
      if (typeof req.body.ativo !== "boolean") {
        return res.status(400).json({ message: "Informe um status válido" });
      }
      updates.ativo = req.body.ativo;
    }

    const operador = await OperadorLogistica.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select("_id nome ativo createdAt updatedAt");
    if (!operador) return res.status(404).json({ message: "Operador não encontrado" });

    return res.status(200).json({
      message: "Operador atualizado com sucesso",
      operador: serializeOperator(operador),
    });
  } catch {
    return sendServerError(res);
  }
};

export const redefinirPinOperador = async (req, res) => {
  try {
    const pin = req.body?.pin;
    if (!isValidOperatorPin(pin)) {
      return res.status(400).json({ message: "Informe um PIN de 4 a 6 dígitos" });
    }

    const pinHash = await bcrypt.hash(pin, 10);
    const operador = await OperadorLogistica.findByIdAndUpdate(
      req.params.id,
      { $set: { pinHash, updatedBy: req.usuario._id } },
      { new: true, runValidators: true }
    ).select("_id nome ativo createdAt updatedAt");
    if (!operador) return res.status(404).json({ message: "Operador não encontrado" });

    return res.status(200).json({
      message: "PIN redefinido com sucesso",
      operador: serializeOperator(operador),
    });
  } catch {
    return sendServerError(res);
  }
};

export const listarOperadoresAtivos = async (req, res) => {
  try {
    const operadores = await OperadorLogistica.find({ ativo: true })
      .select("_id nome")
      .sort({ nome: 1 })
      .lean()
      .maxTimeMS(5000);
    return res.status(200).json(operadores);
  } catch {
    return sendServerError(res);
  }
};

export const identificarOperadorPedido = async (req, res) => {
  try {
    const operadorId = req.body?.operadorId;
    const pin = req.body?.pin;
    if (!operadorId || !isValidOperatorPin(pin)) {
      return res.status(422).json({ message: "PIN inválido." });
    }

    const [pedido, operador] = await Promise.all([
      Pedido.findById(req.params.id).select("_id status").lean().maxTimeMS(5000),
      OperadorLogistica.findOne({ _id: operadorId, ativo: true })
        .select("+pinHash _id nome ativo")
        .maxTimeMS(5000),
    ]);
    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado" });
    if (pedidoAguardandoAprovacao(pedido)) {
      return res.status(403).json({
        message: "Este pedido ainda aguarda aprovação administrativa",
      });
    }
    if (!operador || !(await bcrypt.compare(pin, operador.pinHash))) {
      return res.status(422).json({ message: "PIN inválido." });
    }

    const contextoOperacional = signOperatorContext({
      operadorId: operador._id,
      pedidoId: pedido._id,
      usuarioId: req.usuario._id,
    });
    return res.status(200).json({
      message: "Operador identificado",
      contextoOperacional,
      expiraEmSegundos: OPERADOR_CONTEXT_DURATION_SECONDS,
      operador: { _id: operador._id, nome: operador.nome },
    });
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(422).json({ message: "PIN inválido." });
    }
    return sendServerError(res);
  }
};
