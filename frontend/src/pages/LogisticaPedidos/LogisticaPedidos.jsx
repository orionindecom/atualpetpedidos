import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../../api/axios";
import {
  FilterToolbar,
  PaginationControls,
} from "../../components/ListControls/ListControls";
import Navbar from "../../components/Navbar/Navbar";
import OrderProgress from "../../components/OrderProgress/OrderProgress";
import { abrirOuBaixarPdfSeparacao } from "../../utils/pdfPedido";
import {
  formatCurrency,
  formatOrderDate,
  formatOrderDateTime,
  formatOrderStatus,
  ORDER_STATUS,
} from "../../utils/orderLogistics";
import styles from "./LogisticaPedidos.module.css";

const emptyPagination = {
  paginaAtual: 1,
  totalPaginas: 1,
  totalItens: 0,
  temProximaPagina: false,
};

const toDateInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

const buildForm = (pedido) => ({
  status: pedido.status || "novo",
  numeroNotaFiscal: pedido.numeroNotaFiscal || "",
  dataFaturamento: toDateInput(pedido.dataFaturamento),
  transportadora: pedido.transportadora || "",
  codigoRastreio: pedido.codigoRastreio || "",
  linkRastreio: pedido.linkRastreio || "",
  dataEnvio: toDateInput(pedido.dataEnvio),
  observacaoLogistica: pedido.observacaoLogistica || "",
  observacaoHistorico: "",
});

