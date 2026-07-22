import Usuario from "../models/Usuario.js";
import TabelaPreco from "../models/TabelaPreco.js";
import bcrypt from "bcryptjs";
import {
  isStrongEnoughPassword,
  isValidObjectId,
  sendServerError,
} from "../utils/validation.js";
import { measureStage, measureStageSync } from "../utils/performance.js";

export const criarPipelineClientes = ({ pendentes = false } = {}) => {
  const match = { tipo: "cliente" };

  if (pendentes) {
    match.statusCadastro = "pendente";
  }

  return [
    { $match: match },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: "tabelaprecos",
        localField: "tabelaPrecoId",
        foreignField: "_id",
        as: "tabelaPrecoRelacionada",
      },
    },
    {
      $set: {
        statusCadastro: { $ifNull: ["$statusCadastro", "pendente"] },
        ativo: { $ifNull: ["$ativo", true] },
        tabelaPrecoId: {
          $ifNull: [
            {
              $arrayElemAt: [
                {
                  $map: {
                    input: "$tabelaPrecoRelacionada",
                    as: "tabela",
                    in: {
                      $mergeObjects: [
                        { tipo: "distribuidor", ativa: true },
                        "$$tabela",
                      ],
                    },
                  },
                },
                0,
              ],
            },
            null,
          ],
        },
      },
    },
    { $unset: ["senha", "tokenVersion", "tabelaPrecoRelacionada"] },
  ];
};

export const listarClientesPendentes = async (req, res) => {
  try {
    const clientes = await measureStage(req, "query.clientes_pendentes", () =>
      Usuario.aggregate(criarPipelineClientes({ pendentes: true }))
    );

    return measureStageSync(req, "response.clientes_pendentes", () =>
      res.status(200).json(clientes)
    );
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
    const clientes = await measureStage(req, "query.clientes", () =>
      Usuario.aggregate(criarPipelineClientes())
    );

    return measureStageSync(req, "response.clientes", () =>
      res.status(200).json(clientes)
    );
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
