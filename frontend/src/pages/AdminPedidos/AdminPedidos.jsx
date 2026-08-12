import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../../api/axios";
import { FilterToolbar } from "../../components/ListControls/ListControls";
import Navbar from "../../components/Navbar/Navbar";
import OrderDetailModal from "../../components/OrderDetails/OrderDetailModal";
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
} from "../../utils/orderOperations";

function AdminPedidos() {
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
      alert("Não foi possível abrir ou baixar o PDF do pedido.");
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
      const response = await api.get(`/logistica/pedidos/${pedidoId}`);
      setDetail(response.data.pedido);
      setTransitions(response.data.transicoesPermitidas || []);
      setOperationsForm(buildOrderOperationsForm(response.data.pedido));
    } catch (error) {
      alert(error.response?.data?.message || "Não foi possível abrir o pedido");
    } finally {
      setDetailLoading(false);
    }
  }, []);

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

  const alterarSeparacao = (produtoId, value) => {
    setOperationsForm((current) => ({
      ...current,
      separacao: { ...current.separacao, [produtoId]: value },
    }));
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
      setTransitions(["separando"]);
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

  const salvarModalPedido = async () => {
    const itens = Object.entries(quantidadesModal)
      .filter(([, quantidade]) => Number(quantidade) > 0)
      .map(([produtoId, quantidade]) => ({
        produtoId,
        quantidade: Number(quantidade),
      }));

    if (itens.length === 0) {
      alert("O pedido precisa ter pelo menos um item");
      return;
    }

    try {
      await api.put(`/pedidos/${modalPedido._id}`, {
        itens,
        observacao: modalPedido.observacao || "",
      });

      alert("Pedido atualizado com sucesso");

      fecharModal();
      carregarDados();
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || "Erro ao atualizar pedido");
    }
  };

  const excluirPedido = async (pedidoId) => {
    const confirmar = confirm(
      "Deseja realmente excluir este pedido? Essa ação não pode ser desfeita."
    );

    if (!confirmar) return;

    setDeletingOrder(true);
    try {
      await api.delete(`/pedidos/${pedidoId}`);

      alert("Pedido excluído com sucesso");
      fecharDetalhes();
      carregarDados();
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || "Erro ao excluir pedido");
    } finally {
      setDeletingOrder(false);
    }
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
                  data-status={pedido.entregaFinalizada ? "entregue" : pedido.status}
                >
                  {formatarStatus(pedido.entregaFinalizada ? "entregue" : pedido.status)}
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
            isAdmin
            saving={savingOperations}
            conferenceBusy={conferenceBusy}
            approving={approving}
            downloadingPdf={downloadingSeparationPdf}
            downloadingCommercialPdf={downloadingCommercialPdf}
            downloadingReportPdf={downloadingReportPdf}
            deleting={deletingOrder}
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
          <div className={styles.modalOverlay}>
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <div>
                  <h2>Editar Pedido</h2>
                  <p>{modalPedido.numeroPedido}</p>
                </div>

                <button onClick={fecharModal}>Fechar</button>
              </div>

              <div className={styles.modalInfo}>
                <strong>{modalPedido.nomeFantasiaCliente || "-"}</strong>
                <span>Total de itens: {quantidadeTotalModal}</span>
              </div>

              <FilterToolbar
                layout="stacked"
                searchLabel="Buscar produtos do pedido"
                searchPlaceholder="Buscar por produto..."
                searchValue={buscaProduto}
                onSearchChange={(event) => setBuscaProduto(event.target.value)}
                onSubmit={(event) => event.preventDefault()}
                onClear={() => setBuscaProduto("")}
              />

              <div className={styles.listaProdutosModal}>
                {produtosFiltradosModal.map((produto) => (
                  <div className={styles.produtoModal} key={produto._id}>
                    <div>
                      <strong>{produto.nome}</strong>
                      <span>
                        {produto.linha} • {produto.categoria}
                      </span>
                    </div>

                    <input
                      type="number"
                      min="0"
                      value={quantidadesModal[produto._id] || ""}
                      placeholder="0"
                      onChange={(e) =>
                        alterarQuantidadeModal(produto._id, e.target.value)
                      }
                    />
                  </div>
                ))}
              </div>

              <div className={styles.modalFooter}>
                <button
                  className={styles.secundario}
                  onClick={fecharModal}
                >
                  Cancelar
                </button>

                <button onClick={salvarModalPedido}>
                  Salvar Alterações
                </button>
              </div>

            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default AdminPedidos;
