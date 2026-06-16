import TabelaPreco from "../models/TabelaPreco.js";

export const criarTabela = async (req, res) => {
  try {
    const { nome, descricao } = req.body;

    const tabelaExiste = await TabelaPreco.findOne({ nome });

    if (tabelaExiste) {
      return res.status(400).json({
        message: "Já existe uma tabela com esse nome",
      });
    }

    const tabela = await TabelaPreco.create({
      nome,
      descricao,
    });

    res.status(201).json(tabela);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
};

export const listarTabelas = async (req, res) => {
  try {
    const tabelas = await TabelaPreco.find({
      ativa: true,
    });

    res.status(200).json(tabelas);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
};