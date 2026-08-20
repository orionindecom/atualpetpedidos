import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../../api/axios";
import {
  FilterToolbar,
  PaginationControls,
} from "../../components/ListControls/ListControls";
import Navbar from "../../components/Navbar/Navbar";
import OperatorIdentificationModal from "../../components/OperatorIdentification/OperatorIdentificationModal";
import OrderDetailModal from "../../components/OrderDetails/OrderDetailModal";
import { abrirOuBaixarPdfSeparacao } from "../../utils/pdfPedido";
import {
  formatOrderDate,
  formatOrderStatus,
  ORDER_STATUS,
} from "../../utils/orderLogistics";
import {
  buildConferencePayload,
  buildLogisticsClosingPayload,
  buildOrderOperationsForm,
  buildOrderOperationsPayload,
} from "../../utils/orderOperations";
import styles from "./LogisticaPedidos.module.css";

const emptyPagination = {
  paginaAtual: 1,
  totalPaginas: 1,
  totalItens: 0,
  temProximaPagina: false,
};

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
  const [conferenceBusy, setConferenceBusy] = useState(false);
  const [logisticsClosingBusy, setLogisticsClosingBusy] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [detailFeedback, setDetailFeedback] = useState(null);
  const [operators, setOperators] = useState([]);
  const [operatorContext, setOperatorContext] = useState(null);
  const [identification, setIdentification] = useState(null);
  const [identificationBusy, setIdentificationBusy] = useState(false);
  const [identificationFeedback, setIdentificationFeedback] = useState("");

  const requestOperators = useCallback(async () => {
    const response = await api.get("/logistica/operadores");
    setOperators(response.data || []);
    return response.data || [];
  }, []);

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
    let active = true;
    api.get("/logistica/operadores")
      .then((response) => {
        if (active) setOperators(response.data || []);
      })
      .catch((requestError) => {
        if (active) {
          setError(requestError.response?.data?.message || "Não foi possível carregar os operadores");
        }
      });
    return () => { active = false; };
  }, []);

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

  const openOrder = (pedido) => {
    setError("");
    setIdentificationFeedback("");
    setIdentification({
      pedidoId: pedido._id,
      orderNumber: pedido.numeroPedido,
      reauthentication: false,
    });
  };

  const identifyOperator = async ({ operatorId, pin }) => {
    if (!identification) return false;
    setIdentificationBusy(true);
    setDetailLoading(!identification.reauthentication);
    setIdentificationFeedback("");
    try {
      const identificationResponse = await api.post(
        `/logistica/pedidos/${identification.pedidoId}/identificar`,
        { operadorId: operatorId, pin }
      );
      const nextContext = {
        token: identificationResponse.data.contextoOperacional,
        operator: identificationResponse.data.operador,
      };

      if (identification.reauthentication && detail?._id === identification.pedidoId) {
        setOperatorContext(nextContext);
        setIdentification(null);
        setDetailFeedback({
          type: "success",
          message: `Operador ${nextContext.operator.nome} identificado novamente.`,
        });
        return true;
      }

      const response = await api.get(`/logistica/pedidos/${identification.pedidoId}`, {
        headers: { "X-Operador-Contexto": nextContext.token },
      });
      setOperatorContext(nextContext);
      setDetail(response.data.pedido);
      setTransitions(response.data.transicoesPermitidas || []);
      setForm(buildOrderOperationsForm(response.data.pedido));
      setDetailFeedback(null);
      setIdentification(null);
      return true;
    } catch (requestError) {
      setIdentificationFeedback(
        requestError.response?.data?.message || "Não foi possível identificar o operador"
      );
      return false;
    } finally {
      setIdentificationBusy(false);
      setDetailLoading(false);
    }
  };

  const requireNewIdentification = (requestError, fallbackMessage) => {
    if (requestError.response?.status !== 428 || !detail) return false;

    const message = requestError.response?.data?.message || fallbackMessage;
    setOperatorContext(null);
    setDetailFeedback({ type: "error", message });
    setIdentificationFeedback(message);
    setIdentification({
      pedidoId: detail._id,
      orderNumber: detail.numeroPedido,
      reauthentication: true,
    });
    requestOperators().catch(() => {});
    return true;
  };

  const closeOrder = () => {
    setDetail(null);
    setForm(null);
    setTransitions([]);
    setDetailFeedback(null);
    setOperatorContext(null);
    setIdentification(null);
    setIdentificationFeedback("");
  };

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
      separacao: field === "status" && value === "separando"
        ? Object.fromEntries(detail.itens.map((item) => [
          String(item.produtoId),
          current.separacao[String(item.produtoId)] === ""
            ? item.quantidade
            : current.separacao[String(item.produtoId)],
        ]))
        : current.separacao,
    }));
  };

  const updateSeparation = (produtoId, value) => {
    setForm((current) => ({
      ...current,
      separacao: { ...current.separacao, [produtoId]: value },
    }));
  };

  const updateConference = (produtoId, value) => {
    setForm((current) => ({
      ...current,
      conferencia: { ...current.conferencia, [produtoId]: value },
    }));
  };

  const runConferenceAction = async (body) => {
    setConferenceBusy(true);
    setDetailFeedback(null);
    try {
      const response = await api.patch(`/logistica/pedidos/${detail._id}`, body, {
        headers: { "X-Operador-Contexto": operatorContext?.token },
      });
      setDetail(response.data.pedido);
      setTransitions(response.data.transicoesPermitidas || []);
      setForm(buildOrderOperationsForm(response.data.pedido));
      setDetailFeedback({ type: "success", message: response.data.message });
      const listResponse = await requestOrders();
      setPedidos(listResponse.data.pedidos || []);
      setPaginacao(listResponse.data.paginacao || emptyPagination);
    } catch (requestError) {
      if (requireNewIdentification(
        requestError,
        "Identifique-se novamente para registrar a conferência"
      )) return;
      setDetailFeedback({
        type: "error",
        message: requestError.response?.data?.message || "Não foi possível registrar a conferência",
      });
    } finally {
      setConferenceBusy(false);
    }
  };

  const startConference = () => runConferenceAction({
    versaoPedido: Number(detail.__v || 0),
    conferencia: { acao: "iniciar" },
  });

  const completeConference = () => runConferenceAction(
    buildConferencePayload(detail, form)
  );

  const saveLogisticsClosing = async () => {
    const quantity = Number(form.quantidadeVolumes);
    const weight = Number(String(form.pesoTotalKg).trim().replace(",", "."));
    if (
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(weight) ||
      weight <= 0 ||
      !form.observacaoVolumes.trim()
    ) {
      setDetailFeedback({
        type: "error",
        message: "Informe uma quantidade inteira de volumes, peso maior que zero e a descrição das caixas.",
      });
      return;
    }

    setLogisticsClosingBusy(true);
    setDetailFeedback(null);
    try {
      const response = await api.patch(
        `/logistica/pedidos/${detail._id}`,
        buildLogisticsClosingPayload(form),
        { headers: { "X-Operador-Contexto": operatorContext?.token } }
      );
      setDetail(response.data.pedido);
      setTransitions(response.data.transicoesPermitidas || []);
      setForm(buildOrderOperationsForm(response.data.pedido));
      setDetailFeedback({ type: "success", message: response.data.message });
      const listResponse = await requestOrders();
      setPedidos(listResponse.data.pedidos || []);
      setPaginacao(listResponse.data.paginacao || emptyPagination);
    } catch (requestError) {
      if (requireNewIdentification(
        requestError,
        "Identifique-se novamente para concluir o fechamento logístico"
      )) return;
      setDetailFeedback({
        type: "error",
        message: requestError.response?.data?.message || "Não foi possível salvar o fechamento logístico",
      });
    } finally {
      setLogisticsClosingBusy(false);
    }
  };

  const saveOrder = async (event) => {
    event.preventDefault();
    setSaving(true);
    setDetailFeedback(null);
    try {
      const payload = buildOrderOperationsPayload(detail, form);
      const response = await api.patch(`/logistica/pedidos/${detail._id}`, payload, {
        headers: { "X-Operador-Contexto": operatorContext?.token },
      });
      setDetail(response.data.pedido);
      setTransitions(response.data.transicoesPermitidas || []);
      setForm(buildOrderOperationsForm(response.data.pedido));
      setDetailFeedback({ type: "success", message: response.data.message });
      const listResponse = await requestOrders();
      setPedidos(listResponse.data.pedidos || []);
      setPaginacao(listResponse.data.paginacao || emptyPagination);
    } catch (requestError) {
      if (requireNewIdentification(
        requestError,
        "Identifique-se novamente para atualizar o pedido"
      )) return;
      setDetailFeedback({
        type: "error",
        message: requestError.response?.data?.message || "Não foi possível atualizar o pedido",
      });
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
        contextoOperacional: operatorContext?.token,
      });
    } catch (requestError) {
      if (requireNewIdentification(
        requestError,
        "Identifique-se novamente para acessar o PDF"
      )) return;
      setDetailFeedback({ type: "error", message: "Não foi possível baixar o PDF de separação." });
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

  return (
    <>
      <Navbar />
      <main className={styles.container}>
        <header className={styles.pageHeader}>
          <span>Operação</span>
          <h1>Pedidos</h1>
          <p>Consulte a fila, registre a separação e avance o fluxo operacional.</p>
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
            {ORDER_STATUS.filter((status) => status !== "aguardando_aprovacao").map((status) => (
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
                {pedido.conferencia?.status && (
                  <span>Conferência: {pedido.conferencia.status.replaceAll("_", " ")}</span>
                )}
                {pedido.fechamentoLogisticoObrigatorio && (
                  <span>Fechamento: {pedido.fechamentoLogistico?.preenchidoEm ? "concluído" : "pendente"}</span>
                )}
                {["faturado", "enviado", "entregue"].includes(pedido.status) && (
                  <>
                    <span>NF: {pedido.numeroNotaFiscal || "-"}</span>
                    <span>{pedido.transportadora || "Transportadora não informada"}</span>
                  </>
                )}
              </div>
              <button type="button" onClick={() => openOrder(pedido)} disabled={detailLoading}>
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
        <OrderDetailModal
          detail={detail}
          form={form}
          transitions={transitions}
          saving={saving}
          conferenceBusy={conferenceBusy}
          logisticsClosingBusy={logisticsClosingBusy}
          downloadingPdf={downloadingPdf}
          feedback={detailFeedback}
          activeOperator={operatorContext?.operator}
          onClose={closeOrder}
          onSubmit={saveOrder}
          onFieldChange={updateField}
          onSeparationChange={updateSeparation}
          onConferenceChange={updateConference}
          onStartConference={startConference}
          onCompleteConference={completeConference}
          onSaveLogisticsClosing={saveLogisticsClosing}
          onDownloadSeparationPdf={downloadSeparationPdf}
        />
      )}

      {identification && (
        <OperatorIdentificationModal
          key={`${identification.pedidoId}-${identification.reauthentication ? "renew" : "open"}`}
          orderNumber={identification.orderNumber}
          operators={operators}
          loading={identificationBusy}
          feedback={identificationFeedback}
          onClose={() => {
            setIdentification(null);
            setIdentificationFeedback("");
          }}
          onContinue={identifyOperator}
        />
      )}
    </>
  );
}

export default LogisticaPedidos;
