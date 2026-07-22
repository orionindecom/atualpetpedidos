import TabelaPreco from "../models/TabelaPreco.js";
import PrecoProduto from "../models/PrecoProduto.js";
import {
  isNonEmptyString,
  isOptionalString,
  sendServerError,
} from "../utils/validation.js";
import { measureStage, measureStageSync } from "../utils/performance.js";

const tiposTabelaPermitidos = new Set([
  "distribuidor",
  "cliente_final_internet",
  "cliente_final_loja",
]);

export const criarTabela = async (req, res) => {
  try {
    const { nome, descricao, tipo } = req.body;

    if (
      !isNonEmptyString(nome, 120) ||
      !isOptionalString(descricao, 500) ||
      (tipo !== undefined && !tiposTabelaPermitidos.has(tipo))
    ) {
      return res.status(400).json({
        message: "Dados da tabela inválidos",
      });
    }

    const tabelaExiste = await TabelaPreco.findOne({ nome: nome.trim() });

    if (tabelaExiste) {
      return res.status(400).json({
        message: "Já existe uma tabela com esse nome",
      });
    }

    const tabela = await TabelaPreco.create({
      nome: nome.trim(),
      descricao: descricao?.trim(),
      tipo: tipo ?? "distribuidor",
    });

    return res.status(201).json(tabela);
  } catch (error) {
    return sendServerError(res);
  }
};
export const listarTabelas = async (req, res) => {
  try {
    const tabelasRaw = await measureStage(req, "query.tabelas", () =>
      TabelaPreco.find().sort({ createdAt: -1 }).lean()
    );
    const tabelas = measureStageSync(req, "process.tabelas", () =>
      tabelasRaw.map((tabela) => ({
        ...tabela,
        tipo: tabela.tipo ?? "distribuidor",
        ativa: tabela.ativa ?? true,
      }))
    );

    return measureStageSync(req, "response.tabelas", () =>
      res.status(200).json(tabelas)
    );
  } catch (error) {
    return sendServerError(res);
  }
};

export const atualizarTabela = async (req, res) => {
  try {
    const { nome, descricao, tipo, ativa } = req.body;

    if (
      !isOptionalString(nome, 120) ||
      !isOptionalString(descricao, 500) ||
      (tipo !== undefined && !tiposTabelaPermitidos.has(tipo))
    ) {
      return res.status(400).json({
        message: "Dados da tabela inválidos",
      });
    }

    const tabela = await TabelaPreco.findById(req.params.id);

    if (!tabela) {
      return res.status(404).json({
        message: "Tabela não encontrada",
      });
    }

    tabela.nome = nome?.trim() ?? tabela.nome;
    tabela.descricao = descricao?.trim() ?? tabela.descricao;
    tabela.tipo = tipo ?? tabela.tipo;

    if (ativa !== undefined) {
      tabela.ativa = ativa === true || ativa === "true";
    }

    await tabela.save();

    return res.status(200).json({
      message: "Tabela atualizada com sucesso",
      tabela,
    });
  } catch (error) {
    return sendServerError(res);
  }
};

export const duplicarTabela = async (req, res) => {
  try {
    const { novoNome, descricao, tipo } = req.body;

    if (
      !isNonEmptyString(novoNome, 120) ||
      !isOptionalString(descricao, 500) ||
      (tipo !== undefined && !tiposTabelaPermitidos.has(tipo))
    ) {
      return res.status(400).json({
        message: "Dados da tabela inválidos",
      });
    }

    const tabelaOrigem = await TabelaPreco.findById(req.params.id);

    if (!tabelaOrigem) {
      return res.status(404).json({
        message: "Tabela de origem não encontrada",
      });
    }

    const nomeExiste = await TabelaPreco.findOne({ nome: novoNome.trim() });

    if (nomeExiste) {
      return res.status(400).json({
        message: "Já existe uma tabela com esse nome",
      });
    }

    const novaTabela = await TabelaPreco.create({
      nome: novoNome.trim(),
      descricao: descricao?.trim() || `Cópia de ${tabelaOrigem.nome}`,
      tipo: tipo ?? tabelaOrigem.tipo ?? "distribuidor",
      ativa: true,
    });

    const precosOriginais = await PrecoProduto.find({
      tabelaPrecoId: tabelaOrigem._id,
    });

    const novosPrecos = precosOriginais.map((preco) => ({
      produtoId: preco.produtoId,
      tabelaPrecoId: novaTabela._id,
      valor: preco.valor,
    }));

    if (novosPrecos.length > 0) {
      await PrecoProduto.insertMany(novosPrecos);
    }

    return res.status(201).json({
      message: "Tabela duplicada com sucesso",
      tabela: novaTabela,
      precosCopiados: novosPrecos.length,
    });
  } catch (error) {
    return sendServerError(res);
  }
};
