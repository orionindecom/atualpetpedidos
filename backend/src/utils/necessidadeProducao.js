import { getItemSeparation, pedidoPossuiEntregaConfirmada } from "./pedidoLogistica.js";

// A necessidade acompanha exclusivamente a etapa atual de separação.
// Enviado, retirado e demais estados posteriores não mantêm faltas em aberto,
// mesmo com quantidades de separação antigas, ausentes ou incompletas.
export const STATUS_NECESSIDADE_PRODUCAO = Object.freeze([
  "separando",
]);

export const calcularNecessidadeProducao = (pedidos = []) => {
  const produtosPorId = new Map();
  const pedidosPendentes = [];

  for (const pedido of pedidos) {
    // O registro de conclusão também protege pedidos com status inconsistente.
    if (!STATUS_NECESSIDADE_PRODUCAO.includes(pedido.status) || pedidoPossuiEntregaConfirmada(pedido)) continue;
    const itens = (pedido.itens || []).flatMap((item) => {
      const atendimento = getItemSeparation(item);
      // Ausência de registro equivale a zero somente neste relatório.
      const quantidadeSeparada = atendimento.quantidadeSeparada ?? 0;
      const quantidadeFaltante = Math.max(
        atendimento.quantidadeSolicitada - quantidadeSeparada, 0
      );
      if (!(quantidadeFaltante > 0)) return [];
      const produtoId = String(item.produtoId);
      let produto = produtosPorId.get(produtoId);
      if (!produto) {
        produto = { produtoId, nomeProduto: item.nomeProduto, quantidadeFaltante: 0, pedidos: new Set() };
        produtosPorId.set(produtoId, produto);
      }
      produto.quantidadeFaltante += quantidadeFaltante;
      produto.pedidos.add(String(pedido._id));
      return [{
        produtoId,
        nomeProduto: item.nomeProduto,
        quantidadeSolicitada: atendimento.quantidadeSolicitada,
        quantidadeAtendida: quantidadeSeparada,
        quantidadeFaltante,
      }];
    });
    if (itens.length === 0) continue;
    pedidosPendentes.push({
      _id: pedido._id,
      numeroPedido: pedido.numeroPedido,
      clienteId: pedido.clienteId,
      cliente: pedido.nomeFantasiaCliente || pedido.razaoSocialCliente || pedido.nomeResponsavel || "Cliente",
      status: pedido.status,
      createdAt: pedido.createdAt || pedido.dataPedido,
      quantidadeFaltante: itens.reduce((total, item) => total + item.quantidadeFaltante, 0),
      itens: itens.sort((a, b) => b.quantidadeFaltante - a.quantidadeFaltante),
    });
  }

  const produtos = [...produtosPorId.values()].map(({ pedidos: ids, ...produto }) => ({
    ...produto, quantidadePedidos: ids.size,
  })).sort((a, b) => b.quantidadeFaltante - a.quantidadeFaltante || a.nomeProduto.localeCompare(b.nomeProduto, "pt-BR"));
  pedidosPendentes.sort((a, b) => b.quantidadeFaltante - a.quantidadeFaltante || String(a.numeroPedido).localeCompare(String(b.numeroPedido)));
  return {
    produtos,
    pedidos: pedidosPendentes,
    resumo: {
      quantidadePedidos: pedidosPendentes.length,
      quantidadeProdutos: produtos.length,
      quantidadeFaltante: produtos.reduce((total, produto) => total + produto.quantidadeFaltante, 0),
    },
  };
};
