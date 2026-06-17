import { useEffect, useState } from "react";
import api from "../../api/axios";
import Navbar from "../../components/Navbar/Navbar";
import styles from "./AdminPedidos.module.css";

function AdminPedidos() {
    const [pedidos, setPedidos] = useState([]);
    const [statusSelecionado, setStatusSelecionado] = useState({});
    const [busca, setBusca] = useState("");
    const [statusFiltro, setStatusFiltro] = useState("");

    const statusOptions = [
        "novo",
        "em_analise",
        "separando",
        "faturado",
        "enviado",
        "entregue",
        "cancelado",
    ];

    const carregarPedidos = async () => {
        const response = await api.get("/pedidos");
        setPedidos(response.data);
    };

    useEffect(() => {
        carregarPedidos();
    }, []);

    const moeda = (valor) =>
        valor.toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
        });

    const data = (pedido) => {
        const dia = String(pedido.dia).padStart(2, "0");
        const mes = String(pedido.mes).padStart(2, "0");
        return `${dia}/${mes}/${pedido.ano}`;
    };

    const baixarPdf = async (pedidoId) => {
        try {
            const response = await api.get(`/pedidos/${pedidoId}/pdf`, {
                responseType: "blob",
            });

            const fileURL = window.URL.createObjectURL(
                new Blob([response.data], { type: "application/pdf" })
            );

            window.open(fileURL, "_blank");
        } catch (error) {
            console.error(error);
            alert("Erro ao baixar PDF");
        }
    };

    const alterarStatus = async (pedidoId, status) => {
        try {
            await api.put(`/pedidos/${pedidoId}/status`, {
                status,
            });

            carregarPedidos();
        } catch (error) {
            console.error(error);
            alert("Erro ao atualizar status");
        }
    };

    const formatarStatus = (status) => {
        const nomes = {
            novo: "Novo",
            em_analise: "Em análise",
            separando: "Separando",
            faturado: "Faturado",
            enviado: "Enviado",
            entregue: "Entregue",
            cancelado: "Cancelado",
        };

        return nomes[status] || status;
    };
    const pedidosFiltrados = pedidos.filter((pedido) => {
        const textoBusca = busca.toLowerCase();

        const combinaBusca =
            pedido.numeroPedido?.toLowerCase().includes(textoBusca) ||
            pedido.nomeFantasiaCliente?.toLowerCase().includes(textoBusca) ||
            pedido.razaoSocialCliente?.toLowerCase().includes(textoBusca);

        const combinaStatus = statusFiltro
            ? pedido.status === statusFiltro
            : true;

        return combinaBusca && combinaStatus;
    });
    return (
        <>
            <Navbar />

            <div className={styles.container}>
                <h1>Pedidos</h1>

                {pedidos.length === 0 && <p>Nenhum pedido encontrado.</p>}

                <div className={styles.filtros}>
                    <input
                        type="text"
                        placeholder="Buscar pedido ou cliente..."
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                    />

                    <select
                        value={statusFiltro}
                        onChange={(e) => setStatusFiltro(e.target.value)}
                    >
                        <option value="">Todos os status</option>

                        {statusOptions.map((status) => (
                            <option key={status} value={status}>
                                {formatarStatus(status)}
                            </option>
                        ))}
                    </select>
                </div>

                <div className={styles.lista}>
                    {pedidosFiltrados.map((pedido) => (
                        <div className={styles.card} key={pedido._id}>
                            <div>
                                <h3>{pedido.numeroPedido}</h3>
                                <p>Cliente: {pedido.nomeFantasiaCliente || "-"}</p>
                                <p>Razão Social: {pedido.razaoSocialCliente || "-"}</p>
                                <p>CNPJ: {pedido.cnpjCliente || "-"}</p>
                                <p>Data: {data(pedido)}</p>

                                <div className={styles.statusBox}>
                                    <label>Status:</label>

                                    <select
                                        value={statusSelecionado[pedido._id] || pedido.status}
                                        onChange={(e) =>
                                            setStatusSelecionado({
                                                ...statusSelecionado,
                                                [pedido._id]: e.target.value,
                                            })
                                        }
                                    >
                                        {statusOptions.map((status) => (
                                            <option key={status} value={status}>
                                                {formatarStatus(status)}
                                            </option>
                                        ))}
                                    </select>

                                    <button
                                        onClick={() =>
                                            alterarStatus(
                                                pedido._id,
                                                statusSelecionado[pedido._id] || pedido.status
                                            )
                                        }
                                    >
                                        Salvar Status
                                    </button>
                                </div>

                                <strong>Total: {moeda(pedido.valorTotal)}</strong>
                            </div>

                            <button onClick={() => baixarPdf(pedido._id)}>
                                Baixar PDF
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
}

export default AdminPedidos;