import { useEffect, useState } from "react";
import api from "../../api/axios";
import Navbar from "../../components/Navbar/Navbar";
import styles from "./MarketingDashboard.module.css";

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data indisponível"
    : date.toLocaleDateString("pt-BR");
};

function MarketingDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await api.get("/marketing/dashboard", {
          signal: controller.signal,
        });
        setData(response.data);
      } catch (requestError) {
        if (requestError.code !== "ERR_CANCELED") {
          setError(
            requestError.response?.data?.message ||
            "Não foi possível carregar o dashboard"
          );
        }
      }
    };
    load();
    return () => controller.abort();
  }, []);

  const metrics = data?.metricas;

  return (
    <>
      <Navbar />
      <main className={styles.container}>
        <header className={styles.pageHeader}>
          <span>Marketing</span>
          <h1>Dashboard</h1>
          <p>Acompanhe a biblioteca publicada para distribuidores e Groomers.</p>
        </header>

        {error ? (
          <div className={styles.stateBox} role="alert">{error}</div>
        ) : !metrics ? (
          <div className={styles.loadingGrid} aria-label="Carregando indicadores">
            {[1, 2, 3, 4].map((item) => <div key={item} />)}
          </div>
        ) : (
          <>
            <section className={styles.metrics} aria-label="Indicadores de marketing">
              <article><span>Conteúdos ativos</span><strong>{metrics.conteudosAtivos}</strong></article>
              <article><span>Banners ativos</span><strong>{metrics.bannersAtivos}</strong></article>
              <article><span>Publicados no mês</span><strong>{metrics.publicadosNoMes}</strong></article>
              <article><span>Total de materiais</span><strong>{metrics.totalConteudos}</strong></article>
            </section>

            <section className={styles.recent}>
              <div>
                <span>Publicação mais recente</span>
                <h2>{data.conteudoRecente?.titulo || "Nenhum conteúdo publicado"}</h2>
                <p>
                  {data.conteudoRecente?.categoria ||
                    "Cadastre o primeiro conteúdo para iniciar a biblioteca."}
                </p>
              </div>
              {data.conteudoRecente && (
                <time dateTime={data.conteudoRecente.dataPublicacao}>
                  {formatDate(
                    data.conteudoRecente.dataPublicacao ||
                    data.conteudoRecente.createdAt
                  )}
                </time>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}

export default MarketingDashboard;
