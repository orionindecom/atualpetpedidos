import { useEffect, useState } from "react";
import api from "../../api/axios";
import styles from "./Catalogo.module.css";
import Navbar from "../../components/Navbar/Navbar";

function Catalogo() {
    const [produtos, setProdutos] = useState([]);
    const [quantidades, setQuantidades] = useState({});
    const [pedidoCriado, setPedidoCriado] = useState(null);

    const [busca, setBusca] = useState("");
    const [linhaFiltro, setLinhaFiltro] = useState("");
    const [categoriaFiltro, setCategoriaFiltro] = useState("");

    useEffect(() => {
        async function carregarCatalogo() {
            const response = await api.get("/catalogo");
            setProdutos(response.data);
        }

        carregarCatalogo();
    }, []);

    const moeda = (valor) =>
        valor.toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
        });

    const alterarQuantidade = (produtoId, quantidade) => {
        setQuantidades({
            ...quantidades,
            [produtoId]: quantidade,
        });
    };

    const linhas = [...new Set(produtos.map((p) => p.linha).filter(Boolean))];
    const categorias = [
        ...new Set(produtos.map((p) => p.categoria).filter(Boolean)),
    ];

    const produtosFiltrados = produtos.filter((produto) => {
        const combinaBusca = produto.nome
            .toLowerCase()
            .includes(busca.toLowerCase());

        const combinaLinha = linhaFiltro ? produto.linha === linhaFiltro : true;

        const combinaCategoria = categoriaFiltro
            ? produto.categoria === categoriaFiltro
            : true;

        return combinaBusca && combinaLinha && combinaCategoria;
    });

    const itensSelecionados = produtos.filter(
        (produto) => Number(quantidades[produto.id]) > 0
    );

    const totalPedido = itensSelecionados.reduce(
        (total, produto) =>
            total + produto.preco * Number(quantidades[produto.id]),
        0
    );

    const gerarPedido = async () => {
        const itens = Object.entries(quantidades)
            .filter(([_, quantidade]) => Number(quantidade) > 0)
            .map(([produtoId, quantidade]) => ({
                produtoId,
                quantidade: Number(quantidade),
            }));

        if (itens.length === 0) {
            alert("Informe pelo menos um produto");
            return;
        }

        const response = await api.post("/pedidos", {
            itens,
            observacao: "",
        });

        setPedidoCriado(response.data.pedido);
        setQuantidades({});
        alert(`Pedido criado: ${response.data.pedido.numeroPedido}`);
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

    return (
        <>
            <Navbar />

            <div className={styles.container}>
                <div className={styles.header}>
                    <h1>Catálogo AtualPet</h1>
                    <p>Informe as quantidades desejadas e gere seu pedido.</p>
                </div>

                <div className={styles.filtros}>
                    <input
                        type="text"
                        placeholder="Buscar produto..."
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                    />

                    <select
                        value={linhaFiltro}
                        onChange={(e) => setLinhaFiltro(e.target.value)}
                    >
                        <option value="">Todas as linhas</option>

                        {linhas.map((linha) => (
                            <option key={linha} value={linha}>
                                {linha}
                            </option>
                        ))}
                    </select>

                    <select
                        value={categoriaFiltro}
                        onChange={(e) => setCategoriaFiltro(e.target.value)}
                    >
                        <option value="">Todas as categorias</option>

                        {categorias.map((categoria) => (
                            <option key={categoria} value={categoria}>
                                {categoria}
                            </option>
                        ))}
                    </select>
                </div>

                <div className={styles.layout}>
                    <div className={styles.grid}>
                        {produtosFiltrados.map((produto) => (
                            <div className={styles.card} key={produto.id}>
                                {produto.fotoUrl && (
                                    <img
                                        src={`http://localhost:5000${produto.fotoUrl}`}
                                        alt={produto.nome}
                                    />
                                )}

                                <h3>{produto.nome}</h3>
                                <p className={styles.descricao}>{produto.descricao}</p>
                                <p className={styles.tags}>
                                    {produto.linha} • {produto.categoria}
                                </p>

                                <p className={styles.preco}>{moeda(produto.preco)}</p>

                                <div className={styles.quantidadeBox}>
                                    <label>Quantidade</label>

                                    <input
                                        className={styles.input}
                                        type="number"
                                        min="0"
                                        placeholder="0"
                                        value={quantidades[produto.id] || ""}
                                        onChange={(e) =>
                                            alterarQuantidade(produto.id, e.target.value)
                                        }
                                    />
                                </div>
                            </div>
                        ))}
                    </div>

                    <aside className={styles.resumo}>
                        <h2>Pedido Atual</h2>

                        {itensSelecionados.length === 0 ? (
                            <p className={styles.vazio}>Nenhum item selecionado.</p>
                        ) : (
                            <>
                                <div className={styles.listaResumo}>
                                    {itensSelecionados.map((produto) => (
                                        <div key={produto.id} className={styles.itemResumo}>
                                            <div>
                                                <span>{produto.nome}</span>

                                                <small>
                                                    {quantidades[produto.id]} x {moeda(produto.preco)}
                                                </small>

                                                <small>
                                                    Subtotal:{" "}
                                                    {moeda(
                                                        produto.preco * Number(quantidades[produto.id])
                                                    )}
                                                </small>
                                            </div>

                                            <strong>x{quantidades[produto.id]}</strong>
                                        </div>
                                    ))}
                                </div>

                                <div className={styles.totalResumo}>
                                    <span>Total</span>
                                    <strong>{moeda(totalPedido)}</strong>
                                </div>

                                <button
                                    className={styles.botao}
                                    onClick={gerarPedido}
                                    disabled={itensSelecionados.length === 0}
                                >
                                    Gerar Pedido
                                </button>
                            </>
                        )}

                        {pedidoCriado && (
                            <div className={styles.sucesso}>
                                <h3>Pedido criado!</h3>
                                <p>{pedidoCriado.numeroPedido}</p>

                                <button
                                    className={styles.botao}
                                    onClick={() => baixarPdf(pedidoCriado._id)}
                                >
                                    Baixar PDF
                                </button>
                            </div>
                        )}
                    </aside>
                </div>
            </div>
        </>
    );
}

export default Catalogo;