function LogisticaPedidos() {
  const [searchParams] = useSearchParams();
  const initialFilters = useMemo(() => ({
    busca: "",
    status: "",
    dataInicio: "",
    dataFim: "",
    aguardandoAcao: searchParams.get("aguardandoAcao") === "true",
  }), [searchParams]);
  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [pagina, setPagina] = useState(1);
  const [pedidos, setPedidos] = useState([]);
  const [paginacao, setPaginacao] = useState(emptyPagination);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [transitions, setTransitions] = useState([]);
  const [form, setForm] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const requestOrders = useCallback(({ signal } = {}) => (
    api.get("/logistica/pedidos", {
      signal,
      params: {
        pagina,
        limite: 20,
        ...filters,
        aguardandoAcao: filters.aguardandoAcao || undefined,
      },
    })
  ), [filters, pagina]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    requestOrders({ signal: controller.signal })
      .then((response) => {
        if (!active) return;
        setPedidos(response.data.pedidos || []);
        setPaginacao(response.data.paginacao || emptyPagination);
        setError("");
      })
      .catch((requestError) => {
        if (active && requestError.code !== "ERR_CANCELED") {
          setError(requestError.response?.data?.message || "Não foi possível carregar os pedidos");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [requestOrders]);

  useEffect(() => {
    if (!detail) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [detail]);

  const applyFilters = (event) => {
    event.preventDefault();
    setLoading(true);
    setPagina(1);
    setFilters(draftFilters);
  };

  const clearFilters = () => {
    const empty = {
      busca: "",
      status: "",
      dataInicio: "",
      dataFim: "",
      aguardandoAcao: false,
    };
    setDraftFilters(empty);
    setLoading(true);
    setFilters(empty);
    setPagina(1);
  };

  const openOrder = async (pedidoId) => {
    setDetailLoading(true);
    setError("");
    try {
      const response = await api.get(`/logistica/pedidos/${pedidoId}`);
      setDetail(response.data.pedido);
      setTransitions(response.data.transicoesPermitidas || []);
      setForm(buildForm(response.data.pedido));
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Não foi possível abrir o pedido");
    } finally {
      setDetailLoading(false);
    }
  };

  const closeOrder = () => {
    setDetail(null);
    setForm(null);
    setTransitions([]);
  };

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const saveOrder = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await api.patch(`/logistica/pedidos/${detail._id}`, form);
      setDetail(response.data.pedido);
      setTransitions(response.data.transicoesPermitidas || []);
      setForm(buildForm(response.data.pedido));
      const listResponse = await requestOrders();
      setPedidos(listResponse.data.pedidos || []);
      setPaginacao(listResponse.data.paginacao || emptyPagination);
    } catch (requestError) {
      alert(requestError.response?.data?.message || "Não foi possível atualizar o pedido");
    } finally {
      setSaving(false);
    }
  };

  const downloadSeparationPdf = async () => {
    setDownloadingPdf(true);
    try {
      await abrirOuBaixarPdfSeparacao({
        pedidoId: detail._id,
        numeroPedido: detail.numeroPedido,
      });
    } catch {
      alert("Não foi possível baixar o PDF de separação.");
    } finally {
      setDownloadingPdf(false);
    }
  };

  const activeFilterCount = [
    filters.status,
    filters.dataInicio,
    filters.dataFim,
    filters.aguardandoAcao,
  ].filter(Boolean).length;
  const statusOptions = detail
    ? [detail.status, ...transitions.filter((status) => status !== detail.status)]
    : [];

  return (
    <>
      <Navbar />
      <main className={styles.container}>
        <header className={styles.pageHeader}>
          <span>Operação</span>
          <h1>Pedidos</h1>
          <p>Consulte a fila, avance o status e registre faturamento e expedição.</p>
        </header>

        <FilterToolbar
          activeFilterCount={activeFilterCount}
          searchLabel="Buscar pedidos"
          searchPlaceholder="Número do pedido ou cliente"
          searchValue={draftFilters.busca}
          onSearchChange={(event) => setDraftFilters((current) => ({
            ...current,
            busca: event.target.value,
          }))}
          onSubmit={applyFilters}
          onClear={clearFilters}
        >
          <select
            className={styles.statusFilter}
            aria-label="Filtrar por status"
            value={draftFilters.status}
            onChange={(event) => setDraftFilters((current) => ({
              ...current,
              status: event.target.value,
            }))}
          >
            <option value="">Todos os status</option>
            {ORDER_STATUS.map((status) => (
              <option key={status} value={status}>{formatOrderStatus(status)}</option>
            ))}
          </select>
          <input
            className={styles.filterInput}
            aria-label="Data inicial"
            type="date"
            value={draftFilters.dataInicio}
            onChange={(event) => setDraftFilters((current) => ({
              ...current,
              dataInicio: event.target.value,
            }))}
          />
          <input
            className={styles.filterInput}
            aria-label="Data final"
            type="date"
            value={draftFilters.dataFim}
            onChange={(event) => setDraftFilters((current) => ({
              ...current,
              dataFim: event.target.value,
            }))}
          />
          <label className={styles.quickFilter}>
            <input
              type="checkbox"
              checked={draftFilters.aguardandoAcao}
              onChange={(event) => setDraftFilters((current) => ({
                ...current,
                aguardandoAcao: event.target.checked,
              }))}
            />
            Aguardando ação
          </label>
        </FilterToolbar>

        <div className={styles.resultHeader}>
          <strong>{paginacao.totalItens} pedidos</strong>
          {loading && <span>Atualizando...</span>}
        </div>

        {error && <div className={styles.stateBox} role="alert">{error}</div>}
        {!loading && !error && pedidos.length === 0 && (
          <div className={styles.stateBox}>Nenhum pedido encontrado para os filtros aplicados.</div>
        )}

        <section className={styles.orderList} aria-label="Lista de pedidos">
          {pedidos.map((pedido) => (
            <article key={pedido._id} className={styles.orderCard}>
              <div className={styles.orderIdentity}>
                <strong>{pedido.numeroPedido}</strong>
                <span>{pedido.nomeFantasiaCliente || pedido.razaoSocialCliente || "Cliente"}</span>
              </div>
              <div className={styles.orderMeta}>
                <span>{formatOrderDate(pedido.dataPedido || pedido.createdAt)}</span>
                <span>{pedido.quantidadeItens} itens</span>
              </div>
              <span className={styles.statusBadge} data-status={pedido.status}>
                {formatOrderStatus(pedido.status)}
              </span>
              <div className={styles.operationalMeta}>
                <span>NF: {pedido.numeroNotaFiscal || "-"}</span>
                <span>{pedido.transportadora || "Transportadora não informada"}</span>
              </div>
              <button type="button" onClick={() => openOrder(pedido._id)} disabled={detailLoading}>
                Abrir pedido
              </button>
            </article>
          ))}
        </section>

        <PaginationControls
          currentPage={paginacao.paginaAtual}
          totalPages={paginacao.totalPaginas}
          disabled={loading}
          onPrevious={() => {
            setLoading(true);
            setPagina((current) => Math.max(current - 1, 1));
          }}
          onNext={() => {
            setLoading(true);
            setPagina((current) => current + 1);
          }}
        />
      </main>

      {detail && form && (
        <div className={styles.modalOverlay} onMouseDown={closeOrder}>
          <section
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="logistics-order-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className={styles.modalHeader}>
              <div>
                <span>Pedido</span>
                <h2 id="logistics-order-title">{detail.numeroPedido}</h2>
                <p>{detail.nomeFantasiaCliente || detail.razaoSocialCliente || "Cliente"}</p>
              </div>
              <div className={styles.modalHeaderActions}>
                <button
                  type="button"
                  className={styles.separationPdfButton}
                  disabled={downloadingPdf}
                  onClick={downloadSeparationPdf}
                >
                  {downloadingPdf ? "Preparando PDF..." : "Baixar PDF de separação"}
                </button>
                <button type="button" onClick={closeOrder}>Fechar</button>
              </div>
            </header>

            <div className={styles.modalContent}>
              <section className={styles.progressSection}>
                <h3>Andamento</h3>
                <OrderProgress status={detail.status} />
              </section>

              <section className={styles.readOnlySection}>
                <div className={styles.sectionTitle}>
                  <h3>Itens do pedido</h3>
                  <strong>{formatCurrency(detail.valorTotal)}</strong>
                </div>
                <div className={styles.itemsTable}>
                  {detail.itens.map((item) => (
                    <div key={`${item.produtoId}-${item.nomeProduto}`}>
                      <span>{item.nomeProduto}</span>
                      <span>{item.quantidade} un.</span>
                      <span>{formatCurrency(item.valorUnitario)}</span>
                      <strong>{formatCurrency(item.subtotal)}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <form className={styles.logisticsForm} onSubmit={saveOrder}>
                <section>
                  <h3>Status e registro</h3>
                  <div className={styles.formGrid}>
                    <label>
                      Status
                      <select value={form.status} onChange={(event) => updateField("status", event.target.value)}>
                        {statusOptions.map((status) => (
                          <option key={status} value={status}>{formatOrderStatus(status)}</option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.wideField}>
                      Observação desta alteração
                      <input
                        type="text"
                        maxLength="500"
                        value={form.observacaoHistorico}
                        onChange={(event) => updateField("observacaoHistorico", event.target.value)}
                      />
                    </label>
                  </div>
                </section>

                <section>
                  <h3>Faturamento</h3>
                  <div className={styles.formGrid}>
                    <label>
                      Número da nota fiscal
                      <input
                        type="text"
                        maxLength="100"
                        value={form.numeroNotaFiscal}
                        onChange={(event) => updateField("numeroNotaFiscal", event.target.value)}
                      />
                    </label>
                    <label>
                      Data de faturamento
                      <input
                        type="date"
                        value={form.dataFaturamento}
                        onChange={(event) => updateField("dataFaturamento", event.target.value)}
                      />
                    </label>
                  </div>
                </section>

                <section>
                  <h3>Expedição e entrega</h3>
                  <div className={styles.formGrid}>
                    <label>
                      Transportadora
                      <input
                        type="text"
                        maxLength="120"
                        value={form.transportadora}
                        onChange={(event) => updateField("transportadora", event.target.value)}
                      />
                    </label>
                    <label>
                      Código de rastreio
                      <input
                        type="text"
                        maxLength="120"
                        value={form.codigoRastreio}
                        onChange={(event) => updateField("codigoRastreio", event.target.value)}
                      />
                    </label>
                    <label className={styles.wideField}>
                      Link de rastreamento
                      <input
                        type="url"
                        maxLength="500"
                        placeholder="https://"
                        value={form.linkRastreio}
                        onChange={(event) => updateField("linkRastreio", event.target.value)}
                      />
                    </label>
                    <label>
                      Data de envio
                      <input
                        type="date"
                        value={form.dataEnvio}
                        onChange={(event) => updateField("dataEnvio", event.target.value)}
                      />
                    </label>
                    <div className={styles.readOnlyField}>
                      <span>Data de entrega</span>
                      <strong>{formatOrderDateTime(detail.dataEntrega, "Ainda não confirmada")}</strong>
                    </div>
                    <label className={styles.fullField}>
                      Observação logística interna
                      <textarea
                        maxLength="1000"
                        rows="3"
                        value={form.observacaoLogistica}
                        onChange={(event) => updateField("observacaoLogistica", event.target.value)}
                      />
                    </label>
                  </div>
                </section>

                <div className={styles.formActions}>
                  <button type="button" onClick={closeOrder}>Cancelar</button>
                  <button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar atualização"}</button>
                </div>
              </form>

              <section className={styles.historySection}>
                <h3>Histórico de status</h3>
                {!detail.historicoStatus?.length ? (
                  <p>Este pedido ainda não possui histórico registrado.</p>
                ) : (
                  <ol>
                    {[...detail.historicoStatus].reverse().map((entry, index) => (
                      <li key={`${entry.alteradoEm}-${index}`}>
                        <time dateTime={entry.alteradoEm}>{formatOrderDateTime(entry.alteradoEm)}</time>
                        <strong>{formatOrderStatus(entry.statusAnterior)} → {formatOrderStatus(entry.novoStatus)}</strong>
                        <span>{entry.usuarioNome || "Usuário interno"} · {entry.usuarioTipo}</span>
                        {entry.observacao && <p>{entry.observacao}</p>}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export default LogisticaPedidos;
