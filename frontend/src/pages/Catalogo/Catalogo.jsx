import { useCallback, useEffect, useRef, useState } from "react";
import api from "../../api/axios";
import styles from "./Catalogo.module.css";
import Navbar from "../../components/Navbar/Navbar";
import { abrirOuBaixarPdfPedido } from "../../utils/pdfPedido";
import { normalizeCatalogResponse } from "../../utils/catalogResponse";
import {
    acrescentarProdutosCatalogo,
    criarEstadoCatalogoParaNovoFiltro,
    criarPaginacaoCatalogoInicial,
    substituirProdutosCatalogo,
} from "../../utils/catalogPagination";

const LIMITE_CATALOGO = 12;

function Catalogo() {
    const [produtos, setProdutos] = useState([]);
    const [produtosConhecidos, setProdutosConhecidos] = useState({});
    const [quantidades, setQuantidades] = useState({});
    const [pedidoCriado, setPedidoCriado] = useState(null);

    const [busca, setBusca] = useState("");
    const [buscaAplicada, setBuscaAplicada] = useState("");
    const [linhaFiltro, setLinhaFiltro] = useState("");
    const [categoriaFiltro, setCategoriaFiltro] = useState("");
    const [filtrosDisponiveis, setFiltrosDisponiveis] = useState({
        linhas: [],
        categorias: [],
    });
    const [paginacao, setPaginacao] = useState(criarPaginacaoCatalogoInicial);
    const [carregando, setCarregando] = useState(true);
    const [carregandoMais, setCarregandoMais] = useState(false);
    const [erroCatalogo, setErroCatalogo] = useState("");
    const consultaVersao = useRef(0);
    const requisicaoMais = useRef(null);
    const carregandoMaisRef = useRef(false);

    const reiniciarConsulta = useCallback(() => {
        consultaVersao.current += 1;
        requisicaoMais.current?.abort();
        requisicaoMais.current = null;
        carregandoMaisRef.current = false;

        const estadoInicial = criarEstadoCatalogoParaNovoFiltro();
        setProdutos(estadoInicial.produtos);
        setPaginacao(estadoInicial.paginacao);
        setCarregando(true);
        setCarregandoMais(false);
        setErroCatalogo("");
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            const proximaBusca = busca.trim();

            if (proximaBusca !== buscaAplicada) {
                reiniciarConsulta();
                setBuscaAplicada(proximaBusca);
            }
        }, 300);

        return () => window.clearTimeout(timer);
    }, [busca, buscaAplicada, reiniciarConsulta]);

    useEffect(
        () => () => {
            requisicaoMais.current?.abort();
        },
        []
    );

    useEffect(() => {
        const controller = new AbortController();
        consultaVersao.current += 1;
        const versaoAtual = consultaVersao.current;

        async function carregarCatalogo() {
            setCarregando(true);
            setErroCatalogo("");
            setProdutos([]);

            try {
                const response = await api.get("/catalogo", {
                    params: {
                        pagina: 1,
                        limite: LIMITE_CATALOGO,
                        busca: buscaAplicada || undefined,
                        linha: linhaFiltro || undefined,
                        categoria: categoriaFiltro || undefined,
                    },
                    signal: controller.signal,
                });

                if (versaoAtual !== consultaVersao.current) {
                    return;
                }

                const catalogo = normalizeCatalogResponse(response.data, {
                    pagina: 1,
                    limite: LIMITE_CATALOGO,
                    busca: buscaAplicada,
                    linha: linhaFiltro,
                    categoria: categoriaFiltro,
                });
                const novosProdutos = catalogo.produtos;
                setProdutos(substituirProdutosCatalogo(novosProdutos));
                setProdutosConhecidos((anteriores) => {
                    const atualizados = { ...anteriores };
                    novosProdutos.forEach((produto) => {
                        atualizados[produto.id] = produto;
                    });
                    return atualizados;
                });
                setPaginacao(catalogo.paginacao);
                setFiltrosDisponiveis(catalogo.filtros);
            } catch (error) {
                if (
                    error.code !== "ERR_CANCELED" &&
                    versaoAtual === consultaVersao.current
                ) {
                    setErroCatalogo(
                        error.response?.data?.message ||
                        "Não foi possível carregar o catálogo."
                    );
                }
            } finally {
                if (
                    !controller.signal.aborted &&
                    versaoAtual === consultaVersao.current
                ) {
                    setCarregando(false);
                }
            }
        }

        carregarCatalogo();
        return () => controller.abort();
    }, [buscaAplicada, linhaFiltro, categoriaFiltro]);

    const mostrarMais = async () => {
        if (carregandoMaisRef.current || !paginacao.temMais) {
            return;
        }

        const controller = new AbortController();
        requisicaoMais.current = controller;
        carregandoMaisRef.current = true;
        setCarregandoMais(true);
        setErroCatalogo("");
        const versaoAtual = consultaVersao.current;

        try {
            const response = await api.get("/catalogo", {
                params: {
                    pagina: paginacao.pagina + 1,
                    limite: LIMITE_CATALOGO,
                    busca: buscaAplicada || undefined,
                    linha: linhaFiltro || undefined,
                    categoria: categoriaFiltro || undefined,
                },
                signal: controller.signal,
            });

            if (versaoAtual !== consultaVersao.current) {
                return;
            }

            const catalogo = normalizeCatalogResponse(response.data, {
                pagina: paginacao.pagina + 1,
                limite: LIMITE_CATALOGO,
                busca: buscaAplicada,
                linha: linhaFiltro,
                categoria: categoriaFiltro,
            });
            const novosProdutos = catalogo.produtos;

            setProdutos((atuais) =>
                acrescentarProdutosCatalogo(atuais, novosProdutos)
            );
            setProdutosConhecidos((anteriores) => {
                const atualizados = { ...anteriores };
                novosProdutos.forEach((produto) => {
                    atualizados[produto.id] = produto;
                });
                return atualizados;
            });
            setPaginacao(catalogo.paginacao);
        } catch (error) {
            if (
                error.code === "ERR_CANCELED" ||
                versaoAtual !== consultaVersao.current
            ) {
                return;
            }

            setErroCatalogo(
                error.response?.data?.message ||
                "Não foi possível carregar mais produtos."
            );
        } finally {
            if (requisicaoMais.current === controller) {
                requisicaoMais.current = null;
                carregandoMaisRef.current = false;
                setCarregandoMais(false);
            }
        }
    };

    const alterarLinhaFiltro = (event) => {
        const proximaLinha = event.target.value;

        if (proximaLinha !== linhaFiltro) {
            reiniciarConsulta();
            setLinhaFiltro(proximaLinha);
        }
    };

    const alterarCategoriaFiltro = (event) => {
        const proximaCategoria = event.target.value;

        if (proximaCategoria !== categoriaFiltro) {
            reiniciarConsulta();
            setCategoriaFiltro(proximaCategoria);
        }
    };

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

    const linhas = filtrosDisponiveis.linhas || [];
    const categorias = filtrosDisponiveis.categorias || [];
    const produtosPorLinha = produtos.reduce((grupos, produto) => {
        const linha = produto.linha || "Sem linha";

        if (!grupos[linha]) {
            grupos[linha] = [];
        }

        grupos[linha].push(produto);

        return grupos;
    }, {});

    const itensSelecionados = Object.entries(quantidades)
        .filter(([, quantidade]) => Number(quantidade) > 0)
        .map(([produtoId]) => produtosConhecidos[produtoId])
        .filter(Boolean);

    const totalPedido = itensSelecionados.reduce(
        (total, produto) =>
            total + produto.preco * Number(quantidades[produto.id]),
        0
    );

    const totalItens = itensSelecionados.reduce(
        (total, produto) => total + Number(quantidades[produto.id]),
        0
    );

    const gerarPedido = async () => {
        const itens = Object.entries(quantidades)
            .filter(([, quantidade]) => Number(quantidade) > 0)
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

    const baixarPdf = async (pedido) => {
        try {
            await abrirOuBaixarPdfPedido({
                pedidoId: pedido._id,
                numeroPedido: pedido.numeroPedido,
            });
        } catch (error) {
            console.error(error);
            alert("Não foi possível abrir ou baixar o PDF do pedido.");
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
                        onChange={alterarLinhaFiltro}
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
                        onChange={alterarCategoriaFiltro}
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
                    <div className={styles.secoes}>
                        {carregando && (
                            <p className={styles.estadoCatalogo}>Carregando produtos...</p>
                        )}

                        {!carregando && erroCatalogo && produtos.length === 0 && (
                            <p className={styles.estadoCatalogo}>{erroCatalogo}</p>
                        )}

                        {!carregando && !erroCatalogo && produtos.length === 0 && (
                            <p className={styles.estadoCatalogo}>
                                Nenhum produto encontrado.
                            </p>
                        )}

                        {Object.keys(produtosPorLinha).map((linha) => {
                            const produtosLinha = produtosPorLinha[linha];

                            return (
                                <section className={styles.secaoLinha} key={linha}>
                                    <div className={styles.tituloLinha}>
                                        <h2>{linha}</h2>
                                        <span>{produtosLinha.length} carregados</span>
                                    </div>
                                    <div className={styles.grid}>
                                        {produtosLinha.map((produto) => (
                                            <div className={styles.card} key={produto.id}>
                                                {produto.fotoUrl && (
                                                    <img
                                                        src={produto.fotoUrl}
                                                        alt={produto.nome}
                                                        loading="lazy"
                                                        decoding="async"
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
                                </section>
                            );
                        })}

                        {erroCatalogo && produtos.length > 0 && (
                            <p className={styles.erroCatalogo}>{erroCatalogo}</p>
                        )}

                        {paginacao.temMais && (
                            <button
                                type="button"
                                className={styles.mostrarMais}
                                onClick={mostrarMais}
                                disabled={carregandoMais}
                            >
                                {carregandoMais ? "Carregando..." : "Mostrar mais"}
                            </button>
                        )}
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
                                    onClick={() => baixarPdf(pedidoCriado)}
                                >
                                    Baixar PDF
                                </button>
                            </div>
                        )}
                    </aside>
                </div>
            </div>

            <div className={styles.barraPedidoMobile}>
                <div>
                    <span>
                        {totalItens} {totalItens === 1 ? "item" : "itens"}
                    </span>
                    <strong>{moeda(totalPedido)}</strong>
                </div>

                <button
                    onClick={gerarPedido}
                    disabled={itensSelecionados.length === 0}
                >
                    Gerar pedido
                </button>
            </div>
        </>
    );
}

export default Catalogo;
