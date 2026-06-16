import Usuario from "../models/Usuario.js";

export const listarClientesPendentes = async (req, res) => {
  try {
    const clientes = await Usuario.find({
      tipo: "cliente",
      statusCadastro: "pendente",
    })
      .select("-senha")
      .populate("tabelaPrecoId");

    res.status(200).json(clientes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const aprovarCliente = async (req, res) => {
  try {
    const { tabelaPrecoId } = req.body;

    if (!tabelaPrecoId) {
      return res.status(400).json({
        message: "Informe a tabela de preço do cliente",
      });
    }

    const cliente = await Usuario.findById(req.params.id);

    if (!cliente) {
      return res.status(404).json({ message: "Cliente não encontrado" });
    }

    cliente.statusCadastro = "aprovado";
    cliente.tabelaPrecoId = tabelaPrecoId;

    await cliente.save();

    await cliente.populate("tabelaPrecoId");

    res.status(200).json({
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
    res.status(500).json({ error: error.message });
  }
};