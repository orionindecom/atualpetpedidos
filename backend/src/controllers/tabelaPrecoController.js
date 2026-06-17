import TabelaPreco from "../models/TabelaPreco.js";
import PrecoProduto from "../models/PrecoProduto.js";

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
    res.status(500).json({ error: error.message });
  }
};

export const listarTabelas = async (req, res) => {
  try {
    const tabelas = await TabelaPreco.find().sort({ createdAt: -1 });

    res.status(200).json(tabelas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const atualizarTabela = async (req, res) => {
  try {
    const { nome, descricao, ativa } = req.body;

    const tabela = await TabelaPreco.findById(req.params.id);

    if (!tabela) {
      return res.status(404).json({
        message: "Tabela não encontrada",
      });
    }

    tabela.nome = nome ?? tabela.nome;
    tabela.descricao = descricao ?? tabela.descricao;

    if (ativa !== undefined) {
      tabela.ativa = ativa;
    }

    await tabela.save();

    res.status(200).json({
      message: "Tabela atualizada com sucesso",
      tabela,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const duplicarTabela = async (req, res) => {
  try {
    const { novoNome, descricao } = req.body;

    const tabelaOrigem = await TabelaPreco.findById(req.params.id);

    if (!tabelaOrigem) {
      return res.status(404).json({
        message: "Tabela de origem não encontrada",
      });
    }

    const nomeExiste = await TabelaPreco.findOne({ nome: novoNome });

    if (nomeExiste) {
      return res.status(400).json({
        message: "Já existe uma tabela com esse nome",
      });
    }

    const novaTabela = await TabelaPreco.create({
      nome: novoNome,
      descricao: descricao || `Cópia de ${tabelaOrigem.nome}`,
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

    res.status(201).json({
      message: "Tabela duplicada com sucesso",
      tabela: novaTabela,
      precosCopiados: novosPrecos.length,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};