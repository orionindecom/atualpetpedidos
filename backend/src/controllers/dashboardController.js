import Pedido from "../models/Pedido.js";
import Produto from "../models/Produto.js";
import Usuario from "../models/Usuario.js";
import TabelaPreco from "../models/TabelaPreco.js";
import { sendServerError } from "../utils/validation.js";

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

        const pedidosMes = await Pedido.countDocuments({
            createdAt: {
                $gte: inicioMes,
                $lte: fimMes,
            },
        });

        const faturamento = await Pedido.aggregate([
            {
                $match: {
                    createdAt: {
                        $gte: inicioMes,
                        $lte: fimMes,
                    },
                    status: {
                        $ne: "cancelado",
                    },
                },
            },
            {
                $group: {
                    _id: null,
                    total: {
                        $sum: "$valorTotal",
                    },
                },
            },
        ]);

        const pedidosNovos = await Pedido.countDocuments({
            status: "novo",
        });

        const clientesPendentes = await Usuario.countDocuments({
            tipo: "cliente",
            statusCadastro: "pendente",
        });

        const clientesAtivos = await Usuario.countDocuments({
            tipo: "cliente",
            statusCadastro: "aprovado",
            ativo: true,
        });

        const produtosAtivos = await Produto.countDocuments({
            ativo: true,
        });

        const tabelasAtivas = await TabelaPreco.countDocuments({
            ativa: true,
        });

        const pedidosPorStatus = await Pedido.aggregate([
            {
                $group: {
                    _id: "$status",
                    total: {
                        $sum: 1,
                    },
                },
            },
            {
                $sort: {
                    total: -1,
                },
            },
        ]);

        const ultimosPedidos = await Pedido.find()
            .sort({ createdAt: -1 })
            .limit(5)
            .select(
                "numeroPedido nomeFantasiaCliente valorTotal status dia mes ano"
            );

        const topProdutos = await Pedido.aggregate([
            {
                $match: {
                    status: {
                        $ne: "cancelado",
                    },
                },
            },
            {
                $unwind: "$itens",
            },
            {
                $group: {
                    _id: "$itens.produtoId",
                    quantidade: {
                        $sum: "$itens.quantidade",
                    },
                    faturamento: {
                        $sum: "$itens.subtotal",
                    },
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
            {
                $unwind: "$produto",
            },
            {
                $sort: {
                    quantidade: -1,
                },
            },
            {
                $limit: 5,
            },
        ]);
        res.status(200).json({
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
        });
    } catch (error) {
        sendServerError(res);
    }
};
