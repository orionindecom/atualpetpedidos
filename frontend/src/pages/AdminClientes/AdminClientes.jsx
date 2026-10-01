import { useEffect, useMemo, useRef, useState } from "react";
import api from "../../api/axios";
import ClientDetailModal from "../../components/ClientDetails/ClientDetailModal";
import { FilterToolbar } from "../../components/ListControls/ListControls";
import Navbar from "../../components/Navbar/Navbar";
import { useFeedback } from "../../components/Feedback/feedbackContext";
import {
  buildAdminClientForm,
  buildAdminClientPayload,
  formatClientDocument,
  getApprovalStatus,
  getClientAccountTypeLabel,
  getClientDisplayName,
  getClientDocumentLabel,
  getClientTableId,
  isClientAccountActive,
  isGroomerAccount,
} from "../../utils/clientAdmin";
import styles from "./AdminClientes.module.css";

const normalizarTexto = (texto = "") =>
  String(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\D/g, (char) => char);

const normalizarDocumento = (texto = "") => String(texto).replace(/\D/g, "");

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("pt-BR").format(date);
};

const getErrorMessage = (error, fallback) => {
  const validationErrors = error.response?.data?.errors;
  if (validationErrors && typeof validationErrors === "object") {
    return Object.values(validationErrors).filter(Boolean).join(" ");
  }
  return error.response?.data?.message || fallback;
};

const statusClass = (client) => {
  if (!isClientAccountActive(client)) return styles.statusInactive;
  const status = getApprovalStatus(client);
  if (status === "aprovado") return styles.statusApproved;
  if (status === "reprovado") return styles.statusRejected;
  return styles.statusPending;
};

const statusLabel = (client) => {
  const approval = getApprovalStatus(client);
  const labels = { pendente: "Pendente", aprovado: "Aprovado", reprovado: "Reprovado" };
  return labels[approval] || approval || "Pendente";
};

