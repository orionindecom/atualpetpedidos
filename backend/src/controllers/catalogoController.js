import PrecoProduto from "../models/PrecoProduto.js";
import TabelaPreco from "../models/TabelaPreco.js";
import { sendServerError } from "../utils/validation.js";

const PAGINA_PADRAO = 1;
const LIMITE_PADRAO = 12;
const LIMITE_MAXIMO = 48;
const CONSULTA_MAX_LENGTH = 120;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parsePositiveInteger = (value, fallback) => {
  if (value === undefined) {
    return fallback;
  }

  if (!/^\d+$/.test(String(value))) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export const parseCatalogQuery = (query = {}) => {
  const pagina = parsePositiveInteger(query.pagina, PAGINA_PADRAO);
  const limite = parsePositiveInteger(query.limite, LIMITE_PADRAO);
  const busca = typeof query.busca === "string" ? query.busca.trim() : "";
  const linha = typeof query.linha === "string" ? query.linha.trim() : "";
  const categoria = typeof query.categoria === "string"
    ? query.categoria.trim()
    : "";

  if (
    pagina === null ||
    limite === null ||
    limite > LIMITE_MAXIMO ||
    busca.length > CONSULTA_MAX_LENGTH ||
    linha.length > CONSULTA_MAX_LENGTH ||
    categoria.length > CONSULTA_MAX_LENGTH
  ) {
    return null;
  }

  return { pagina, limite, busca, linha, categoria };
};

export const isLegacyCatalogRequest = (query = {}) =>
  query.pagina === undefined && query.limite === undefined;

export const formatCatalogResponse = ({
  legacy,
  produtos,
  paginacao,
  filtros,
}) => (legacy ? produtos : { produtos, paginacao, filtros });

const tiposClienteFinalPermitidos = new Set([
  "cliente_final_internet",
  "cliente_final_loja",
]);

export const listarCatalogoCliente = async (req, res) => {
  try {
    const usuario = req.usuario;
    const consulta = parseCatalogQuery(req.query);
    const legacy = isLegacyCatalogRequest(req.query);

    if (!consulta) {
      return res.status(400).json({
        message: "Parâmetros de paginação ou filtro inválidos",
      });
    }

    if (!usuario.tabelaPrecoId) {
      return res.status(400).json({
        message: "Cliente sem tabela de preço vinculada",
      });
    }

    const filtroProduto = {};

    if (consulta.busca) {
      filtroProduto["produto.nome"] = {
        $regex: escapeRegex(consulta.busca),
        $options: "i",
      };
    }

    if (consulta.linha) {
      filtroProduto["produto.linha"] = consulta.linha;
    }

    if (consulta.categoria) {
      filtroProduto["produto.categoria"] = consulta.categoria;
    }

    const inicio = (consulta.pagina - 1) * consulta.limite;
    const produtosPipeline = [
      { $match: filtroProduto },
      {
        $sort: {
          "produto.linha": 1,
          "produto.categoria": 1,
          "produto.nome": 1,
          _id: 1,
        },
      },
      ...(legacy ? [] : [{ $skip: inicio }, { $limit: consulta.limite }]),
      {
        $project: {
          _id: 0,
          id: "$produto._id",
          nome: "$produto.nome",
          descricao: "$produto.descricao",
          linha: "$produto.linha",
          categoria: "$produto.categoria",
          fotoUrl: "$produto.fotoUrl",
          preco: "$valor",
        },
      },
    ];
    const pipeline = [
      {
        $match: {
          tabelaPrecoId: usuario.tabelaPrecoId,
        },
      },
      {
        $lookup: {
          from: "produtos",
          localField: "produtoId",
          foreignField: "_id",
          as: "produto",
        },
      },
      { $unwind: "$produto" },
      { $match: { "produto.ativo": true } },
      {
        $facet: {
          produtos: produtosPipeline,
          total: [
            { $match: filtroProduto },
            { $count: "quantidade" },
          ],
          linhas: [
            { $match: { "produto.linha": { $type: "string", $ne: "" } } },
            { $group: { _id: "$produto.linha" } },
            { $sort: { _id: 1 } },
          ],
          categorias: [
            {
              $match: {
                "produto.categoria": { $type: "string", $ne: "" },
              },
            },
            { $group: { _id: "$produto.categoria" } },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ];

    const [resultadoAgregacao, tabela] = await Promise.all([
      PrecoProduto.aggregate(pipeline).option({
        allowDiskUse: true,
        maxTimeMS: 5000,
      }),
      TabelaPreco.findById(usuario.tabelaPrecoId)
        .select("nome")
        .lean()
        .maxTimeMS(3000),
    ]);

    const resultado = resultadoAgregacao[0] || {};
    const total = resultado.total?.[0]?.quantidade || 0;
    const produtos = (resultado.produtos || []).map((produto) => ({
      ...produto,
      tabela: tabela?.nome || "",
    }));
    const totalPaginas = Math.ceil(total / consulta.limite);

    const paginacao = {
      pagina: consulta.pagina,
      limite: consulta.limite,
      total,
      totalPaginas,
      temMais: consulta.pagina < totalPaginas,
    };
    const filtros = {
      linhas: (resultado.linhas || []).map((item) => item._id),
      categorias: (resultado.categorias || []).map((item) => item._id),
    };

    return res.status(200).json(formatCatalogResponse({
      legacy,
      produtos,
      paginacao,
      filtros,
    }));
  } catch (error) {
    return sendServerError(res);
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
