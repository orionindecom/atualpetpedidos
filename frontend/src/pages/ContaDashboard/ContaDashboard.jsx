import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../api/axios";
import EmptyState from "../../components/AdminUi/EmptyState";
import ui from "../../components/AdminUi/AdminUi.module.css";
import Navbar from "../../components/Navbar/Navbar";
import PageHeader from "../../components/PageHeader/PageHeader";
import { getApiErrorMessage } from "../../utils/apiErrors";
import { getAuthSession } from "../../utils/authSession";
import { formatCurrency, formatOrderDate, formatOrderStatus } from "../../utils/orderLogistics";
import { canOpenRoute, hasGlobalScope, hasPermission } from "../../utils/permissions";
import OrderStatusBadge from "./OrderStatusBadge";
import { summarizeOrders } from "./orderSummary";
import styles from "./ContaDashboard.module.css";

function RecentOrders({ pedidos, destino, showClient }) {
  return (
    <ul className={styles.orders} data-client={Boolean(showClient)}>
      {pedidos.map((pedido) => (
        <li key={pedido._id}>
          <div className={styles.orderId}>
            <Link to={`${destino}?pedido=${pedido._id}`}>{pedido.numeroPedido}</Link>
            <span>{showClient ? (pedido.nomeFantasiaCliente || pedido.razaoSocialCliente || "Cliente") : formatOrderDate(pedido.dataPedido || pedido.createdAt)}</span>
          </div>
          {showClient && <span className={styles.orderDate}>{formatOrderDate(pedido.dataPedido || pedido.createdAt)}</span>}
          <OrderStatusBadge status={pedido.status} label={formatOrderStatus(pedido.status)} />
          <strong className={styles.orderTotal}>{formatCurrency(pedido.valorTotal)}</strong>
        </li>
      ))}
    </ul>
  );
}

