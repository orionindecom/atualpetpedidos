import Usuario from "../models/Usuario.js";
import TabelaPreco from "../models/TabelaPreco.js";
import bcrypt from "bcryptjs";
import {
  isNonEmptyString,
  isOptionalString,
  isStrongEnoughPassword,
  isValidObjectId,
  sendServerError,
} from "../utils/validation.js";
import { measureStage, measureStageSync } from "../utils/performance.js";

const TIPOS_CADASTRO_GERENCIADOS = Object.freeze(["cliente", "groomer"]);
const CAMPOS_DISTRIBUIDOR_EDITAVEIS = Object.freeze([
  "nomeResponsavel",
  "razaoSocial",
  "nomeFantasia",
  "telefone",
  "whatsapp",
  "tabelaPrecoId",
]);
const CAMPOS_GROOMER_EDITAVEIS = Object.freeze([
  "nomeResponsavel",
  "whatsapp",
  "cidade",
  "estado",
  "nomeProfissional",
  "instagram",
  "tiktok",
  "observacaoCadastro",
]);

const FILTRO_TABELA_DISTRIBUIDOR_ATIVA = Object.freeze({
  ativa: { $ne: false },
  $or: [
    { tipo: "distribuidor" },
    { tipo: { $exists: false } },
  ],
});

const normalizarClienteAdmin = (cliente) => {
  const source = typeof cliente?.toObject === "function"
    ? cliente.toObject()
    : { ...cliente };
  delete source.senha;
  delete source.tokenVersion;
  if (source.tipo === "groomer") delete source.tabelaPrecoId;
  return source;
};

const isManagedAccount = (usuario) => TIPOS_CADASTRO_GERENCIADOS.includes(usuario?.tipo);
const accountLabel = (usuario) => usuario?.tipo === "groomer" ? "Groomer" : "Distribuidor";

export const validateAdminClientUpdate = (source, tipo = "cliente") => {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return { valid: false, errors: { campos: "Informe os dados do cliente" } };
  }

  const errors = {};
  const data = {};
  const fields = Object.keys(source);
  const allowedFields = tipo === "groomer"
    ? CAMPOS_GROOMER_EDITAVEIS
    : CAMPOS_DISTRIBUIDOR_EDITAVEIS;
  const forbidden = fields.filter((field) => !allowedFields.includes(field));
  if (forbidden.length > 0) {
    errors.campos = `Campos não permitidos: ${forbidden.join(", ")}`;
  }

  if (Object.hasOwn(source, "nomeResponsavel")) {
    if (!isNonEmptyString(source.nomeResponsavel, 120)) {
      errors.nomeResponsavel = "Informe o nome do responsável em até 120 caracteres";
    } else {
      data.nomeResponsavel = source.nomeResponsavel.trim();
    }
  }

  const textFields = tipo === "groomer" ? [
    ["whatsapp", 32],
    ["cidade", 120],
    ["estado", 2],
    ["nomeProfissional", 160],
    ["instagram", 160],
    ["tiktok", 160],
    ["observacaoCadastro", 1000],
  ] : [
    ["razaoSocial", 160],
    ["nomeFantasia", 160],
    ["telefone", 32],
    ["whatsapp", 32],
  ];
  for (const [field, maxLength] of textFields) {
    if (!Object.hasOwn(source, field)) continue;
    if (!isOptionalString(source[field], maxLength) || typeof source[field] !== "string") {
      errors[field] = `Informe um texto de até ${maxLength} caracteres`;
    } else {
      data[field] = field === "estado"
        ? source[field].trim().toUpperCase()
        : source[field].trim();
    }
  }

  if (tipo === "groomer") {
    if (Object.hasOwn(source, "whatsapp") && !data.whatsapp) {
      errors.whatsapp = "Informe o WhatsApp do Groomer";
    }
    if (Object.hasOwn(source, "cidade") && !data.cidade) {
      errors.cidade = "Informe a cidade em até 120 caracteres";
    }
    if (Object.hasOwn(source, "estado") && !/^[A-Z]{2}$/.test(data.estado || "")) {
      errors.estado = "Informe uma UF válida com 2 letras";
      delete data.estado;
    }
  }

  if (Object.hasOwn(source, "tabelaPrecoId")) {
    if (!isValidObjectId(source.tabelaPrecoId)) {
      errors.tabelaPrecoId = "Informe uma tabela de preços válida";
    } else {
      data.tabelaPrecoId = source.tabelaPrecoId;
    }
  }

  if (fields.length === 0) {
    errors.campos = "Informe ao menos um campo para atualizar";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    data,
  };
};

