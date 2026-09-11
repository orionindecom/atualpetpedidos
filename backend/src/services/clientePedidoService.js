import Usuario from "../models/Usuario.js";
import TabelaPreco from "../models/TabelaPreco.js";
import { cadastroClienteBloqueiaAcesso } from "../utils/userAccess.js";
import { isValidObjectId } from "../utils/validation.js";

export class ClientePedidoError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

// A identidade do comprador é independente da identidade de quem lança o pedido.
export const obterClientePedido = async (clienteId) => {
  if (!isValidObjectId(clienteId)) {
    throw new ClientePedidoError("Selecione um distribuidor válido");
  }
  const cliente = await Usuario.findById(clienteId)
    .select("_id tipo ativo statusCadastro tabelaPrecoId nomeResponsavel nomeFantasia razaoSocial cnpj email telefone whatsapp")
    .maxTimeMS(5000);
  if (!cliente || cliente.tipo !== "cliente") {
    throw new ClientePedidoError("Distribuidor não encontrado", 404);
  }
  if (!cliente.ativo || cadastroClienteBloqueiaAcesso(cliente)) {
    throw new ClientePedidoError("O distribuidor precisa estar ativo e aprovado");
  }
  if (!cliente.tabelaPrecoId) {
    throw new ClientePedidoError("Cliente sem tabela de preço vinculada");
  }
  const tabela = await TabelaPreco.findById(cliente.tabelaPrecoId)
    .select("nome ativa").maxTimeMS(3000);
  if (!tabela?.ativa) {
    throw new ClientePedidoError("Tabela de preço indisponível");
  }
  return { cliente, tabela };
};
