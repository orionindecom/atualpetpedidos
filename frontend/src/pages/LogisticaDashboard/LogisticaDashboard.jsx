import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../api/axios";
import Navbar from "../../components/Navbar/Navbar";
import {
  formatOrderDate,
  formatOrderStatus,
} from "../../utils/orderLogistics";
import styles from "./LogisticaDashboard.module.css";

const metricCards = [
  ["recebidos", "Recebidos", "Aguardando separação"],
  ["emSeparacao", "Em separação", "Em processamento"],
  ["separados", "Separados", "Aguardando faturamento"],
  ["faturados", "Faturados", "Aguardando envio"],
  ["enviados", "Enviados", "Em transporte"],
  ["totalAguardandoAcao", "Aguardando ação", "Fluxo operacional aberto"],
];

function LogisticaDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api.get("/logistica/dashboard", { signal: controller.signal })
      .then((response) => setData(response.data))
      .catch((requestError) => {
        if (requestError.code !== "ERR_CANCELED") {
          setError(requestError.response?.data?.message || "Não foi possível carregar o painel");
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <>
      <Navbar />
      <main className={styles.container}>
        <header className={styles.pageHeader}>
          <span>Operação</span>
          <h1>Dashboard de Logística</h1>
          <p>Priorize pedidos que ainda precisam avançar no fluxo operacional.</p>
        </header>

        {error ? (
          <div className={styles.stateBox} role="alert">{error}</div>
        ) : !data ? (
          <div className={styles.loadingGrid} aria-label="Carregando indicadores">
            {metricCards.map(([key]) => <div key={key} />)}
          </div>
        ) : (
          <>
            <section className={styles.metrics} aria-label="Indicadores de logística">
              {metricCards.map(([key, label, description]) => (
                <article key={key}>
                  <span>{label}</span>
                  <strong>{data.metricas[key]}</strong>
                  <small>{description}</small>
                </article>
              ))}
            </section>

            <section className={styles.queue}>
              <div className={styles.sectionHeader}>
                <div>
                  <span>Fila operacional</span>
                  <h2>Pedidos há mais tempo em aberto</h2>
                </div>
                <Link to="/logistica/pedidos?aguardandoAcao=true">Ver pedidos</Link>
              </div>

              {data.pedidosMaisAntigos.length === 0 ? (
                <p className={styles.empty}>Nenhum pedido aguardando ação.</p>
              ) : (
                <div className={styles.orderList}>
                  {data.pedidosMaisAntigos.map((pedido) => (
                    <div key={pedido._id} className={styles.orderRow}>
                      <div>
                        <strong>{pedido.numeroPedido}</strong>
                        <span>{pedido.nomeFantasiaCliente || pedido.razaoSocialCliente || "Cliente"}</span>
                      </div>
                      <span className={styles.status}>{formatOrderStatus(pedido.status)}</span>
                      <time dateTime={pedido.createdAt}>{formatOrderDate(pedido.createdAt)}</time>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}

export default LogisticaDashboard;