function Shortcuts({ items }) {
  if (!items.length) return null;
  return (
    <section className={styles.shortcuts} aria-labelledby="atalhos-titulo">
      <h2 id="atalhos-titulo" className={styles.sectionTitle}>Atalhos</h2>
      <div className={styles.shortcutGrid}>
        {items.map((item) => (
          <Link key={item.to} to={item.to} className={styles.shortcut}>
            <strong>{item.label}</strong>
            <span>{item.description}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function LoadState({ erro }) {
  if (erro) return <div className={ui.feedback} data-type="error" role="alert">{erro}</div>;
  return (
    <div className={styles.loading} aria-busy="true">
      <span className={styles.srOnly} role="status">Carregando pedidos...</span>
      {[1, 2, 3].map((item) => <div key={item} className={ui.skeletonRow} />)}
    </div>
  );
}

function DistributorDashboard({ usuario }) {
  const [pedidos, setPedidos] = useState(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let active = true;
    api.get("/pedidos/meus")
      .then(({ data }) => { if (active) setPedidos(Array.isArray(data) ? data : []); })
      .catch((error) => { if (active) setErro(getApiErrorMessage(error, "Não foi possível carregar seus pedidos. Atualize a página para tentar novamente.")); });
    return () => { active = false; };
  }, []);

  const resumo = summarizeOrders(pedidos || []);
  const ultimo = resumo.recentes[0];
  const nome = usuario?.nomeFantasia || usuario?.nomeResponsavel || "";
  const atalhos = [
    { to: "/treinamentos", label: "Treinamentos", description: "Conteúdos para sua equipe de vendas." },
    { to: "/materiais-marketing", label: "Materiais de marketing", description: "Campanhas e peças liberadas para você." },
    { to: "/precos-cliente-final", label: "Preços cliente final", description: "Tabela sugerida para revenda." },
  ].filter((item) => canOpenRoute(usuario, item.to, ["cliente"]));

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="conta-titulo">
        <div className={styles.heroCopy}>
          <span>Portal do distribuidor</span>
          <h1 id="conta-titulo">{nome ? `Olá, ${nome}` : "Olá"}</h1>
          <p>Monte seu pedido no catálogo com os preços da sua tabela e acompanhe cada etapa até a entrega.</p>
          <div className={styles.heroActions}>
            <Link className={styles.heroPrimary} to="/catalogo">Fazer novo pedido</Link>
            <Link className={styles.heroSecondary} to="/meus-pedidos">Ver meus pedidos</Link>
          </div>
        </div>
        {ultimo && (
          <Link className={styles.lastOrder} to={`/meus-pedidos?pedido=${ultimo._id}`} aria-label={`Último pedido ${ultimo.numeroPedido}: ${formatOrderStatus(ultimo.status)}`}>
            <span>Último pedido</span>
            <strong>{ultimo.numeroPedido}</strong>
            <OrderStatusBadge status={ultimo.status} label={formatOrderStatus(ultimo.status)} />
            <small>{formatOrderDate(ultimo.dataPedido || ultimo.createdAt)} — {formatCurrency(ultimo.valorTotal)}</small>
          </Link>
        )}
      </section>

      {!pedidos ? <LoadState erro={erro} /> : pedidos.length === 0 ? (
        <section className={`${ui.panel} ${styles.block}`}>
          <EmptyState
            title="Você ainda não fez pedidos"
            description="Escolha os produtos no catálogo e envie seu primeiro pedido. Ele aparecerá aqui para acompanhamento."
            action={<Link className={ui.primaryButton} to="/catalogo">Abrir catálogo</Link>}
          />
        </section>
      ) : (
        <>
          <section className={styles.block} aria-labelledby="situacao-titulo">
            <h2 id="situacao-titulo" className={styles.sectionTitle}>Situação dos pedidos</h2>
            <div className={styles.stats}>
              <div className={styles.stat}>
                <span>Em andamento</span>
                <strong>{resumo.emAndamento}</strong>
                <small>Em aprovação, separação ou faturamento.</small>
              </div>
              <div className={styles.stat} data-highlight={resumo.aguardandoRecebimento > 0}>
                <span>Aguardando recebimento</span>
                <strong>{resumo.aguardandoRecebimento}</strong>
                {resumo.aguardandoRecebimento > 0
                  ? <Link to="/meus-pedidos">Confirmar recebimento</Link>
                  : <small>Nenhum pedido em trânsito.</small>}
              </div>
              <div className={styles.stat}>
                <span>Concluídos</span>
                <strong>{resumo.concluidos}</strong>
                <small>Pedidos entregues.</small>
              </div>
            </div>
          </section>

          <section className={`${ui.panel} ${styles.block}`} aria-labelledby="recentes-titulo">
            <div className={ui.panelHeader}>
              <div>
                <h2 id="recentes-titulo">Pedidos recentes</h2>
                <p>Os cinco pedidos mais recentes da sua conta.</p>
              </div>
              <Link className={ui.ghostButton} to="/meus-pedidos">Ver todos</Link>
            </div>
            <RecentOrders pedidos={resumo.recentes} destino="/meus-pedidos" />
          </section>
        </>
      )}

      <Shortcuts items={atalhos} />
    </main>
  );
}

function SalesDashboard({ usuario }) {
  const [pedidos, setPedidos] = useState(null);
  const [clientes, setClientes] = useState(null);
  const [erro, setErro] = useState("");
  const global = hasGlobalScope(usuario);
  const podeCriar = hasPermission(usuario, "criarPedidos");
  const podeVerClientes = hasPermission(usuario, "clientes");

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get("/pedidos"),
      podeVerClientes ? api.get("/carteira") : Promise.resolve({ data: null }),
    ])
      .then(([pedidosResponse, clientesResponse]) => {
        if (!active) return;
        setPedidos(Array.isArray(pedidosResponse.data) ? pedidosResponse.data : []);
        setClientes(Array.isArray(clientesResponse.data) ? clientesResponse.data : null);
      })
      .catch((error) => { if (active) setErro(getApiErrorMessage(error, "Não foi possível carregar os dados. Atualize a página para tentar novamente.")); });
    return () => { active = false; };
  }, [podeVerClientes]);

  const resumo = summarizeOrders(pedidos || []);
  const semCarteira = !global && clientes?.length === 0;
  const atalhos = [
    { to: "/carteira", label: global ? "Clientes" : "Minha carteira", description: global ? "Todos os distribuidores e seus pedidos." : "Distribuidores atribuídos a você." },
    { to: "/pedidos", label: "Pedidos", description: global ? "Acompanhe os pedidos da Central." : "Pedidos dos clientes da sua carteira." },
    { to: "/treinamentos", label: "Treinamentos", description: "Assista aos conteúdos publicados." },
    { to: "/admin/treinamentos", label: "Acompanhamento de treinamentos", description: "Veja quem assistiu e o progresso." },
    { to: "/materiais-marketing", label: "Materiais", description: "Campanhas e peças de marketing." },
  ].filter((item) => canOpenRoute(usuario, item.to, [usuario?.tipo]));

  return (
    <main className={ui.container}>
      <PageHeader
        eyebrow={usuario?.tipo === "vendedor" ? "Vendas" : "Comercial"}
        title={`Olá, ${usuario?.nomeResponsavel || "bem-vindo"}`}
        description={global ? "Visão geral dos pedidos e clientes da Central." : "Acompanhe sua carteira e os pedidos dos seus clientes."}
        action={podeCriar && !semCarteira ? <Link className={ui.primaryButton} to="/pedidos/novo">Novo pedido</Link> : null}
      />

      {!pedidos ? <LoadState erro={erro} /> : semCarteira ? (
        <section className={`${ui.panel} ${styles.block}`}>
          <EmptyState
            icon="clients"
            title="Nenhum cliente atribuído"
            description="Sua carteira ainda não possui clientes. Quando um administrador atribuir distribuidores a você, os pedidos deles aparecerão aqui."
          />
        </section>
      ) : (
        <>
          <section className={styles.block} aria-label="Resumo">
            <div className={styles.stats}>
              {clientes && (
                <div className={styles.stat}>
                  <span>{global ? "Clientes" : "Clientes na carteira"}</span>
                  <strong>{clientes.length}</strong>
                  <Link to="/carteira">{global ? "Ver clientes" : "Ver carteira"}</Link>
                </div>
              )}
              <div className={styles.stat} data-highlight={resumo.aguardandoAprovacao > 0}>
                <span>Aguardando aprovação</span>
                <strong>{resumo.aguardandoAprovacao}</strong>
                <small>Pedidos antes da Logística.</small>
              </div>
              <div className={styles.stat}>
                <span>Em andamento</span>
                <strong>{resumo.emAndamento}</strong>
                <small>Da aprovação ao faturamento.</small>
              </div>
              <div className={styles.stat}>
                <span>Enviados</span>
                <strong>{resumo.aguardandoRecebimento}</strong>
                <small>Aguardando confirmação do cliente.</small>
              </div>
            </div>
          </section>

          <section className={`${ui.panel} ${styles.block}`} aria-labelledby="recentes-vendas-titulo">
            <div className={ui.panelHeader}>
              <div>
                <h2 id="recentes-vendas-titulo">Pedidos recentes</h2>
                <p>{global ? "Últimos pedidos registrados na Central." : "Últimos pedidos dos clientes da sua carteira."}</p>
              </div>
              <Link className={ui.ghostButton} to="/pedidos">Ver todos</Link>
            </div>
            {resumo.recentes.length ? (
              <RecentOrders pedidos={resumo.recentes} destino="/pedidos" showClient />
            ) : (
              <EmptyState headingLevel={3} title="Nenhum pedido ainda" description="Os pedidos dos seus clientes aparecerão aqui." />
            )}
          </section>
        </>
      )}

      <Shortcuts items={atalhos} />
    </main>
  );
}

export default function ContaDashboard({ sales = false }) {
  const usuario = getAuthSession()?.usuario;
  return (
    <>
      <Navbar />
      {sales ? <SalesDashboard usuario={usuario} /> : <DistributorDashboard usuario={usuario} />}
    </>
  );
}

