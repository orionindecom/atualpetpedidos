import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../api/axios";
import styles from "./Catalogo.module.css";
import {
    FilterToolbar,
    LoadMoreButton,
} from "../../components/ListControls/ListControls";
import Navbar from "../../components/Navbar/Navbar";
import PageHeader from "../../components/PageHeader/PageHeader";
import { useModalDialog } from "../../hooks/useModalDialog";
import { useFeedback } from "../../components/Feedback/feedbackContext";
import modalStyles from "../../components/OrderDetails/OrderDetails.module.css";
import DistributorBanners from "../../components/DistributorBanners/DistributorBanners";
import { abrirOuBaixarPdfPedido } from "../../utils/pdfPedido";
import { normalizeCatalogResponse } from "../../utils/catalogResponse";
import {
    acrescentarProdutosCatalogo,
    criarEstadoCatalogoParaNovoFiltro,
    criarPaginacaoCatalogoInicial,
    substituirProdutosCatalogo,
} from "../../utils/catalogPagination";

const LIMITE_CATALOGO = 12;

function Catalogo({ distribuidor = null, onTrocarDistribuidor }) {
    const catalogoUrl = distribuidor ? `/pedidos/comercial/distribuidores/${distribuidor._id}/catalogo` : "/catalogo";
    const tabelaPrecoId = distribuidor?.tabelaPrecoId?._id;
    const { dialog, toast } = useFeedback();
    const [produtos, setProdutos] = useState([]);
    const [produtosConhecidos, setProdutosConhecidos] = useState({});
    const [quantidades, setQuantidades] = useState({});
    const [pedidoCriado, setPedidoCriado] = useState(null);
    const [revisando, setRevisando] = useState(false);
    const [gerandoPedido, setGerandoPedido] = useState(false);
    const [erroPedido, setErroPedido] = useState("");
    const [observacao, setObservacao] = useState("");
    const envioEmCurso = useRef(false);
    const dialogRef = useModalDialog({ open: revisando, onClose: () => setRevisando(false), closeDisabled: gerandoPedido });

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
                const response = await api.get(catalogoUrl, {
                    params: {
                        tabelaPrecoId,
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
    }, [buscaAplicada, linhaFiltro, categoriaFiltro, catalogoUrl, tabelaPrecoId]);

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
            const response = await api.get(catalogoUrl, {
                params: {
                    tabelaPrecoId,
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

    const aplicarFiltros = (event) => {
        event.preventDefault();
        const proximaBusca = busca.trim();

        if (proximaBusca !== buscaAplicada) {
            reiniciarConsulta();
            setBuscaAplicada(proximaBusca);
        }
    };

    const limparFiltros = () => {
        if (busca || buscaAplicada || linhaFiltro || categoriaFiltro) {
            reiniciarConsulta();
        }
        setBusca("");
        setBuscaAplicada("");
        setLinhaFiltro("");
        setCategoriaFiltro("");
    };

    const moeda = (valor) =>
        valor.toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
        });

    const alterarQuantidade = (produtoId, quantidade) => {
        setErroPedido("");
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
        if (envioEmCurso.current) return;
        const itens = Object.entries(quantidades)
            .filter(([, quantidade]) => Number(quantidade) > 0)
            .map(([produtoId, quantidade]) => ({
                produtoId,
                quantidade: Number(quantidade),
            }));

        if (itens.length === 0 || itens.some((item) => !Number.isFinite(item.quantidade) || item.quantidade < 1 || item.quantidade > 999999)) {
            setErroPedido("Informe ao menos um produto com quantidade entre 1 e 999999.");
            return;
        }

        envioEmCurso.current = true;
        setGerandoPedido(true);
        setErroPedido("");
        try {
            const response = await api.post(distribuidor ? "/pedidos/comercial" : "/pedidos", {
                itens,
                observacao,
                ...(distribuidor ? { clienteId: distribuidor._id, tabelaPrecoId } : {}),
            });
            setPedidoCriado(response.data.pedido);
            setQuantidades({});
            setObservacao("");
            setRevisando(false);
        } catch (error) {
            setErroPedido(error.response?.data?.message || "Não foi possível criar o pedido. Tente novamente.");
        } finally {
            envioEmCurso.current = false;
            setGerandoPedido(false);
        }
    };

    const iniciarFinalizacao = () => {
        setErroPedido("");
        if (distribuidor) setRevisando(true);
        else gerarPedido();
    };

    const trocarDistribuidor = async () => {
        if (itensSelecionados.length > 0) {
            const confirmado = await dialog.confirm({
                variant: "warning",
                icon: "cart",
                title: "Trocar distribuidor?",
                message: "Os itens escolhidos neste pedido serão removidos para você selecionar outro distribuidor.",
                details: [{ label: "Itens no pedido", value: String(itensSelecionados.length) }],
                confirmLabel: "Trocar e limpar pedido",
            });
            if (!confirmado) return;
        }
        onTrocarDistribuidor();
    };

    const baixarPdf = async (pedido) => {
        try {
            await abrirOuBaixarPdfPedido({
                pedidoId: pedido._id,
                numeroPedido: pedido.numeroPedido,
            });
        } catch (error) {
            console.error(error);
            toast.error("Não foi possível abrir o PDF", {
                description: `Tente baixar o pedido ${pedido.numeroPedido} novamente em instantes.`,
            });
        }
    };

    return (
        <>
            <Navbar />

            <div className={styles.container}>
                {distribuidor ? <PageHeader eyebrow="Comercial" title="Novo pedido"
                    description={`${distribuidor.nomeFantasia || distribuidor.razaoSocial || distribuidor.nomeResponsavel} · Tabela: ${distribuidor.tabelaPrecoId.nome}`}
                    action={<button className={styles.botao} disabled={gerandoPedido} onClick={trocarDistribuidor}>Trocar distribuidor</button>}
                /> : <div className={styles.header}>
                    <h1>Catálogo AtualPet</h1>
                    <p>Informe as quantidades desejadas e gere seu pedido.</p>
                </div>}

                {!distribuidor && <DistributorBanners />}

                <FilterToolbar
                    activeFilterCount={[linhaFiltro, categoriaFiltro].filter(Boolean).length}
                    searchLabel="Buscar produtos no catálogo"
                    searchPlaceholder="Buscar por produto, linha ou categoria..."
                    searchValue={busca}
                    onSearchChange={(event) => setBusca(event.target.value)}
                    onSubmit={aplicarFiltros}
                    onClear={limparFiltros}
                >
                    <select
                        aria-label="Filtrar por linha"
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
                        aria-label="Filtrar por categoria"
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
                </FilterToolbar>

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
                                                    <label htmlFor={`quantidade-${produto.id}`}>Quantidade</label>

                                                    <input
                                                        className={styles.input}
                                                        type="number"
                                                        id={`quantidade-${produto.id}`}
                                                        aria-label={`Quantidade de ${produto.nome}`}
                                                        min="0"
                                                        max="999999"
                                                        disabled={gerandoPedido}
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
                            <LoadMoreButton
                                loading={carregandoMais}
                                onClick={mostrarMais}
                            />
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
                                    onClick={iniciarFinalizacao}
                                    disabled={itensSelecionados.length === 0 || gerandoPedido}
                                >
                                    {gerandoPedido ? "Enviando..." : distribuidor ? "Revisar pedido" : "Gerar Pedido"}
                                </button>
                            </>
                        )}

                        {erroPedido && !revisando && <p className={styles.erroCatalogo} role="alert">{erroPedido}</p>}
                        {pedidoCriado && (
                            <div className={styles.sucesso} role="status">
                                <h3>Pedido criado!</h3>
                                <p>{pedidoCriado.numeroPedido}</p>
                                <p>Aguardando aprovação.</p>

                                {distribuidor ? <Link to={`/pedidos?pedido=${pedidoCriado._id}`}>Consultar pedido</Link> : <button
                                    className={styles.botao}
                                    onClick={() => baixarPdf(pedidoCriado)}
                                >
                                    Baixar PDF
                                </button>}
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
                    onClick={iniciarFinalizacao}
                    disabled={itensSelecionados.length === 0 || gerandoPedido}
                >
                    {gerandoPedido ? "Enviando..." : distribuidor ? "Revisar pedido" : "Gerar pedido"}
                </button>
            </div>
            {revisando && (
                <div className={modalStyles.modalOverlay}>
                    <section ref={dialogRef} className={modalStyles.modal} role="dialog" aria-modal="true" aria-labelledby="revisao-pedido-title" tabIndex="-1">
                        <header className={modalStyles.modalHeader}>
                            <div className={modalStyles.modalTitle}><span>Comercial</span><h2 id="revisao-pedido-title">Revisar pedido</h2>
                                <p>{distribuidor.nomeFantasia || distribuidor.razaoSocial || distribuidor.nomeResponsavel}</p>
                            </div>
                            <button className={modalStyles.closeButton} disabled={gerandoPedido} onClick={() => setRevisando(false)}>Voltar</button>
                        </header>
                        <div className={modalStyles.modalContent}>
                            <p className={styles.vazio}>Tabela: {distribuidor.tabelaPrecoId.nome}. O pedido seguirá para aprovação.</p>
                            <div className={styles.listaResumo}>
                                {itensSelecionados.map((produto) => <div className={styles.itemResumo} key={produto.id}>
                                    <div><span>{produto.nome}</span><small>{quantidades[produto.id]} × {moeda(produto.preco)}</small></div>
                                    <strong>{moeda(produto.preco * Number(quantidades[produto.id]))}</strong>
                                </div>)}
                            </div>
                            <div className={styles.totalResumo}><span>Total</span><strong>{moeda(totalPedido)}</strong></div>
                            <label className={modalStyles.conferenceObservation}>Observação (opcional)
                                <textarea maxLength={1000} value={observacao} disabled={gerandoPedido} onChange={(event) => setObservacao(event.target.value)} />
                            </label>
                            <div className={styles.reviewFooter}>
                                {erroPedido && <p className={styles.erroCatalogo} role="alert">{erroPedido}</p>}
                                <div className={modalStyles.formActions}>
                                    <button disabled={gerandoPedido} onClick={() => setRevisando(false)}>Voltar aos produtos</button>
                                    <button disabled={gerandoPedido || itensSelecionados.length === 0} onClick={gerarPedido}>{gerandoPedido ? "Enviando..." : "Finalizar pedido"}</button>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            )}
        </>
    );
}

export default Catalogo;
