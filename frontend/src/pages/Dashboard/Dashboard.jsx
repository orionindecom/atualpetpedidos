import { useEffect, useState } from "react";
import api from "../../api/axios";
import Navbar from "../../components/Navbar/Navbar";
import styles from "./Dashboard.module.css";

function Dashboard() {
  const [dados, setDados] = useState(null);

  useEffect(() => {
    async function carregarDashboard() {
      const response = await api.get("/dashboard");
      setDados(response.data);
    }

    carregarDashboard();
  }, []);

  const moeda = (valor) =>
    valor.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });

  const formatarStatus = (status) => {
    const nomes = {
      novo: "Novo",
      em_analise: "Em análise",
      separando: "Separando",
      faturado: "Faturado",
      enviado: "Enviado",
      entregue: "Entregue",
      cancelado: "Cancelado",
    };

    return nomes[status] || status;
  };

  const data = (pedido) => {
    const dia = String(pedido.dia).padStart(2, "0");
    const mes = String(pedido.mes).padStart(2, "0");
    return `${dia}/${mes}/${pedido.ano}`;
  };

  if (!dados) {
    return (
      <>
        <Navbar />
        <div className={styles.container}>
          <h1>Carregando...</h1>
        </div>
      </>
    );
  }

  const maiorStatus = Math.max(
    ...dados.pedidosPorStatus.map((item) => item.total),
    1
  );

  const maiorProduto = Math.max(
    ...dados.topProdutos.map((item) => item.quantidade),
    1
  );

  return (
    <>
      <Navbar />

      <div className={styles.container}>
        <div className={styles.header}>
          <div>
            <h1>Dashboard</h1>
            <p>Resumo comercial do sistema AtualPet.</p>
          </div>
        </div>

        <section className={styles.hero}>
          <div>
            <span>Faturamento do mês</span>
            <h2>{moeda(dados.faturamentoMes)}</h2>
            <p>Considerando pedidos não cancelados.</p>
          </div>

          <div className={styles.heroBadge}>
            {dados.pedidosMes} pedidos no mês
          </div>
        </section>

        <section className={styles.kpis}>
          <div className={styles.kpi}>
            <span>Pedidos novos</span>
            <strong>{dados.pedidosNovos}</strong>
          </div>

          <div className={styles.kpi}>
            <span>Clientes pendentes</span>
            <strong>{dados.clientesPendentes}</strong>
          </div>

          <div className={styles.kpi}>
            <span>Clientes ativos</span>
            <strong>{dados.clientesAtivos}</strong>
          </div>

          <div className={styles.kpi}>
            <span>Produtos ativos</span>
            <strong>{dados.produtosAtivos}</strong>
          </div>

          <div className={styles.kpi}>
            <span>Tabelas ativas</span>
            <strong>{dados.tabelasAtivas}</strong>
          </div>
        </section>

        <section className={styles.duasColunas}>
          <div className={styles.panel}>
            <h3>Pedidos por status</h3>

            <div className={styles.statusLista}>
              {dados.pedidosPorStatus.map((item) => (
                <div className={styles.statusItem} key={item.status}>
                  <div className={styles.statusTopo}>
                    <span>{formatarStatus(item.status)}</span>
                    <strong>{item.total}</strong>
                  </div>

                  <div className={styles.barraFundo}>
                    <div
                      className={styles.barra}
                      style={{
                        width: `${(item.total / maiorStatus) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.panel}>
            <h3>Últimos pedidos</h3>

            <div className={styles.ultimos}>
              {dados.ultimosPedidos.map((pedido) => (
                <div className={styles.pedidoLinha} key={pedido._id}>
                  <div>
                    <strong>{pedido.numeroPedido}</strong>
                    <span>{pedido.nomeFantasiaCliente || "-"}</span>
                  </div>

                  <div className={styles.pedidoInfo}>
                    <span>{data(pedido)}</span>
                    <strong>{moeda(pedido.valorTotal)}</strong>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <h3>Top produtos vendidos</h3>

          <div className={styles.produtosRanking}>
            {dados.topProdutos.map((produto, index) => (
              <div className={styles.produtoItem} key={produto.produto}>
                <div className={styles.produtoCabecalho}>
                  <span>
                    #{index + 1} {produto.produto}
                  </span>

                  <strong>{produto.quantidade} un.</strong>
                </div>

                <div className={styles.barraFundo}>
                  <div
                    className={styles.barraProduto}
                    style={{
                      width: `${(produto.quantidade / maiorProduto) * 100}%`,
                    }}
                  />
                </div>

                <small>{moeda(produto.faturamento)}</small>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

export default Dashboard;