export const criarPipelineClientes = ({ pendentes = false, tipo } = {}) => {
  const match = {
    tipo: TIPOS_CADASTRO_GERENCIADOS.includes(tipo)
      ? tipo
      : { $in: TIPOS_CADASTRO_GERENCIADOS },
  };

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

export const obterClienteAdmin = async (req, res) => {
  try {
    const cliente = await Usuario.findById(req.params.id)
      .select("-senha -tokenVersion");

    if (!isManagedAccount(cliente)) {
      return res.status(404).json({ message: "Cliente não encontrado" });
    }

    await cliente.populate({
      path: "tabelaPrecoId",
      select: "nome descricao tipo ativa",
    });

    return res.status(200).json({ cliente: normalizarClienteAdmin(cliente) });
  } catch (error) {
    return sendServerError(res);
  }
};

export const atualizarClienteAdmin = async (req, res) => {
  try {
    const cliente = await Usuario.findById(req.params.id);
    if (!isManagedAccount(cliente)) {
      return res.status(404).json({ message: "Cliente não encontrado" });
    }

    const parsed = validateAdminClientUpdate(req.body, cliente.tipo);
    if (!parsed.valid) {
      return res.status(400).json({
        message: "Dados administrativos inválidos",
        errors: parsed.errors,
      });
    }

    if (Object.hasOwn(parsed.data, "tabelaPrecoId")) {
      const tabela = await TabelaPreco.findOne({
        _id: parsed.data.tabelaPrecoId,
        ...FILTRO_TABELA_DISTRIBUIDOR_ATIVA,
      }).select("_id");
      if (!tabela) {
        return res.status(400).json({
          message: "A tabela selecionada não existe ou não está disponível para distribuidores",
        });
      }
    }

    for (const [field, value] of Object.entries(parsed.data)) {
      cliente[field] = value;
    }
    await cliente.save();
    await cliente.populate({
      path: "tabelaPrecoId",
      select: "nome descricao tipo ativa",
    });

    return res.status(200).json({
      message: `${accountLabel(cliente)} atualizado com sucesso`,
      cliente: normalizarClienteAdmin(cliente),
    });
  } catch (error) {
    return sendServerError(res);
  }
};

export const aprovarCliente = async (req, res) => {
  try {
    const cliente = await Usuario.findById(req.params.id);

    if (!isManagedAccount(cliente)) {
      return res.status(404).json({ message: "Cliente não encontrado" });
    }

    if (cliente.tipo === "cliente") {
      const { tabelaPrecoId } = req.body;
      if (!isValidObjectId(tabelaPrecoId)) {
        return res.status(400).json({
          message: "Informe a tabela de preço do cliente",
        });
      }

      const tabelaExiste = await TabelaPreco.exists({
        _id: tabelaPrecoId,
        ...FILTRO_TABELA_DISTRIBUIDOR_ATIVA,
      });

      if (!tabelaExiste) {
        return res.status(400).json({
          message: "Tabela de preço inválida ou indisponível para distribuidores",
        });
      }
      cliente.tabelaPrecoId = tabelaPrecoId;
    } else {
      cliente.tabelaPrecoId = undefined;
    }

    cliente.statusCadastro = "aprovado";
    cliente.ativo = true;
    cliente.aprovadoEm ||= new Date();
    cliente.tokenVersion = (cliente.tokenVersion ?? 0) + 1;

    await cliente.save();
    await cliente.populate({
      path: "tabelaPrecoId",
      select: "nome descricao tipo ativa",
    });

    return res.status(200).json({
      message: `${accountLabel(cliente)} aprovado com sucesso`,
      cliente: normalizarClienteAdmin(cliente),
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

    if (!isManagedAccount(cliente)) {
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
      Usuario.aggregate(criarPipelineClientes({ tipo: req.query?.tipo }))
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

    if (!isManagedAccount(cliente)) {
      return res.status(404).json({
        message: "Cliente não encontrado",
      });
    }

    if (!["aprovado", "inativo"].includes(cliente.statusCadastro)) {
      return res.status(409).json({
        message: "Somente cadastros aprovados podem ser desativados",
      });
    }

    cliente.ativo = false;
    cliente.tokenVersion = (cliente.tokenVersion ?? 0) + 1;

    await cliente.save();
    await cliente.populate({
      path: "tabelaPrecoId",
      select: "nome descricao tipo ativa",
    });

    return res.status(200).json({
      message: `${accountLabel(cliente)} inativado com sucesso`,
      cliente: normalizarClienteAdmin(cliente),
    });
  } catch (error) {
    return sendServerError(res, "Erro ao inativar cliente");
  }
};

export const reativarCliente = async (req, res) => {
  try {
    const cliente = await Usuario.findById(req.params.id);

    if (!isManagedAccount(cliente)) {
      return res.status(404).json({
        message: "Cliente não encontrado",
      });
    }

    if (!["aprovado", "inativo"].includes(cliente.statusCadastro)) {
      return res.status(409).json({
        message: "Somente cadastros aprovados podem ser reativados",
      });
    }

    if (cliente.statusCadastro === "inativo") {
      cliente.statusCadastro = "aprovado";
    }
    cliente.ativo = true;
    cliente.tokenVersion = (cliente.tokenVersion ?? 0) + 1;

    await cliente.save();
    await cliente.populate({
      path: "tabelaPrecoId",
      select: "nome descricao tipo ativa",
    });

    return res.status(200).json({
      message: `${accountLabel(cliente)} reativado com sucesso`,
      cliente: normalizarClienteAdmin(cliente),
    });
  } catch (error) {
    return sendServerError(res, "Erro ao reativar cliente");
  }
};

export const rejeitarCliente = async (req, res) => {
  try {
    const cliente = await Usuario.findById(req.params.id);
    if (!isManagedAccount(cliente)) {
      return res.status(404).json({ message: "Cliente não encontrado" });
    }

    if (cliente.statusCadastro !== "pendente") {
      return res.status(409).json({
        message: "Somente cadastros pendentes podem ser rejeitados",
      });
    }

    cliente.statusCadastro = "reprovado";
    cliente.ativo = false;
    cliente.aprovadoEm = undefined;
    cliente.tokenVersion = (cliente.tokenVersion ?? 0) + 1;
    await cliente.save();

    return res.status(200).json({
      message: `${accountLabel(cliente)} rejeitado com sucesso`,
      cliente: normalizarClienteAdmin(cliente),
    });
  } catch (error) {
    return sendServerError(res, "Erro ao rejeitar cadastro");
  }
};
