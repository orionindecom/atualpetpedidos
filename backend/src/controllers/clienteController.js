import Usuario from "../models/Usuario.js";
import TabelaPreco from "../models/TabelaPreco.js";
import bcrypt from "bcryptjs";
import {
  isStrongEnoughPassword,
  isValidObjectId,
  sendServerError,
} from "../utils/validation.js";

export const listarClientesPendentes = async (req, res) => {
  try {
    const clientes = await Usuario.find({
      tipo: "cliente",
      statusCadastro: "pendente",
    })
      .select("-senha")
      .populate("tabelaPrecoId");

    return res.status(200).json(clientes);
  } catch (error) {
    return sendServerError(res);
  }
};

export const aprovarCliente = async (req, res) => {
  try {
    const { tabelaPrecoId } = req.body;

    if (!isValidObjectId(tabelaPrecoId)) {
      return res.status(400).json({
        message: "Informe a tabela de preço do cliente",
      });
    }

    const tabelaExiste = await TabelaPreco.exists({ _id: tabelaPrecoId });

    if (!tabelaExiste) {
      return res.status(400).json({
        message: "Tabela de preço inválida",
      });
    }

    const cliente = await Usuario.findById(req.params.id);

    if (!cliente || cliente.tipo !== "cliente") {
      return res.status(404).json({ message: "Cliente não encontrado" });
    }

    cliente.statusCadastro = "aprovado";
    cliente.tabelaPrecoId = tabelaPrecoId;
    cliente.ativo = true;
    cliente.tokenVersion = (cliente.tokenVersion ?? 0) + 1;

    await cliente.save();

    await cliente.populate("tabelaPrecoId");

    return res.status(200).json({
      message: "Cliente aprovado com sucesso",
      cliente: {
        id: cliente._id,
        nomeResponsavel: cliente.nomeResponsavel,
        email: cliente.email,
        tabelaPrecoId: cliente.tabelaPrecoId,
        statusCadastro: cliente.statusCadastro,
      },
    });
  } catch (error) {
    return sendServerError(res);
  }
};

export const redefinirSenhaCliente = async (req, res) => {
  try {
    const { novaSenha } = req.body;

    if (!isStrongEnoughPassword(novaSenha)) {
      return res.status(400).json({
        message: "A nova senha deve ter pelo menos 8 caracteres",
      });
    }

    const cliente = await Usuario.findById(req.params.id);

    if (!cliente || cliente.tipo !== "cliente") {
      return res.status(404).json({
        message: "Cliente não encontrado",
      });
    }

    const senhaHash = await bcrypt.hash(novaSenha, 10);

    cliente.senha = senhaHash;
    cliente.tokenVersion = (cliente.tokenVersion ?? 0) + 1;

    await cliente.save();

    return res.status(200).json({
      message: "Senha redefinida com sucesso",
    });
  } catch (error) {
    return sendServerError(res);
  }
};

export const listarClientes = async (req, res) => {
  try {
    const clientes = await Usuario.find({
      tipo: "cliente",
    })
      .select("-senha")
      .populate("tabelaPrecoId")
      .sort({ createdAt: -1 });

    return res.status(200).json(clientes);
  } catch (error) {
    return sendServerError(res);
  }
};

export const inativarCliente = async (req, res) => {
  try {
    const cliente = await Usuario.findById(req.params.id);

    if (!cliente || cliente.tipo !== "cliente") {
      return res.status(404).json({
        message: "Cliente não encontrado",
      });
    }

    cliente.statusCadastro = "inativo";
    cliente.ativo = false;
    cliente.tokenVersion = (cliente.tokenVersion ?? 0) + 1;

    await cliente.save();

    return res.status(200).json({
      message: "Cliente inativado com sucesso",
    });
  } catch (error) {
    return sendServerError(res, "Erro ao inativar cliente");
  }
};

export const reativarCliente = async (req, res) => {
  try {
    const cliente = await Usuario.findById(req.params.id);

    if (!cliente || cliente.tipo !== "cliente") {
      return res.status(404).json({
        message: "Cliente não encontrado",
      });
    }

    cliente.statusCadastro = "aprovado";
    cliente.ativo = true;
    cliente.tokenVersion = (cliente.tokenVersion ?? 0) + 1;

    await cliente.save();

    return res.status(200).json({
      message: "Cliente reativado com sucesso",
    });
  } catch (error) {
    return sendServerError(res, "Erro ao reativar cliente");
  }
};
