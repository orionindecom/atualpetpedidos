import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../api/axios";
import Navbar from "../../components/Navbar/Navbar";
import {
  buildOrderMetricsParams,
  formatDuration,
  formatPercentage,
  getAttentionLabel,
  getMetricsErrorMessage,
  METRICS_PERIODS,
} from "../../utils/orderMetrics";
import styles from "./AdminMetricasPedidos.module.css";

const FLOW_METRICS = Object.freeze([
  { key: "aprovacao", label: "Até aprovação", help: "Criação → aprovação" },
  { key: "esperaSeparacao", label: "Espera pela separação", help: "Aprovação → início real" },
  { key: "separacao", label: "Separação", help: "Início → conclusão" },
  { key: "esperaConferencia", label: "Espera pela conferência", help: "Separação → início da conferência" },
  { key: "conferencia", label: "Conferência", help: "Início → conclusão" },
]);

const initialFilters = {
  periodo: "30dias",
  dataInicio: "",
  dataFim: "",
  operadorId: "",
};

const MetricValue = ({ statistic, compact = false }) => (
  <div className={compact ? styles.metricValueCompact : styles.metricValue}>
    <strong>{formatDuration(statistic?.mediaMs)}</strong>
    <span>mediana {formatDuration(statistic?.medianaMs)} · n={statistic?.amostra || 0}</span>
  </div>
);

