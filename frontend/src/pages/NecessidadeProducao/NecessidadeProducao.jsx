import { useEffect, useState } from "react";
import api from "../../api/axios";
import Navbar from "../../components/Navbar/Navbar";
import PageHeader from "../../components/PageHeader/PageHeader";
import { PaginationControls } from "../../components/ListControls/ListControls";
import { formatOrderStatus } from "../../utils/orderLogistics";
import dashboard from "../LogisticaDashboard/LogisticaDashboard.module.css";
import orders from "../AdminPedidos/AdminPedidos.module.css";
import items from "../../components/OrderDetails/OrderDetails.module.css";
import styles from "./NecessidadeProducao.module.css";

const numero = (value) => Number(value).toLocaleString("pt-BR");
const LIMITE = 12;

function NecessidadeProducao() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState("produtos");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    api.get("/logistica/necessidade-producao", { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setData(response.data);
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(requestError.response?.data?.message || "Não foi possível carregar a necessidade de produção");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  const atualizar = () => {
    setLoading(true);
    setError("");
    setPage(1);
    setReload((value) => value + 1);
  };
  const registros = data?.[view] || [];
  const visiveis = registros.slice((page - 1) * LIMITE, page * LIMITE);

  return (
    <>
      <Navbar />
      <main className={dashboard.container}>
        <PageHeader eyebrow="Operação" title="Necessidade de Produção"
          description="Veja as faltas identificadas na separação e quais produtos priorizar para as OPs."
          action={<button className={styles.button} disabled={loading} onClick={atualizar}>{loading ? "Atualizando..." : "Atualizar"}</button>}
        />
        <p className={styles.note}>
          Somente pedidos cuja separação já foi iniciada, antes do faturamento.
          Itens ainda não processados ficam fora do cálculo. A falta considera a quantidade final registrada ou a separada.
        </p>
        {error ? <div className={dashboard.stateBox} role="alert">{error}</div> : loading ? (
          <div className={dashboard.loadingGrid} role="status" aria-label="Carregando necessidade de produção">
            <div /><div /><div />
          </div>
        ) : data && (
          <>
            <section className={dashboard.metrics} aria-label="Resumo da necessidade">
              <article><span>Unidades faltantes</span><strong>{numero(data.resumo.quantidadeFaltante)}</strong><small>Faltas identificadas na separação</small></article>
              <article><span>Produtos com necessidade</span><strong>{numero(data.resumo.quantidadeProdutos)}</strong><small>Consolidados entre todos os pedidos</small></article>
              <article><span>Pedidos com pendências</span><strong>{numero(data.resumo.quantidadePedidos)}</strong><small>Separação iniciada e falta registrada</small></article>
            </section>
            <div className={styles.views} role="group" aria-label="Visualização da necessidade">
              {[["produtos", "Por produto"], ["pedidos", "Por pedido"]].map(([key, label]) => (
                <button key={key} className={styles.button} aria-pressed={view === key}
                  onClick={() => { setView(key); setPage(1); }}>{label}</button>
              ))}
            </div>
            {registros.length === 0 ? (
              <section className={dashboard.queue}><p className={dashboard.empty}>Nenhuma falta identificada nos pedidos com separação iniciada.</p></section>
            ) : view === "produtos" ? (
              <section className={styles.products} aria-label="Necessidade consolidada por produto">
                {visiveis.map((produto, index) => {
                  const posicao = (page - 1) * LIMITE + index + 1;
                  return (
                    <article key={produto.produtoId} className={styles.product} data-priority={posicao <= 3}>
                      <div className={styles.productHeading}><span>{posicao}º em necessidade</span>{posicao <= 3 && <span className={styles.priority}>Prioridade</span>}</div>
                      <h2>{produto.nomeProduto}</h2>
                      <span>Necessidade total</span>
                      <strong className={styles.total}>{numero(produto.quantidadeFaltante)} <small>unidades</small></strong>
                      <p>Presente em {numero(produto.quantidadePedidos)} {produto.quantidadePedidos === 1 ? "pedido" : "pedidos"}</p>
                    </article>
                  );
                })}
              </section>
            ) : (
              <section className={styles.orderList} aria-label="Necessidade por pedido">
                {visiveis.map((pedido) => (
                  <article className={dashboard.queue} key={pedido._id}>
                    <div className={dashboard.sectionHeader}>
                      <div><span>{pedido.cliente}</span><h2>{pedido.numeroPedido}</h2></div>
                      <span className={orders.statusBadge} data-status={pedido.status}>{formatOrderStatus(pedido.status)}</span>
                    </div>
                    <div className={items.itemsTable}>
                      {pedido.itens.map((item, index) => (
                        <div className={styles.itemRow} key={`${item.produtoId}-${index}`}>
                          <div className={items.itemIdentity}><strong>{item.nomeProduto}</strong></div>
                          <div className={items.quantityCell}><span>Solicitado</span><strong>{numero(item.quantidadeSolicitada)}</strong></div>
                          <div className={items.quantityCell}><span>Atendido</span><strong>{item.quantidadeAtendida === null ? "Não registrado" : numero(item.quantidadeAtendida)}</strong></div>
                          <div className={items.quantityCell} data-shortage="true"><span>Faltante</span><strong>{numero(item.quantidadeFaltante)}</strong></div>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </section>
            )}
            <PaginationControls currentPage={page} totalPages={Math.ceil(registros.length / LIMITE)}
              onPrevious={() => setPage((value) => value - 1)} onNext={() => setPage((value) => value + 1)} />
          </>
        )}
      </main>
    </>
  );
}

export default NecessidadeProducao;