function AdminClientes() {
  const [clientes, setClientes] = useState([]);
  const [tabelas, setTabelas] = useState([]);
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState("");
  const [contaFiltro, setContaFiltro] = useState("");
  const [tabelaFiltro, setTabelaFiltro] = useState("");
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [clientDetail, setClientDetail] = useState(null);
  const [form, setForm] = useState(buildAdminClientForm());
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const detailRequestRef = useRef(0);
  const { dialog } = useFeedback();

  useEffect(() => {
    let active = true;

    async function carregarDadosIniciais() {
      try {
        const [clientesResponse, tabelasResponse] = await Promise.all([
          api.get("/clientes"),
          api.get("/tabelas"),
        ]);
        if (!active) return;
        setClientes(clientesResponse.data);
        setTabelas(tabelasResponse.data);
      } catch (error) {
        if (active) setPageError(getErrorMessage(error, "Não foi possível carregar os clientes."));
      } finally {
        if (active) setLoading(false);
      }
    }

    carregarDadosIniciais();
    return () => {
      active = false;
    };
  }, []);

  const clientesFiltrados = useMemo(() => {
    const termo = normalizarTexto(busca.trim());
    const termoDocumento = normalizarDocumento(busca);

    return clientes.filter((cliente) => {
      const camposTexto = [
        cliente.nomeResponsavel,
        cliente.nomeFantasia,
        cliente.razaoSocial,
        cliente.nomeProfissional,
        cliente.cidade,
        cliente.estado,
      ].map(normalizarTexto).join(" ");
      const document = normalizarDocumento(cliente.cnpj);

      const matchesSearch = (!termo && !termoDocumento) ||
        camposTexto.includes(termo) ||
        Boolean(termoDocumento && document.includes(termoDocumento));
      const accountStatus = isClientAccountActive(cliente) ? "ativo" : "inativo";
      const matchesStatus = !statusFiltro || getApprovalStatus(cliente) === statusFiltro;
      const matchesType = !tipoFiltro || cliente.tipo === tipoFiltro;
      const matchesAccount = !contaFiltro || accountStatus === contaFiltro;
      const matchesTable = !tabelaFiltro || getClientTableId(cliente) === tabelaFiltro;
      return matchesSearch && matchesStatus && matchesType && matchesAccount && matchesTable;
    });
  }, [busca, clientes, contaFiltro, statusFiltro, tabelaFiltro, tipoFiltro]);

  const indicators = useMemo(() => ({
    total: clientes.length,
    distributors: clientes.filter((client) => !isGroomerAccount(client)).length,
    groomers: clientes.filter(isGroomerAccount).length,
    pending: clientes.filter((client) => getApprovalStatus(client) === "pendente").length,
  }), [clientes]);

  const atualizarClienteLocal = (updatedClient) => {
    setClientes((current) => current.map((client) => (
      client._id === updatedClient._id ? updatedClient : client
    )));
    setClientDetail(updatedClient);
    setForm(buildAdminClientForm(updatedClient));
  };

  const abrirCliente = async (clientId) => {
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    setSelectedClientId(clientId);
    setClientDetail(null);
    setForm(buildAdminClientForm());
    setEditing(false);
    setFeedback(null);
    setDetailLoading(true);
    try {
      const response = await api.get(`/clientes/${clientId}`);
      if (requestId !== detailRequestRef.current) return;
      const loadedClient = response.data?.cliente;
      if (!loadedClient) {
        setFeedback({ type: "error", message: "A API não retornou os dados do cliente." });
        return;
      }
      setClientDetail(loadedClient);
      setForm(buildAdminClientForm(loadedClient));
    } catch (error) {
      if (requestId === detailRequestRef.current) {
        setFeedback({ type: "error", message: getErrorMessage(error, "Erro ao carregar cliente.") });
      }
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  };

  const fecharDetalhe = () => {
    detailRequestRef.current += 1;
    setSelectedClientId("");
    setClientDetail(null);
    setForm(buildAdminClientForm());
    setDetailLoading(false);
    setEditing(false);
    setFeedback(null);
  };

  const iniciarEdicao = () => {
    setForm(buildAdminClientForm(clientDetail));
    setFeedback(null);
    setEditing(true);
  };

  const cancelarEdicao = () => {
    setForm(buildAdminClientForm(clientDetail));
    setFeedback(null);
    setEditing(false);
  };

  const alterarCampo = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const salvarCliente = async (event) => {
    event.preventDefault();
    const payload = buildAdminClientPayload(form, clientDetail);
    if (Object.keys(payload).length === 0) {
      setFeedback({ type: "error", message: "Nenhuma alteração foi informada." });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const response = await api.patch(`/clientes/${selectedClientId}`, payload);
      atualizarClienteLocal(response.data.cliente);
      setEditing(false);
      setFeedback({ type: "success", message: response.data.message });
    } catch (error) {
      setFeedback({ type: "error", message: getErrorMessage(error, "Erro ao salvar cliente.") });
    } finally {
      setSaving(false);
    }
  };

  const aprovarCliente = async () => {
    const isGroomer = isGroomerAccount(clientDetail);
    const tabelaPrecoId = getClientTableId(clientDetail);
    if (!isGroomer && !tabelaPrecoId) {
      setFeedback({
        type: "error",
        message: "Selecione e salve uma tabela de preços antes de aprovar o cliente.",
      });
      return;
    }

    setActionBusy(true);
    setFeedback(null);
    try {
      const response = await api.put(
        `/clientes/${selectedClientId}/aprovar`,
        isGroomer ? {} : { tabelaPrecoId }
      );
      atualizarClienteLocal(response.data.cliente);
      setFeedback({ type: "success", message: response.data.message });
    } catch (error) {
      setFeedback({ type: "error", message: getErrorMessage(error, "Erro ao aprovar cliente.") });
    } finally {
      setActionBusy(false);
    }
  };

  // Ações de conta passam pelo diálogo da Central: a requisição acontece dentro dele
  // (com carregamento e erro no próprio diálogo) e o resultado aparece no cadastro aberto.
  const executarAcaoConta = async (options, request) => {
    let resultado = null;
    setActionBusy(true);
    setFeedback(null);
    const concluido = await dialog.confirm({
      ...options,
      action: async (valor) => {
        resultado = (await request(valor)).data;
      },
    });
    setActionBusy(false);
    if (!concluido || !resultado) return;
    if (resultado.cliente) atualizarClienteLocal(resultado.cliente);
    setFeedback({ type: "success", message: resultado.message });
  };

  const rejeitarCliente = () => executarAcaoConta({
    variant: "warning",
    icon: "fileX",
    title: "Recusar cadastro?",
    message: `${getClientDisplayName(clientDetail)} não terá acesso à Central enquanto o cadastro estiver recusado.`,
    details: [{ label: "Perfil", value: getClientAccountTypeLabel(clientDetail) }],
    confirmLabel: "Recusar cadastro",
    busyLabel: "Recusando...",
    errorFallback: "Não foi possível recusar o cadastro.",
  }, () => api.put(`/clientes/${selectedClientId}/rejeitar`));

  const alternarAcesso = () => {
    const active = isClientAccountActive(clientDetail);
    const action = active ? "desativar" : "reativar";
    const nome = getClientDisplayName(clientDetail);
    return executarAcaoConta(active ? {
      variant: "warning",
      icon: "lock",
      title: "Desativar acesso?",
      message: `${nome} não conseguirá entrar na Central até o acesso ser reativado.`,
      confirmLabel: "Desativar acesso",
      busyLabel: "Desativando...",
      errorFallback: "Não foi possível desativar o acesso.",
    } : {
      variant: "confirm",
      icon: "userCheck",
      title: "Reativar acesso?",
      message: `${nome} voltará a entrar na Central com a senha atual.`,
      confirmLabel: "Reativar acesso",
      busyLabel: "Reativando...",
      errorFallback: "Não foi possível reativar o acesso.",
    }, () => api.put(`/clientes/${selectedClientId}/${action}`));
  };

  const redefinirSenha = () => executarAcaoConta({
    variant: "confirm",
    icon: "key",
    title: "Redefinir senha",
    message: `Defina uma nova senha de acesso para ${getClientDisplayName(clientDetail)}.`,
    field: {
      label: "Nova senha",
      type: "password",
      autoComplete: "new-password",
      minLength: 8,
      maxLength: 128,
      requiredMessage: "Informe a nova senha.",
      help: "Mínimo de 8 caracteres. Compartilhe a senha por um canal seguro.",
    },
    confirmLabel: "Redefinir senha",
    busyLabel: "Redefinindo...",
    errorFallback: "Não foi possível redefinir a senha.",
  }, (novaSenha) => api.put(`/clientes/${selectedClientId}/redefinir-senha`, { novaSenha }));

  return (
    <>
      <Navbar />
      <main className={styles.container}>
        <header className={styles.pageHeader}>
          <span>Relacionamento</span>
          <h1>Clientes e Groomers</h1>
          <p>Consulte cadastros, aprove perfis e gerencie o acesso ao portal.</p>
        </header>

        <section className={styles.indicators} aria-label="Resumo dos cadastros">
          <div><span>Total de cadastros</span><strong>{indicators.total}</strong></div>
          <div><span>Distribuidores</span><strong>{indicators.distributors}</strong></div>
          <div><span>Groomers</span><strong>{indicators.groomers}</strong></div>
          <div><span>Pendentes</span><strong>{indicators.pending}</strong></div>
        </section>

        <FilterToolbar
          activeFilterCount={
            Number(Boolean(statusFiltro)) +
            Number(Boolean(tipoFiltro)) +
            Number(Boolean(contaFiltro)) +
            Number(Boolean(tabelaFiltro))
          }
          searchLabel="Buscar cadastro"
          searchPlaceholder="Buscar por nome, CPF/CNPJ, empresa ou cidade..."
          searchValue={busca}
          onSearchChange={(event) => setBusca(event.target.value)}
          onSubmit={(event) => event.preventDefault()}
          onClear={() => {
            setBusca("");
            setStatusFiltro("");
            setTipoFiltro("");
            setContaFiltro("");
            setTabelaFiltro("");
          }}
        >
          <select
            aria-label="Filtrar cadastros por tipo"
            value={tipoFiltro}
            onChange={(event) => setTipoFiltro(event.target.value)}
          >
            <option value="">Todos os perfis</option>
            <option value="cliente">Distribuidores</option>
            <option value="groomer">Groomers</option>
          </select>
          <select
            aria-label="Filtrar clientes por status"
            value={statusFiltro}
            onChange={(event) => setStatusFiltro(event.target.value)}
          >
            <option value="">Todos os status</option>
            <option value="pendente">Pendentes</option>
            <option value="aprovado">Aprovados</option>
            <option value="reprovado">Rejeitados</option>
          </select>
          <select
            aria-label="Filtrar clientes por situação da conta"
            value={contaFiltro}
            onChange={(event) => setContaFiltro(event.target.value)}
          >
            <option value="">Todas as contas</option>
            <option value="ativo">Ativas</option>
            <option value="inativo">Inativas</option>
          </select>
          <select
            aria-label="Filtrar clientes por tabela de preços"
            value={tabelaFiltro}
            onChange={(event) => setTabelaFiltro(event.target.value)}
          >
            <option value="">Todas as tabelas</option>
            {tabelas.map((table) => (
              <option key={table._id} value={table._id}>{table.nome}</option>
            ))}
          </select>
        </FilterToolbar>

        {pageError && <p className={styles.errorMessage} role="alert">{pageError}</p>}
        {loading && <p className={styles.emptyMessage}>Carregando clientes...</p>}
        {!loading && !pageError && clientes.length === 0 && (
          <p className={styles.emptyMessage}>Não há clientes cadastrados.</p>
        )}
        {!loading && clientes.length > 0 && clientesFiltrados.length === 0 && (
          <p className={styles.emptyMessage}>Nenhum cliente encontrado para a busca informada.</p>
        )}

        <div className={styles.list}>
          {clientesFiltrados.map((cliente) => {
            const table = typeof cliente.tabelaPrecoId === "object" ? cliente.tabelaPrecoId : null;
            const accountActive = isClientAccountActive(cliente);
            return (
              <article className={`${styles.card} ${statusClass(cliente)}`} key={cliente._id}>
                <div className={styles.clientInfo}>
                  <div className={styles.cardHeading}>
                    <div>
                      <h2>{getClientDisplayName(cliente)}</h2>
                      <p>{isGroomerAccount(cliente)
                        ? [cliente.cidade, cliente.estado].filter(Boolean).join(" / ") || "Localização não informada"
                        : cliente.razaoSocial || "Razão social não informada"}</p>
                    </div>
                    <div className={styles.badges}>
                      <span className={styles.typeBadge} data-type={cliente.tipo}>
                        {getClientAccountTypeLabel(cliente)}
                      </span>
                      <span className={styles.statusBadge} data-status={getApprovalStatus(cliente)}>
                        {statusLabel(cliente)}
                      </span>
                      <span className={styles.accountBadge} data-active={accountActive}>
                        Acesso {accountActive ? "ativo" : "inativo"}
                      </span>
                    </div>
                  </div>
                  <dl className={styles.summary}>
                    <div><dt>Responsável</dt><dd>{cliente.nomeResponsavel || "—"}</dd></div>
                    <div>
                      <dt>{getClientDocumentLabel(cliente.cnpj)}</dt>
                      <dd>{formatClientDocument(cliente.cnpj) || "—"}</dd>
                    </div>
                    <div>
                      <dt>{isGroomerAccount(cliente) ? "Localização" : "Tabela atual"}</dt>
                      <dd>{isGroomerAccount(cliente)
                        ? [cliente.cidade, cliente.estado].filter(Boolean).join(" / ") || "—"
                        : table?.nome || "Não definida"}</dd>
                    </div>
                    <div><dt>Cadastro</dt><dd>{formatDate(cliente.createdAt)}</dd></div>
                  </dl>
                </div>
                <button
                  type="button"
                  className={styles.viewButton}
                  onClick={() => abrirCliente(cliente._id)}
                >
                  Ver cadastro
                </button>
              </article>
            );
          })}
        </div>
      </main>

      {selectedClientId && (
        <ClientDetailModal
          client={clientDetail}
          form={form}
          tables={tabelas}
          loading={detailLoading}
          editing={editing}
          saving={saving}
          actionBusy={actionBusy}
          feedback={feedback}
          onClose={fecharDetalhe}
          onStartEdit={iniciarEdicao}
          onCancelEdit={cancelarEdicao}
          onSubmit={salvarCliente}
          onFieldChange={alterarCampo}
          onApprove={aprovarCliente}
          onReject={rejeitarCliente}
          onToggleActive={alternarAcesso}
          onResetPassword={redefinirSenha}
          onClientChange={({ _id, vendedorResponsavelId }) => {
            setClientes((current) => current.map((client) => (
              client._id === _id ? { ...client, vendedorResponsavelId } : client
            )));
            setClientDetail((current) => (current?._id === _id ? { ...current, vendedorResponsavelId } : current));
          }}
        />
      )}
    </>
  );
}

export default AdminClientes;