function AdminMetricasPedidos() {
  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [metrics, setMetrics] = useState(null);
  const [operators, setOperators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.get("/admin/operadores-logistica")
      .then((response) => {
        if (active) setOperators(response.data || []);
      })
      .catch((requestError) => {
        if (active) setError(getMetricsErrorMessage(
          requestError,
          "Não foi possível carregar os operadores."
        ));
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    api.get("/admin/metricas-pedidos", {
      params: buildOrderMetricsParams(appliedFilters),
    })
      .then((response) => {
        if (active) {
          setMetrics(response.data);
          setError("");
        }
      })
      .catch((requestError) => {
        if (active) setError(getMetricsErrorMessage(
          requestError,
          "Não foi possível carregar as métricas operacionais."
        ));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [appliedFilters]);

  const maxFlowAverage = useMemo(() => {
    if (!metrics) return 1;
    return Math.max(
      ...FLOW_METRICS.map(({ key }) => metrics.tempos[key]?.mediaMs || 0),
      1
    );
  }, [metrics]);

  const applyFilters = (event) => {
    event.preventDefault();
    if (
      draftFilters.periodo === "personalizado" &&
      (!draftFilters.dataInicio || !draftFilters.dataFim)
    ) {
      setError("Informe as datas inicial e final do período personalizado.");
      return;
    }
    setLoading(true);
    setError("");
    setAppliedFilters({ ...draftFilters });
  };

  const clearFilters = () => {
    setLoading(true);
    setError("");
    setDraftFilters(initialFilters);
    setAppliedFilters(initialFilters);
  };

  const downloadPdf = async () => {
    setDownloading(true);
    setError("");
    try {
      const response = await api.get("/admin/metricas-pedidos/pdf", {
        params: buildOrderMetricsParams(appliedFilters),
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `metricas-operacionais-${metrics.filtros.dataInicio}-${metrics.filtros.dataFim}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(getMetricsErrorMessage(requestError, "Não foi possível gerar o PDF."));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <Navbar />
      <main className={styles.container}>
        <header className={styles.pageHeader}>
          <div>
            <span className={styles.eyebrow}>Administração · Operação</span>
            <h1>Métricas operacionais</h1>
            <p>Tempos, filas, volume e qualidade calculados a partir dos eventos persistidos.</p>
          </div>
          <button
            type="button"
            className={styles.exportButton}
            onClick={downloadPdf}
            disabled={!metrics || downloading}
          >
            {downloading ? "Gerando PDF..." : "Exportar PDF"}
          </button>
        </header>

        <form className={styles.filters} onSubmit={applyFilters}>
          <label>
            <span>Período</span>
            <select
              value={draftFilters.periodo}
              onChange={(event) => setDraftFilters((current) => ({
                ...current,
                periodo: event.target.value,
              }))}
            >
              {METRICS_PERIODS.map((period) => (
                <option key={period.value} value={period.value}>{period.label}</option>
              ))}
            </select>
          </label>

          {draftFilters.periodo === "personalizado" && (
            <>
              <label>
                <span>Data inicial</span>
                <input
                  type="date"
                  value={draftFilters.dataInicio}
                  onChange={(event) => setDraftFilters((current) => ({
                    ...current,
                    dataInicio: event.target.value,
                  }))}
                />
              </label>
              <label>
                <span>Data final</span>
                <input
                  type="date"
                  value={draftFilters.dataFim}
                  onChange={(event) => setDraftFilters((current) => ({
                    ...current,
                    dataFim: event.target.value,
                  }))}
                />
              </label>
            </>
          )}

          <label className={styles.operatorFilter}>
            <span>Operador</span>
            <select
              value={draftFilters.operadorId}
              onChange={(event) => setDraftFilters((current) => ({
                ...current,
                operadorId: event.target.value,
              }))}
            >
              <option value="">Todos os operadores</option>
              {operators.map((operator) => (
                <option key={operator._id} value={operator._id}>
                  {operator.nome}{operator.ativo ? "" : " (inativo)"}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.filterActions}>
            <button type="submit">Aplicar filtros</button>
            <button type="button" onClick={clearFilters}>Limpar</button>
          </div>
        </form>

        {error && <div className={styles.error} role="alert">{error}</div>}
        {loading && <div className={styles.state}>Calculando métricas...</div>}

        {!loading && metrics && (
          <>
            <div className={styles.contextLine}>
              <span>{metrics.filtros.dataInicio} a {metrics.filtros.dataFim}</span>
              <span>{metrics.filtros.operador || "Todos os operadores"}</span>
              <span>Tempos em horas corridas</span>
            </div>

            <section className={styles.summaryGrid} aria-label="Resumo operacional">
              <article className={styles.summaryCard}>
                <span>Pedidos no período</span>
                <strong>{metrics.resumo.pedidosNoPeriodo}</strong>
                <small>{metrics.resumo.itensUnicos} itens · {metrics.resumo.unidadesSolicitadas} unidades</small>
              </article>
              <article className={styles.summaryCard}>
                <span>Tempo até aprovação</span>
                <MetricValue statistic={metrics.tempos.aprovacao} compact />
              </article>
              <article className={styles.summaryCard}>
                <span>Tempo de separação</span>
                <MetricValue statistic={metrics.tempos.separacao} compact />
              </article>
              <article className={styles.summaryCard}>
                <span>Total até conferência</span>
                <MetricValue statistic={metrics.tempos.total} compact />
              </article>
              <article className={styles.summaryCard}>
                <span>Pedidos com divergência</span>
                <strong>{formatPercentage(metrics.resumo.percentualPedidosComDivergencia)}</strong>
                <small>{metrics.qualidade.pedidosComDivergencia} pedido(s) no período</small>
              </article>
            </section>

            <div className={styles.twoColumns}>
              <section className={styles.panel}>
                <div className={styles.sectionHeader}>
                  <div>
                    <span className={styles.sectionKicker}>Fluxo</span>
                    <h2>Tempos por etapa</h2>
                  </div>
                  <small>Média principal · mediana e amostra como contexto</small>
                </div>
                <div className={styles.flowList}>
                  {FLOW_METRICS.map((flow) => {
                    const statistic = metrics.tempos[flow.key];
                    const width = statistic.mediaMs
                      ? Math.max((statistic.mediaMs / maxFlowAverage) * 100, 3)
                      : 0;
                    return (
                      <article className={styles.flowRow} key={flow.key}>
                        <div className={styles.flowTitle}>
                          <div><strong>{flow.label}</strong><span>{flow.help}</span></div>
                          <MetricValue statistic={statistic} />
                        </div>
                        <div className={styles.barTrack} aria-hidden="true">
                          <div className={styles.barFill} style={{ width: `${width}%` }} />
                        </div>
                        <small>P90 {formatDuration(statistic.p90Ms)}</small>
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.sectionHeader}>
                  <div>
                    <span className={styles.sectionKicker}>Composição</span>
                    <h2>Operação x espera</h2>
                  </div>
                </div>
                <div className={styles.compositionList}>
                  <article>
                    <span>Tempo total médio</span>
                    <strong>{formatDuration(metrics.composicaoTempo.total.mediaMs)}</strong>
                  </article>
                  <article data-tone="operation">
                    <span>Em operação</span>
                    <strong>{formatDuration(metrics.composicaoTempo.operacional.mediaMs)}</strong>
                  </article>
                  <article data-tone="waiting">
                    <span>Parado / esperando</span>
                    <strong>{formatDuration(metrics.composicaoTempo.parado.mediaMs)}</strong>
                  </article>
                </div>
                <p className={styles.sampleNote}>
                  Comparação disponível em {metrics.composicaoTempo.amostraComparavel} pedido(s) com todos os marcos válidos.
                </p>
                <div className={styles.definitionBox}>
                  <strong>Como é calculado</strong>
                  <p>Operacional = separação + conferência. Parado = total até a conferência − operacional.</p>
                </div>
              </section>
            </div>

            <section className={styles.panel}>
              <div className={styles.sectionHeader}>
                <div>
                  <span className={styles.sectionKicker}>Agora</span>
                  <h2>Pedidos que exigem atenção</h2>
                </div>
                <small>P90 com n≥5; caso contrário, limite fixo exibido por etapa</small>
              </div>
              {metrics.pedidosAtencao.length === 0 ? (
                <div className={styles.empty}>Nenhum pedido aberto com marco real suficiente.</div>
              ) : (
                <div className={styles.attentionList}>
                  {metrics.pedidosAtencao.map((order) => (
                    <article className={styles.attentionRow} key={order.pedidoId}>
                      <div>
                        <strong>{order.numeroPedido}</strong>
                        <span>{order.cliente}</span>
                      </div>
                      <div><small>Etapa</small><span>{order.etapa}</span></div>
                      <div><small>Tempo na etapa</small><strong>{formatDuration(order.tempoEtapaMs)}</strong></div>
                      <div><small>Responsável atual</small><span>{order.responsavelAtual || "Sem responsável atribuído"}</span></div>
                      <span className={styles.attentionBadge} data-kind={order.classificacao}>
                        {getAttentionLabel(order.classificacao)}
                      </span>
                      <Link to={`/pedidos?pedido=${order.pedidoId}`}>Abrir pedido</Link>
                    </article>
                  ))}
                </div>
              )}
              {metrics.metadados.filaAtivaTruncada && (
                <p className={styles.sampleNote}>A fila possui mais de 500 pedidos; os 500 mais antigos foram analisados.</p>
              )}
            </section>

            <section className={styles.panel}>
              <div className={styles.sectionHeader}>
                <div>
                  <span className={styles.sectionKicker}>Período</span>
                  <h2>Pedidos mais demorados</h2>
                </div>
              </div>
              {metrics.pedidosMaisDemorados.length === 0 ? (
                <div className={styles.empty}>Nenhum pedido com conferência concluída e tempo total válido.</div>
              ) : (
                <div className={styles.slowOrders}>
                  {metrics.pedidosMaisDemorados.map((order) => (
                    <article key={order.pedidoId}>
                      <div><strong>{order.numeroPedido}</strong><span>{order.cliente}</span></div>
                      <dl>
                        <div><dt>Total</dt><dd>{formatDuration(order.totalMs)}</dd></div>
                        <div><dt>Separação</dt><dd>{formatDuration(order.separacaoMs)}</dd></div>
                        <div><dt>Parado</dt><dd>{formatDuration(order.paradoMs)}</dd></div>
                        <div><dt>Volume</dt><dd>{order.itensUnicos} itens · {order.unidades} un.</dd></div>
                      </dl>
                      <Link to={`/pedidos?pedido=${order.pedidoId}`}>Abrir</Link>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className={styles.panel}>
              <div className={styles.sectionHeader}>
                <div>
                  <span className={styles.sectionKicker}>Equipe</span>
                  <h2>Operadores</h2>
                </div>
                <small>Leitura contextual; sem classificação de melhor ou pior</small>
              </div>
              {metrics.operadores.length === 0 ? (
                <div className={styles.empty}>Nenhum evento de operador no período.</div>
              ) : (
                <div className={styles.operatorTable}>
                  <div className={styles.tableHeader} aria-hidden="true">
                    <span>Operador</span><span>Pedidos / eventos</span><span>Separação</span>
                    <span>Conferência</span><span>Volume</span><span>Qualidade</span>
                  </div>
                  {metrics.operadores.map((operator) => (
                    <article key={operator.operadorId}>
                      <div><strong>{operator.operador}</strong><small>{operator.ativo === false ? "Inativo · histórico preservado" : "Ativo"}</small></div>
                      <div><small>Pedidos / eventos</small><span>{operator.pedidosParticipados} / {operator.eventosOperacionais}</span></div>
                      <div><small>Separações concluídas</small><span>{operator.separacoesConcluidas}</span><em>{formatDuration(operator.tempoSeparacao.mediaMs)} · n={operator.tempoSeparacao.amostra}</em></div>
                      <div><small>Conferências concluídas</small><span>{operator.conferenciasConcluidas}</span><em>{formatDuration(operator.tempoConferencia.mediaMs)} · n={operator.tempoConferencia.amostra}</em></div>
                      <div><small>Itens / unidades processados</small><span>{operator.itensProcessados} / {operator.unidadesProcessadas}</span></div>
                      <div><small>Divergências identificadas</small><span>{operator.divergenciasIdentificadas}</span><em>{operator.divergenciasAssociadasSeparacao} associadas à separação</em></div>
                    </article>
                  ))}
                </div>
              )}
              <p className={styles.sampleNote}>{metrics.atribuicaoDuracaoOperadores.criterio}</p>
            </section>

            <div className={styles.twoColumnsQuality}>
              <section className={styles.panel}>
                <div className={styles.sectionHeader}>
                  <div><span className={styles.sectionKicker}>Qualidade</span><h2>Faltas e divergências</h2></div>
                </div>
                <div className={styles.qualityGrid}>
                  <article><strong>{metrics.qualidade.pedidosComDivergencia}</strong><span>pedidos com divergência</span></article>
                  <article><strong>{metrics.qualidade.itensComDivergencia}</strong><span>itens divergentes</span></article>
                  <article><strong>{metrics.qualidade.pedidosComFalta}</strong><span>pedidos com falta</span></article>
                  <article><strong>{metrics.qualidade.unidadesFaltantes}</strong><span>unidades faltantes</span></article>
                  <article><strong>{metrics.qualidade.pedidosComItemIndisponivel}</strong><span>com item indisponível</span></article>
                  <article><strong>{metrics.qualidade.pedidosComFaltaParcial}</strong><span>com falta parcial</span></article>
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.sectionHeader}>
                  <div><span className={styles.sectionKicker}>Produtos</span><h2>Mais ocorrências</h2></div>
                </div>
                {metrics.produtosOcorrencias.length === 0 ? (
                  <div className={styles.empty}>Nenhuma ocorrência estruturada no período.</div>
                ) : (
                  <div className={styles.productList}>
                    {metrics.produtosOcorrencias.map((product) => (
                      <article key={product.produtoId || product.produto}>
                        <div><strong>{product.produto}</strong><span>{product.pedidosAfetados} pedido(s) afetado(s)</span></div>
                        <div><small>Faltas</small><strong>{product.faltasSeparacao}</strong></div>
                        <div><small>Divergências</small><strong>{product.divergenciasConferencia}</strong></div>
                        <div><small>Ocorrências / pedidos</small><strong>{formatPercentage(product.taxaPedidosAfetados)}</strong></div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <footer className={styles.methodology}>
              <strong>Notas metodológicas</strong>
              <p>Registros sem marcos suficientes não entram na média da etapa. Foram ignorados {metrics.metadados.paresDeTimestampInvalidos} par(es) de timestamps inconsistentes. O período dos pedidos usa criação; a tabela de operadores usa a data real dos eventos.</p>
            </footer>
          </>
        )}
      </main>
    </>
  );
}

export default AdminMetricasPedidos;
