import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../api/axios";
import EmptyState from "../../components/AdminUi/EmptyState";
import ui from "../../components/AdminUi/AdminUi.module.css";
import { FilterToolbar } from "../../components/ListControls/ListControls";
import Navbar from "../../components/Navbar/Navbar";
import PageHeader from "../../components/PageHeader/PageHeader";
import { useModalDialog } from "../../hooks/useModalDialog";
import { getApiErrorMessage } from "../../utils/apiErrors";
import { getAuthSession } from "../../utils/authSession";
import { formatClientDocument } from "../../utils/clientAdmin";
import { formatCurrency, formatOrderDate, formatOrderStatus } from "../../utils/orderLogistics";
import { hasGlobalScope, hasPermission } from "../../utils/permissions";
import { getClientName } from "../../utils/sellerAssignment";
import OrderStatusBadge from "../ContaDashboard/OrderStatusBadge";
import styles from "./Carteira.module.css";

const normalize = (value) => String(value || "")
  .toLocaleLowerCase("pt-BR")
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "");

function ClientOrdersModal({ clientId, canCreate, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const dialogRef = useModalDialog({ onClose });

  useEffect(() => {
    let active = true;
    api.get(`/carteira/${clientId}`)
      .then((response) => { if (active) setData(response.data); })
      .catch((requestError) => {
        if (active) setError(getApiErrorMessage(requestError, "Não foi possível abrir este cliente."));
      });
    return () => { active = false; };
  }, [clientId]);

  const cliente = data?.cliente;
  return (
    <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="carteira-cliente-titulo" tabIndex="-1">
        <header className={styles.modalHeader}>
          <div>
            <span>Cliente</span>
            <h2 id="carteira-cliente-titulo">{cliente ? getClientName(cliente) : "Carregando cliente"}</h2>
          </div>
          <button type="button" className={ui.secondaryButton} onClick={onClose}>Fechar</button>
        </header>
        <div className={styles.modalContent}>
          {error ? (
            <div className={ui.feedback} data-type="error" role="alert">{error}</div>
          ) : !data ? (
            <p className={styles.loading} role="status">Carregando dados e pedidos...</p>
          ) : (
            <>
              <dl className={styles.details}>
                <div><dt>Razão social</dt><dd>{cliente.razaoSocial || "—"}</dd></div>
                <div><dt>CPF/CNPJ</dt><dd>{formatClientDocument(cliente.cnpj) || "—"}</dd></div>
                <div><dt>Responsável</dt><dd>{cliente.nomeResponsavel || "—"}</dd></div>
                <div><dt>Contato</dt><dd>{[cliente.telefone || cliente.whatsapp, cliente.email].filter(Boolean).join(" — ") || "—"}</dd></div>
                <div><dt>Cidade</dt><dd>{[cliente.cidade, cliente.estado].filter(Boolean).join("/") || "—"}</dd></div>
              </dl>
              <div className={styles.ordersHeading}>
                <h3>Pedidos</h3>
                {canCreate && <Link className={ui.primaryButton} to={`/pedidos/novo?cliente=${cliente._id}`}>Novo pedido</Link>}
              </div>
              {data.pedidos.length === 0 ? (
                <EmptyState headingLevel={3} title="Nenhum pedido ainda" description="Os pedidos deste cliente aparecerão aqui." />
              ) : (
                <ul className={styles.orders}>
                  {data.pedidos.map((pedido) => (
                    <li key={pedido._id}>
                      <Link to={`/pedidos?pedido=${pedido._id}`}>{pedido.numeroPedido}</Link>
                      <span>{formatOrderDate(pedido.dataPedido || pedido.createdAt)}</span>
                      <OrderStatusBadge status={pedido.status} label={formatOrderStatus(pedido.status)} />
                      <strong>{formatCurrency(pedido.valorTotal)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Carteira() {
  const usuario = getAuthSession()?.usuario;
  const global = hasGlobalScope(usuario);
  const podeCriar = hasPermission(usuario, "criarPedidos");
  const podeGerenciar = hasPermission(usuario, "usuarios");
  const [clientes, setClientes] = useState(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    api.get("/carteira")
      .then(({ data }) => { if (active) { setClientes(Array.isArray(data) ? data : []); setErro(""); } })
      .catch((error) => { if (active) setErro(getApiErrorMessage(error, "Não foi possível carregar os clientes.")); });
    return () => { active = false; };
  }, [reload]);

  const filtrados = useMemo(() => {
    const term = normalize(busca.trim());
    const digits = busca.replace(/\D/g, "");
    return (clientes || []).filter((cliente) => !term ||
      normalize([cliente.nomeFantasia, cliente.razaoSocial, cliente.nomeResponsavel, cliente.cidade, cliente.estado].join(" ")).includes(term) ||
      Boolean(digits && String(cliente.cnpj || "").replace(/\D/g, "").includes(digits)));
  }, [busca, clientes]);

  const title = global ? "Clientes" : "Minha carteira";
  const description = global
    ? "Todos os distribuidores da Central, com acesso aos pedidos de cada um."
    : "Distribuidores atribuídos a você e seus pedidos.";

  return (
    <>
      <Navbar />
      <main className={ui.container}>
        <PageHeader
          eyebrow={global ? "Comercial" : "Vendas"}
          title={title}
          description={description}
          action={podeCriar && clientes?.length ? <Link className={ui.primaryButton} to="/pedidos/novo">Novo pedido</Link> : null}
        />

        {erro ? (
          <section className={ui.panel}>
            <div className={ui.stateBox} role="alert">
              <h2>Não foi possível carregar os clientes</h2>
              <p>{erro}</p>
              <button type="button" className={`${ui.secondaryButton} ${styles.retry}`} onClick={() => { setClientes(null); setErro(""); setReload((value) => value + 1); }}>
                Tentar novamente
              </button>
            </div>
          </section>
        ) : clientes && clientes.length === 0 ? (
          <section className={ui.panel}>
            <EmptyState
              icon="clients"
              title={global ? "Nenhum cliente cadastrado" : "Nenhum cliente atribuído"}
              description={global
                ? "Quando distribuidores forem aprovados, eles aparecerão aqui."
                : "Sua carteira ainda não possui clientes. Quando um administrador atribuir distribuidores a você, eles aparecerão aqui."}
              action={podeGerenciar && !global ? <Link className={ui.secondaryButton} to="/usuarios">Gerenciar carteiras</Link> : null}
            />
          </section>
        ) : (
          <>
            <FilterToolbar
              searchLabel="Buscar cliente"
              searchPlaceholder="Buscar por nome, CNPJ ou cidade..."
              searchValue={busca}
              onSearchChange={(event) => setBusca(event.target.value)}
              onSubmit={(event) => event.preventDefault()}
              onClear={() => setBusca("")}
            />
            <div className={ui.listMeta}>
              <strong>{clientes ? `${filtrados.length} ${filtrados.length === 1 ? "cliente" : "clientes"}` : "Carregando clientes"}</strong>
              {clientes && !global && <span>{clientes.length} na sua carteira</span>}
            </div>
            <section className={ui.panel} aria-label={title} aria-busy={!clientes}>
              {!clientes ? (
                [1, 2, 3].map((item) => <div className={ui.skeletonRow} key={item} />)
              ) : filtrados.length === 0 ? (
                <EmptyState icon="search" title="Nenhum cliente encontrado" description="Ajuste a busca para ver outros clientes." />
              ) : (
                <ul className={styles.list}>
                  {filtrados.map((cliente) => (
                    <li key={cliente._id} className={styles.row}>
                      <div className={styles.client}>
                        <strong>{getClientName(cliente)}</strong>
                        <span>{[cliente.razaoSocial, formatClientDocument(cliente.cnpj)].filter(Boolean).join(" — ")}</span>
                      </div>
                      <div className={styles.meta}>
                        <span>{[cliente.cidade, cliente.estado].filter(Boolean).join("/") || "—"}</span>
                        <small>{cliente.telefone || cliente.whatsapp || cliente.email}</small>
                      </div>
                      <div className={styles.actions}>
                        <button type="button" className={ui.secondaryButton} onClick={() => setAberto(cliente._id)}>
                          Ver pedidos
                        </button>
                        {podeCriar && (
                          <Link className={ui.ghostButton} to={`/pedidos/novo?cliente=${cliente._id}`} aria-label={`Novo pedido para ${getClientName(cliente)}`}>
                            Novo pedido
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
      {aberto && <ClientOrdersModal clientId={aberto} canCreate={podeCriar} onClose={() => setAberto("")} />}
    </>
  );
}

export default Carteira;
