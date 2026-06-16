import PrecoProduto from "../models/PrecoProduto.js";

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
    res.status(500).json({
      error: error.message,
    });
  }
};