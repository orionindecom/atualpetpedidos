import Usuario from "../models/Usuario.js";
import { listarCatalogoCliente } from "./catalogoController.js";
import { ClientePedidoError, obterClientePedido } from "../services/clientePedidoService.js";
import { sendServerError } from "../utils/validation.js";

export const listarDistribuidoresPedido = async (req, res) => {
  try {
    const clientes = await Usuario.find({
      tipo: "cliente", ativo: true, statusCadastro: "aprovado",
      tabelaPrecoId: { $ne: null },
    })
      .select("_id nomeFantasia razaoSocial nomeResponsavel cnpj tabelaPrecoId")
      .populate({ path: "tabelaPrecoId", select: "nome", match: { ativa: true } })
      .sort({ nomeFantasia: 1, razaoSocial: 1, _id: 1 })
      .lean().maxTimeMS(5000);
    return res.status(200).json(clientes.filter((cliente) => cliente.tabelaPrecoId));
  } catch {
    return sendServerError(res);
  }
};

export const listarCatalogoDistribuidor = async (req, res) => {
  try {
    const { cliente } = await obterClientePedido(req.params.id);
    if (req.query.tabelaPrecoId && String(req.query.tabelaPrecoId) !== String(cliente.tabelaPrecoId)) {
      return res.status(409).json({ message: "A tabela do distribuidor mudou. Selecione-o novamente para revisar os preços." });
    }
    req.clientePedido = cliente;
    return listarCatalogoCliente(req, res);
  } catch (error) {
    if (error instanceof ClientePedidoError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return sendServerError(res);
  }
};
