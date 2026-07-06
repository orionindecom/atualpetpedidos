import PrecoProduto from "../models/PrecoProduto.js";
import TabelaPreco from "../models/TabelaPreco.js";
import { sendServerError } from "../utils/validation.js";

const tiposClienteFinalPermitidos = new Set([
  "cliente_final_internet",
  "cliente_final_loja",
]);

export const listarCatalogoCliente = async (req, res) => {
  try {
    const usuario = req.usuario;

    if (!usuario.tabelaPrecoId) {
      return res.status(400).json({
        message: "Cliente sem tabela de preço vinculada",
      });
    }

    const catalogo = await PrecoProduto.find({
      tabelaPrecoId: usuario.tabelaPrecoId,
    })
      .populate("produtoId")
      .populate("tabelaPrecoId");

    const produtos = catalogo
      .filter((item) => item.produtoId && item.produtoId.ativo)
      .map((item) => ({
        id: item.produtoId._id,
        nome: item.produtoId.nome,
        descricao: item.produtoId.descricao,
        linha: item.produtoId.linha,
        categoria: item.produtoId.categoria,
        fotoUrl: item.produtoId.fotoUrl,
        preco: item.valor,
        tabela: item.tabelaPrecoId.nome,
      }));

    res.status(200).json(produtos);
  } catch (error) {
    sendServerError(res);
  }
};

export const listarPrecosClienteFinal = async (req, res) => {
  try {
    const tipo = req.query.tipo || "cliente_final_internet";

    if (!tiposClienteFinalPermitidos.has(tipo)) {
      return res.status(400).json({
        message: "Tipo de tabela inválido",
      });
    }

    const tabela = await TabelaPreco.findOne({
      tipo,
      ativa: true,
    }).sort({ updatedAt: -1 });

    if (!tabela) {
      return res.status(200).json({
        tabela: null,
        produtos: [],
      });
    }

    const precos = await PrecoProduto.find({
      tabelaPrecoId: tabela._id,
    }).populate("produtoId");

    const produtos = precos
      .filter((item) => item.produtoId && item.produtoId.ativo)
      .map((item) => ({
        id: item.produtoId._id,
        nome: item.produtoId.nome,
        descricao: item.produtoId.descricao,
        linha: item.produtoId.linha,
        categoria: item.produtoId.categoria,
        fotoUrl: item.produtoId.fotoUrl,
        preco: item.valor,
        tabela: tabela.nome,
        tipoTabela: tabela.tipo,
      }));

    return res.status(200).json({
      tabela: {
        id: tabela._id,
        nome: tabela.nome,
        tipo: tabela.tipo,
      },
      produtos,
    });
  } catch (error) {
    return sendServerError(res);
  }
};
