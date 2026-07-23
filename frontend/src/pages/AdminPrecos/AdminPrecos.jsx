import { useEffect, useState } from "react";
import api from "../../api/axios";
import { FilterToolbar } from "../../components/ListControls/ListControls";
import Navbar from "../../components/Navbar/Navbar";
import styles from "./AdminPrecos.module.css";

function AdminPrecos() {
    const [tabelas, setTabelas] = useState([]);
    const [produtos, setProdutos] = useState([]);
    const [precos, setPrecos] = useState({});
    const [tabelaSelecionada, setTabelaSelecionada] = useState("");
    const [tipoTabelaFiltro, setTipoTabelaFiltro] = useState("");
    const [busca, setBusca] = useState("");
    const [linhaFiltro, setLinhaFiltro] = useState("");
    const [categoriaFiltro, setCategoriaFiltro] = useState("");

    useEffect(() => {
        async function carregarDados() {
            const [tabelasResponse, produtosResponse] = await Promise.all([
                api.get("/tabelas"),
                api.get("/produtos"),
            ]);

            setTabelas(tabelasResponse.data);
            setProdutos(produtosResponse.data);
        }

        carregarDados();
    }, []);

    const carregarPrecosTabela = async (tabelaId) => {
        setTabelaSelecionada(tabelaId);

        if (!tabelaId) {
            setPrecos({});
            return;
        }

        const response = await api.get(`/precos/tabela/${tabelaId}`);

        const mapaPrecos = {};

        response.data.forEach((item) => {
            mapaPrecos[item.produtoId._id] = item.valor;
        });

        setPrecos(mapaPrecos);
    };

    const alterarPreco = (produtoId, valor) => {
        setPrecos({
            ...precos,
            [produtoId]: valor,
        });
    };

    const salvarPreco = async (produtoId) => {
        if (!tabelaSelecionada) {
            alert("Selecione uma tabela");
            return;
        }

        const valor = Number(precos[produtoId]);

        if (!valor || valor <= 0) {
            alert("Informe um valor válido");
            return;
        }

        await api.post("/precos", {
            produtoId,
            tabelaPrecoId: tabelaSelecionada,
            valor,
        });

        alert("Preço salvo com sucesso");
    };

    const linhas = [...new Set(produtos.map((p) => p.linha).filter(Boolean))];

    const categorias = [
        ...new Set(produtos.map((p) => p.categoria).filter(Boolean)),
    ];

    const produtosFiltrados = produtos.filter((produto) => {
        const combinaBusca = produto.nome
            .toLowerCase()
            .includes(busca.toLowerCase());

        const combinaLinha = linhaFiltro
            ? produto.linha === linhaFiltro
            : true;

        const combinaCategoria = categoriaFiltro
            ? produto.categoria === categoriaFiltro
            : true;

        return combinaBusca && combinaLinha && combinaCategoria;
    });

    const tiposTabela = {
        distribuidor: "Distribuidor",
        cliente_final_internet: "Cliente final internet",
        cliente_final_loja: "Cliente final loja física",
    };

    const tabelasFiltradas = tabelas.filter((tabela) =>
        tipoTabelaFiltro ? tabela.tipo === tipoTabelaFiltro : true
    );

    const tabelaAtual = tabelas.find(
        (tabela) => tabela._id === tabelaSelecionada
    );

    const limparFiltros = () => {
        setBusca("");
        setLinhaFiltro("");
        setCategoriaFiltro("");
        setTipoTabelaFiltro("");
        setTabelaSelecionada("");
        setPrecos({});
    };

    return (
        <>
            <Navbar />

            <div className={styles.container}>
                <h1>Preços por Tabela</h1>

                <FilterToolbar
                    activeFilterCount={[
                        tipoTabelaFiltro,
                        tabelaSelecionada,
                        linhaFiltro,
                        categoriaFiltro,
                    ].filter(Boolean).length}
                    layout="stacked"
                    searchLabel="Buscar produtos da tabela"
                    searchPlaceholder="Buscar por produto, linha ou categoria..."
                    searchValue={busca}
                    onSearchChange={(event) => setBusca(event.target.value)}
                    onSubmit={(event) => event.preventDefault()}
                    onClear={limparFiltros}
                >
                    <select
                        aria-label="Filtrar por tipo de tabela"
                        value={tipoTabelaFiltro}
                        onChange={(e) => {
                            setTipoTabelaFiltro(e.target.value);
                            setTabelaSelecionada("");
                            setPrecos({});
                        }}
                    >
                        <option value="">Todos os tipos de tabela</option>
                        <option value="distribuidor">Distribuidor</option>
                        <option value="cliente_final_internet">
                            Cliente final internet
                        </option>
                        <option value="cliente_final_loja">
                            Cliente final loja física
                        </option>
                    </select>

                    <select
                        aria-label="Selecionar tabela de preço"
                        value={tabelaSelecionada}
                        onChange={(e) => carregarPrecosTabela(e.target.value)}
                    >
                        <option value="">Selecione uma tabela</option>

                        {tabelasFiltradas.map((tabela) => (
                            <option key={tabela._id} value={tabela._id}>
                                {tabela.nome} •{" "}
                                {tiposTabela[tabela.tipo || "distribuidor"]}
                            </option>
                        ))}
                    </select>
                    <select
                        aria-label="Filtrar por linha"
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
                        aria-label="Filtrar por categoria"
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
                </FilterToolbar>

                {tabelaAtual && (
                    <div className={styles.tabelaAtual}>
                        <span>
                            {tiposTabela[tabelaAtual.tipo || "distribuidor"]}
                        </span>
                        <strong>{tabelaAtual.nome}</strong>
                    </div>
                )}

                {tabelaSelecionada && (
                    <div className={styles.lista}>
                        {produtosFiltrados.map((produto) => (
                            <div className={styles.card} key={produto._id}>
                                <div className={styles.produto}>
                                    {produto.fotoUrl && (
                                        <img
                                            src={produto.fotoUrl}
                                            alt={produto.nome}
                                        />
                                    )}

                                    <div>
                                        <h3>{produto.nome}</h3>
                                        <p>{produto.linha} • {produto.categoria}</p>
                                    </div>
                                </div>

                                <div className={styles.precoBox}>
                                    <input
                                        type="number"
                                        step="0.01"
                                        placeholder="Preço"
                                        value={precos[produto._id] || ""}
                                        onChange={(e) =>
                                            alterarPreco(produto._id, e.target.value)
                                        }
                                    />

                                    <button onClick={() => salvarPreco(produto._id)}>
                                        Salvar
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
}

export default AdminPrecos;
