import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getAuthSession } from "../../utils/authSession";
import { hasGlobalScope, hasPermission } from "../../utils/permissions";
import api from "../../api/axios";
import { FilterToolbar } from "../../components/ListControls/ListControls";
import Navbar from "../../components/Navbar/Navbar";
import OrderDetailModal from "../../components/OrderDetails/OrderDetailModal";
import { useModalDialog } from "../../hooks/useModalDialog";
import { useDialogVisualViewport } from "../../hooks/useDialogVisualViewport";
import { useFeedback } from "../../components/Feedback/feedbackContext";
import { getApiErrorMessage } from "../../utils/apiErrors";
import styles from "./AdminPedidos.module.css";
import {
  abrirOuBaixarPdfPedido,
  abrirOuBaixarPdfSeparacao,
  abrirOuBaixarRelatorioPedido,
} from "../../utils/pdfPedido";
import { formatOrderStatus, ORDER_STATUS } from "../../utils/orderLogistics";
import {
  buildConferencePayload,
  buildOrderOperationsForm,
  buildOrderOperationsPayload,
  updateOrderSeparationForm,
} from "../../utils/orderOperations";

function AdminPedidos() {
  const usuario = getAuthSession()?.usuario;
  const isAdmin = usuario?.tipo === "admin";
  const [searchParams, setSearchParams] = useSearchParams();
  const openedFromMetrics = useRef("");
  const [pedidos, setPedidos] = useState([]);
  const [produtos, setProdutos] = useState([]);

  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("");

  const [modalPedido, setModalPedido] = useState(null);
  const [quantidadesModal, setQuantidadesModal] = useState({});
  const [buscaProduto, setBuscaProduto] = useState("");
  const [detail, setDetail] = useState(null);
  const [transitions, setTransitions] = useState([]);
  const [operationsForm, setOperationsForm] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [savingOperations, setSavingOperations] = useState(false);
  const [conferenceBusy, setConferenceBusy] = useState(false);
  const [approving, setApproving] = useState(false);
  const [downloadingSeparationPdf, setDownloadingSeparationPdf] = useState(false);
  const [downloadingCommercialPdf, setDownloadingCommercialPdf] = useState(false);
  const [downloadingReportPdf, setDownloadingReportPdf] = useState(false);
  const [deletingOrder, setDeletingOrder] = useState(false);
  const [adminActionBusy, setAdminActionBusy] = useState(false);
  const { dialog, toast } = useFeedback();
  const [detailFeedback, setDetailFeedback] = useState(null);

  const statusOptions = ORDER_STATUS;

  const carregarDados = async () => {
    const [pedidosResponse, produtosResponse] = await Promise.all([
      api.get("/pedidos"),
      api.get("/produtos"),
    ]);

    setPedidos(pedidosResponse.data);
    setProdutos(produtosResponse.data);
  };

  useEffect(() => {
    async function carregarDadosIniciais() {
      const [pedidosResponse, produtosResponse] = await Promise.all([
        api.get("/pedidos"),
        api.get("/produtos"),
      ]);

      setPedidos(pedidosResponse.data);
      setProdutos(produtosResponse.data);
    }

    carregarDadosIniciais();
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

  const formatarStatus = formatOrderStatus;

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

  const atualizarPedidoNaLista = (pedidoAtualizado) => {
    setPedidos((current) => current.map((pedido) => (
      pedido._id === pedidoAtualizado._id ? pedidoAtualizado : pedido
    )));
  };

  const abrirDetalhes = useCallback(async (pedidoId) => {
    setDetailLoading(true);
    setDetailFeedback(null);
    try {
      const response = await api.get(isAdmin
        ? `/logistica/pedidos/${pedidoId}`
        : `/pedidos/${pedidoId}/aprovacao`);
      const pedido = isAdmin ? response.data.pedido : response.data;
      setDetail(pedido);
      setTransitions(isAdmin ? response.data.transicoesPermitidas || [] : []);
      setOperationsForm(buildOrderOperationsForm(pedido));
    } catch (error) {
      toast.error("Não foi possível abrir o pedido", {
        description: getApiErrorMessage(error, "Atualize a lista e tente novamente."),
      });
    } finally {
      setDetailLoading(false);
    }
  }, [isAdmin, toast]);

  useEffect(() => {
    const pedidoId = searchParams.get("pedido") || "";
    if (!pedidoId || openedFromMetrics.current === pedidoId) return;
    openedFromMetrics.current = pedidoId;
    abrirDetalhes(pedidoId);
  }, [abrirDetalhes, searchParams]);

  const fecharDetalhes = () => {
    setDetail(null);
    setTransitions([]);
    setOperationsForm(null);
    setDetailFeedback(null);
    if (searchParams.has("pedido")) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("pedido");
      setSearchParams(nextParams, { replace: true });
    }
  };

  const alterarCampoOperacional = (field, value) => {
    setOperationsForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const alterarSeparacao = (produtoId, value) => {
    setOperationsForm((current) => updateOrderSeparationForm(current, produtoId, value));
  };

  const alterarConferencia = (produtoId, value) => {
    setOperationsForm((current) => ({
      ...current,
      conferencia: { ...current.conferencia, [produtoId]: value },
    }));
  };

  const executarAcaoConferencia = async (body) => {
    setConferenceBusy(true);
    setDetailFeedback(null);
    try {
      const response = await api.patch(`/logistica/pedidos/${detail._id}`, body);
      setDetail(response.data.pedido);
      setTransitions(response.data.transicoesPermitidas || []);
      setOperationsForm(buildOrderOperationsForm(response.data.pedido));
      atualizarPedidoNaLista(response.data.pedido);
      setDetailFeedback({ type: "success", message: response.data.message });
    } catch (error) {
      setDetailFeedback({
        type: "error",
        message: error.response?.data?.message || "Não foi possível registrar a conferência",
      });
    } finally {
      setConferenceBusy(false);
    }
  };

  const iniciarConferencia = () => executarAcaoConferencia({
    versaoPedido: Number(detail.__v || 0),
    conferencia: { acao: "iniciar" },
  });

  const concluirConferencia = () => executarAcaoConferencia(
    buildConferencePayload(detail, operationsForm)
  );

  const salvarOperacao = async (event) => {
    event.preventDefault();
    setSavingOperations(true);
    setDetailFeedback(null);
    try {
      const payload = buildOrderOperationsPayload(detail, operationsForm);
      const response = await api.patch(`/logistica/pedidos/${detail._id}`, payload);
      setDetail(response.data.pedido);
      setTransitions(response.data.transicoesPermitidas || []);
      setOperationsForm(buildOrderOperationsForm(response.data.pedido));
      atualizarPedidoNaLista(response.data.pedido);
      setDetailFeedback({ type: "success", message: response.data.message });
    } catch (error) {
      setDetailFeedback({
        type: "error",
        message: error.response?.data?.message || "Não foi possível atualizar o pedido",
      });
    } finally {
      setSavingOperations(false);
    }
  };

  const aprovarPedido = async () => {
    if (approving) return;
    setApproving(true);
    setDetailFeedback(null);
    try {
      const response = await api.patch(`/pedidos/${detail._id}/aprovar`);
      setDetail(response.data.pedido);
      setTransitions(isAdmin ? ["separando"] : []);
      setOperationsForm(buildOrderOperationsForm(response.data.pedido));
      atualizarPedidoNaLista(response.data.pedido);
      setDetailFeedback({ type: "success", message: response.data.message });
    } catch (error) {
      setDetailFeedback({
        type: "error",
        message: error.response?.data?.message || "Não foi possível aprovar o pedido",
      });
    } finally {
      setApproving(false);
    }
  };

  const registrarSaidaAdmin = async (destino) => {
    if (!isAdmin || adminActionBusy) return;
    setAdminActionBusy(true);
    setDetailFeedback(null);
    try {
      await dialog.confirm({
        variant: "warning",
        title: destino === "enviado" ? "Marcar como enviado?" : "Retirado pelo distribuidor?",
        message: destino === "enviado"
          ? "Ao confirmar, o pedido será marcado diretamente como Enviado. As etapas intermediárias serão ignoradas e o pedido deixará de gerar pendências na Necessidade de Produção."
          : "Ao confirmar a retirada, o pedido será considerado retirado pelo distribuidor e concluído. Suas pendências na Necessidade de Produção serão encerradas.",
        details: [{ label: "Pedido", value: detail.numeroPedido }],
        confirmLabel: destino === "enviado" ? "Marcar como enviado" : "Confirmar retirada",
        busyLabel: "Registrando saída...",
        errorFallback: "Não foi possível registrar a saída do pedido.",
        action: async () => {
          const response = await api.patch(`/pedidos/${detail._id}/${destino === "enviado" ? "marcar-enviado" : "retirar"}`);
          setDetail(response.data.pedido);
          setTransitions(response.data.transicoesPermitidas || []);
          setOperationsForm(buildOrderOperationsForm(response.data.pedido));
          atualizarPedidoNaLista(response.data.pedido);
          setDetailFeedback({ type: "success", message: response.data.message });
        },
      });
    } finally {
      setAdminActionBusy(false);
    }
  };

  const baixarPdfSeparacao = async () => {
    setDownloadingSeparationPdf(true);
    try {
      await abrirOuBaixarPdfSeparacao({
        pedidoId: detail._id,
        numeroPedido: detail.numeroPedido,
      });
    } catch {
      setDetailFeedback({ type: "error", message: "Não foi possível baixar o PDF de separação." });
    } finally {
      setDownloadingSeparationPdf(false);
    }
  };

  const baixarPdfComercialDetalhe = async () => {
    setDownloadingCommercialPdf(true);
    try {
      await baixarPdf(detail);
    } finally {
      setDownloadingCommercialPdf(false);
    }
  };

  const baixarRelatorioPedido = async () => {
    setDownloadingReportPdf(true);
    try {
      await abrirOuBaixarRelatorioPedido({
        pedidoId: detail._id,
        numeroPedido: detail.numeroPedido,
      });
    } catch {
      setDetailFeedback({ type: "error", message: "Não foi possível baixar o relatório operacional." });
    } finally {
      setDownloadingReportPdf(false);
    }
  };

  const abrirModalEdicao = (pedido) => {
    const mapa = {};

    pedido.itens.forEach((item) => {
      mapa[item.produtoId] = item.quantidade;
    });

    setModalPedido(pedido);
    setQuantidadesModal(mapa);
    setBuscaProduto("");
  };

  const editarPedidoDetalhado = () => {
    const pedido = detail;
    fecharDetalhes();
    abrirModalEdicao(pedido);
  };

  const alterarQuantidadeModal = (produtoId, quantidade) => {
    setQuantidadesModal({
      ...quantidadesModal,
      [produtoId]: quantidade,
    });
  };

  const fecharModal = () => {
    setModalPedido(null);
    setQuantidadesModal({});
    setBuscaProduto("");
  };
  const editOrderDialogRef = useModalDialog({
    open: Boolean(modalPedido),
    onClose: fecharModal,
  });
  useDialogVisualViewport(editOrderDialogRef, Boolean(modalPedido));
  useEffect(() => {
    if (!modalPedido || !buscaProduto || !window.matchMedia("(max-width: 768px)").matches) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const search = editOrderDialogRef.current?.querySelector(`.${styles.editSearch}`);
      if (!search) return;
      const body = search.parentElement;
      body.scrollTop += search.getBoundingClientRect().top - body.getBoundingClientRect().top;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [buscaProduto, modalPedido, editOrderDialogRef]);

  const salvarModalPedido = async () => {
    const itens = Object.entries(quantidadesModal)
      .filter(([, quantidade]) => Number(quantidade) > 0)
      .map(([produtoId, quantidade]) => ({
        produtoId,
        quantidade: Number(quantidade),
      }));

    if (itens.length === 0) {
      toast.warning("Pedido sem itens", {
        description: "Informe a quantidade de pelo menos um produto antes de salvar.",
      });
      return;
    }

    try {
      const response = await api.put(`/pedidos/${modalPedido._id}`, {
        itens,
        observacao: modalPedido.observacao || "",
        versaoPedido: Number(modalPedido.__v || 0),
      });
      atualizarPedidoNaLista(response.data.pedido);

      toast.success("Pedido atualizado", {
        description: `As alterações do pedido ${modalPedido.numeroPedido} foram salvas.`,
      });

      fecharModal();
    } catch (error) {
      console.error(error);
      toast.error("Não foi possível atualizar o pedido", {
        description: getApiErrorMessage(error, "Tente novamente em instantes."),
      });
    }
  };

  const excluirPedido = async (pedidoId) => {
    const pedido = detail?._id === pedidoId ? detail : pedidos.find((item) => item._id === pedidoId);
    setDeletingOrder(true);
    const excluido = await dialog.confirm({
      variant: "danger",
      icon: "trash",
      title: "Excluir pedido?",
      message: "O pedido será removido definitivamente. Essa ação não pode ser desfeita.",
      details: pedido?.numeroPedido ? [{ label: "Pedido", value: pedido.numeroPedido }] : [],
      confirmLabel: "Excluir pedido",
      busyLabel: "Excluindo pedido...",
      errorFallback: "Não foi possível excluir o pedido.",
      action: () => api.delete(`/pedidos/${pedidoId}`),
      successToast: { title: "Pedido excluído", description: pedido?.numeroPedido ? `O pedido ${pedido.numeroPedido} foi removido.` : "" },
    });
    setDeletingOrder(false);
    if (!excluido) return;
    fecharDetalhes();
    carregarDados();
  };

  const pedidosFiltrados = pedidos.filter((pedido) => {
    const textoBusca = busca.toLowerCase();

    const combinaBusca =
      pedido.numeroPedido?.toLowerCase().includes(textoBusca) ||
      pedido.nomeFantasiaCliente?.toLowerCase().includes(textoBusca) ||
      pedido.razaoSocialCliente?.toLowerCase().includes(textoBusca);

    const combinaStatus = statusFiltro ? pedido.status === statusFiltro : true;

    return combinaBusca && combinaStatus;
  });

  const produtosFiltradosModal = produtos.filter((produto) =>
    produto.nome.toLowerCase().includes(buscaProduto.toLowerCase())
  );

  const quantidadeTotalModal = Object.values(quantidadesModal).reduce(
    (total, qtd) => total + Number(qtd || 0),
    0
  );

  return (
    <>
      <Navbar />

      <div className={styles.container}>
        <h1>Pedidos</h1>
        {hasPermission(usuario, "criarPedidos") && <Link className={styles.novoPedido} to="/pedidos/novo">Novo pedido</Link>}

        {pedidos.length === 0 && <p>Nenhum pedido encontrado.</p>}

        <FilterToolbar
          activeFilterCount={statusFiltro ? 1 : 0}
          searchLabel="Buscar pedidos"
          searchPlaceholder="Buscar por número do pedido ou cliente..."
          searchValue={busca}
          onSearchChange={(event) => setBusca(event.target.value)}
          onSubmit={(event) => event.preventDefault()}
          onClear={() => {
            setBusca("");
            setStatusFiltro("");
          }}
        >
          <select
            aria-label="Filtrar por status"
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
        </FilterToolbar>

        <div className={styles.lista}>
          {pedidosFiltrados.map((pedido) => (
            <div className={styles.card} key={pedido._id}>
              <div>
                <h3>{pedido.numeroPedido}</h3>
                <p>Cliente: {pedido.nomeFantasiaCliente || "-"}</p>
                <p>Razão Social: {pedido.razaoSocialCliente || "-"}</p>
                <p>CNPJ: {pedido.cnpjCliente || "-"}</p>
                <p>Data: {data(pedido)}</p>

                <span
                  className={styles.statusBadge}
                  data-status={pedido.status === "retirado" ? "retirado" : pedido.entregaFinalizada ? "entregue" : pedido.status}
                >
                  {formatarStatus(pedido.status === "retirado" ? "retirado" : pedido.entregaFinalizada ? "entregue" : pedido.status)}
                </span>

                <strong>Total: {moeda(pedido.valorTotal)}</strong>
              </div>

              <div className={styles.acoesPedido}>
                <button
                  className={styles.visualizarBtn}
                  disabled={detailLoading}
                  onClick={() => abrirDetalhes(pedido._id)}
                >
                  Visualizar pedido
                </button>

              </div>
            </div>
          ))}
        </div>

        {detail && operationsForm && (
          <OrderDetailModal
            detail={detail}
            form={operationsForm}
            transitions={transitions}
            isAdmin={isAdmin}
            showPrices
            canApprove={hasPermission(usuario, "aprovarPedidos")}
            canEdit={hasPermission(usuario, "editarPedidos") && (hasGlobalScope(usuario) || ["aguardando_aprovacao", "novo", "em_analise"].includes(detail.status))}
            canDelete={hasPermission(usuario, "excluirPedidos")}
            canOperate={isAdmin}
            saving={savingOperations}
            conferenceBusy={conferenceBusy}
            approving={approving}
            downloadingPdf={downloadingSeparationPdf}
            downloadingCommercialPdf={downloadingCommercialPdf}
            downloadingReportPdf={downloadingReportPdf}
            deleting={deletingOrder}
            adminActionBusy={adminActionBusy}
            onMarkShipped={() => registrarSaidaAdmin("enviado")}
            onMarkCollected={() => registrarSaidaAdmin("retirado")}
            feedback={detailFeedback}
            onClose={fecharDetalhes}
            onSubmit={salvarOperacao}
            onFieldChange={alterarCampoOperacional}
            onSeparationChange={alterarSeparacao}
            onConferenceChange={alterarConferencia}
            onStartConference={iniciarConferencia}
            onCompleteConference={concluirConferencia}
            onApprove={aprovarPedido}
            onDownloadSeparationPdf={baixarPdfSeparacao}
            onDownloadCommercialPdf={baixarPdfComercialDetalhe}
            onDownloadReportPdf={baixarRelatorioPedido}
            onEditOrder={editarPedidoDetalhado}
            onDeleteOrder={() => excluirPedido(detail._id)}
          />
        )}

        {modalPedido && (
          <div className={styles.modalOverlay} onMouseDown={(event) => {
            if (event.target === event.currentTarget) fecharModal();
          }}>
            <section
              ref={editOrderDialogRef}
              className={styles.modal}
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-order-title"
              tabIndex="-1"
            >
              <div className={styles.modalHeader}>
                <div>
                  <h2 id="edit-order-title">Editar Pedido</h2>
                  <p>{modalPedido.numeroPedido}</p>
                </div>

                <button type="button" aria-label="Fechar edição do pedido" onClick={fecharModal}>Fechar</button>
              </div>

              <div className={styles.modalBody}>
                <div className={styles.modalInfo}>
                  <strong>{modalPedido.nomeFantasiaCliente || "-"}</strong>
                  <span>Total de itens: {quantidadeTotalModal}</span>
                </div>

                <div className={styles.editSearch} onFocusCapture={(event) => {
                  if (!window.matchMedia("(max-width: 768px)").matches) return;
                  const search = event.currentTarget;
                  const body = search.parentElement;
                  window.requestAnimationFrame(() => {
                    if (body.isConnected) body.scrollTop += search.getBoundingClientRect().top - body.getBoundingClientRect().top;
                  });
                }}>
                  <FilterToolbar
                    layout="stacked"
                    searchLabel="Buscar produtos do pedido"
                    searchPlaceholder="Buscar por produto..."
                    searchValue={buscaProduto}
                    onSearchChange={(event) => setBuscaProduto(event.target.value)}
                    onSubmit={(event) => event.preventDefault()}
                    onClear={() => setBuscaProduto("")}
                  />
                </div>

                <div className={styles.listaProdutosModal}>
                  <p className={styles.resultSummary} role="status">
                    {produtosFiltradosModal.length} produtos encontrados. Informe a quantidade para incluir; use 0 para remover.
                  </p>
                  {produtosFiltradosModal.map((produto) => (
                    <div className={styles.produtoModal} key={produto._id}>
                      <label className={styles.productName} htmlFor={`edit-order-product-${produto._id}`}>
                        <strong>{produto.nome}</strong>
                        <span>{produto.linha} • {produto.categoria}</span>
                      </label>

                      <label className={styles.quantityField}>
                        <span>Quantidade</span>
                        <input
                          id={`edit-order-product-${produto._id}`}
                          type="number"
                          inputMode="numeric"
                          step="1"
                          aria-label={`Quantidade de ${produto.nome}`}
                          min="0"
                          value={quantidadesModal[produto._id] ?? ""}
                          placeholder="0"
                          onChange={(e) => alterarQuantidadeModal(produto._id, e.target.value)}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.secundario}
                  onClick={fecharModal}
                >
                  Cancelar
                </button>

                <button type="button" onClick={salvarModalPedido}>
                  Salvar Alterações
                </button>
              </div>

            </section>
          </div>
        )}
      </div>
    </>
  );
}

export default AdminPedidos;
