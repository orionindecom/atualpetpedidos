import { useEffect, useState } from "react";
import api from "../../api/axios";
import styles from "./MeusPedidos.module.css";
import Navbar from "../../components/Navbar/Navbar";

function MeusPedidos() {
  const [pedidos, setPedidos] = useState([]);

  useEffect(() => {
    async function carregarPedidos() {
      const response = await api.get("/pedidos/meus");
      setPedidos(response.data);
    }

    carregarPedidos();
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

  const baixarPdf = async (pedidoId) => {
    try {
      const response = await api.get(`/pedidos/${pedidoId}/pdf`, {
        responseType: "blob",
      });

      const fileURL = window.URL.createObjectURL(
        new Blob([response.data], { type: "application/pdf" })
      );

      window.open(fileURL, "_blank");
    } catch (error) {
      console.error(error);
      alert("Erro ao baixar PDF");
    }
  };

  return (
    <>
      <Navbar />

      <div className={styles.container}>
        <h1>Meus Pedidos</h1>

        {pedidos.length === 0 && <p>Você ainda não possui pedidos.</p>}

        <div className={styles.lista}>
          {pedidos.map((pedido) => (
            <div className={styles.card} key={pedido._id}>
              <div>
                <h3>{pedido.numeroPedido}</h3>
                <p>Data: {data(pedido)}</p>
                <p>Status: {pedido.status}</p>
                <p>Total: {moeda(pedido.valorTotal)}</p>
              </div>

              <button onClick={() => baixarPdf(pedido._id)}>
                Baixar PDF
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default MeusPedidos;