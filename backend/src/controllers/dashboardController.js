import Pedido from "../models/Pedido.js";
import Produto from "../models/Produto.js";
import Usuario from "../models/Usuario.js";
import TabelaPreco from "../models/TabelaPreco.js";
import { measureStage, measureStageSync } from "../utils/performance.js";
import { sendServerError } from "../utils/validation.js";

export const executarConsultasEmLotes = async (consultas, tamanhoLote = 2) => {
    const resultados = [];

    for (let indice = 0; indice < consultas.length; indice += tamanhoLote) {
        resultados.push(
            ...await Promise.all(
                consultas.slice(indice, indice + tamanhoLote).map((consulta) =>
                    consulta()
                )
            )
        );
    }

    return resultados;
};

export const resumoDashboard = async (req, res) => {
    try {
        const agora = new Date();

        const inicioMes = new Date(
            agora.getFullYear(),
            agora.getMonth(),
            1
        );

        const fimMes = new Date(
            agora.getFullYear(),
            agora.getMonth() + 1,
            0,
            23,
            59,
            59
        );

        const consultas = [
            () => measureStage(req, "query.dashboard_pedidos_mes", () =>
                Pedido.countDocuments({
                    createdAt: { $gte: inicioMes, $lte: fimMes },
                })
            ),
            () => measureStage(req, "query.dashboard_faturamento", () =>
                Pedido.aggregate([
                    {
                        $match: {
                            createdAt: { $gte: inicioMes, $lte: fimMes },
                            status: { $ne: "cancelado" },
                        },
                    },
                    { $group: { _id: null, total: { $sum: "$valorTotal" } } },
                ])
            ),
            () => measureStage(req, "query.dashboard_pedidos_novos", () =>
                Pedido.countDocuments({ status: "novo" })
            ),
            () => measureStage(req, "query.dashboard_clientes_pendentes", () =>
                Usuario.countDocuments({
                    tipo: "cliente",
                    statusCadastro: "pendente",
                })
            ),
            () => measureStage(req, "query.dashboard_clientes_ativos", () =>
                Usuario.countDocuments({
                    tipo: "cliente",
                    statusCadastro: "aprovado",
                    ativo: true,
                })
            ),
            () => measureStage(req, "query.dashboard_produtos_ativos", () =>
                Produto.countDocuments({ ativo: true })
            ),
            () => measureStage(req, "query.dashboard_tabelas_ativas", () =>
                TabelaPreco.countDocuments({ ativa: true })
            ),
            () => measureStage(req, "query.dashboard_status", () =>
                Pedido.aggregate([
                    { $group: { _id: "$status", total: { $sum: 1 } } },
                    { $sort: { total: -1 } },
                ])
            ),
            () => measureStage(req, "query.dashboard_ultimos", () =>
                Pedido.find()
                    .sort({ createdAt: -1 })
                    .limit(5)
                    .select(
                        "numeroPedido nomeFantasiaCliente valorTotal status dia mes ano"
                    )
                    .lean()
            ),
            () => measureStage(req, "query.dashboard_top_produtos", () =>
                Pedido.aggregate([
                    { $match: { status: { $ne: "cancelado" } } },
                    { $unwind: "$itens" },
                    {
                        $group: {
                            _id: "$itens.produtoId",
                            quantidade: { $sum: "$itens.quantidade" },
                            faturamento: { $sum: "$itens.subtotal" },
                        },
                    },
                    {
                        $lookup: {
                            from: "produtos",
                            localField: "_id",
                            foreignField: "_id",
                            as: "produto",
                        },
                    },
                    { $unwind: "$produto" },
                    { $sort: { quantidade: -1 } },
                    { $limit: 5 },
                ])
            ),
        ];
        const resultados = await executarConsultasEmLotes(consultas);

        const [
            pedidosMes,
            faturamento,
            pedidosNovos,
            clientesPendentes,
            clientesAtivos,
            produtosAtivos,
            tabelasAtivas,
            pedidosPorStatus,
            ultimosPedidos,
            topProdutos,
        ] = resultados;
        return measureStageSync(req, "response.dashboard", () => res.status(200).json({
            pedidosMes,
            faturamentoMes: faturamento[0]?.total || 0,
            pedidosNovos,
            clientesPendentes,
            clientesAtivos,
            produtosAtivos,
            tabelasAtivas,
            pedidosPorStatus: pedidosPorStatus.map((item) => ({
                status: item._id,
                total: item.total,
            })),
            ultimosPedidos,
            topProdutos: topProdutos.map((item) => ({
                produtoId: item._id,
                produto: item.produto.nome,
                quantidade: item.quantidade,
                faturamento: item.faturamento,
            })),
        }));
    } catch (error) {
        sendServerError(res);
    }
};
