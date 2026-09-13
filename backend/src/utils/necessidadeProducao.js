import { getItemSeparation, pedidoPossuiEntregaConfirmada } from "./pedidoLogistica.js";
import { extrairMarcosPedido } from "../services/pedidoMetricasService.js";

// Pré-filtro de pedidos ainda abertos, antes de faturar. Não comprova início.
export const STATUS_NECESSIDADE_PRODUCAO = Object.freeze([
  "aprovado", "novo", "em_analise", "separando", "separado",
]);

const separacaoIniciada = (pedido) => (
  // A ação Iniciar separação avança para separando e registra historicoStatus.
  // A etapa atual também preserva pedidos legados sem histórico completo.
  ["separando", "separado"].includes(pedido.status) ||
  Boolean(extrairMarcosPedido(pedido).separationStartAt)
);

export const calcularNecessidadeProducao = (pedidos = []) => {
  const produtosPorId = new Map();
  const pedidosPendentes = [];

  for (const pedido of pedidos) {
    if (!STATUS_NECESSIDADE_PRODUCAO.includes(pedido.status) || pedidoPossuiEntregaConfirmada(pedido)) continue;
    if (!separacaoIniciada(pedido)) continue;
    const itens = (pedido.itens || []).flatMap((item) => {
      const atendimento = getItemSeparation(item);
      // O zero inicial ainda está pendente; demanda exige uma separação registrada.
      if (atendimento.situacaoSeparacao === "pendente") return [];
      // A demanda existente considera o atendimento final, quando já conferido.
      const quantidadeFaltante = Math.max(
        atendimento.quantidadeSolicitada - atendimento.quantidadeAtendida, 0
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
        quantidadeAtendida: atendimento.quantidadeAtendida,
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
