import { useEffect, useState } from "react";
import api from "../../api/axios";
import styles from "./MeusPedidos.module.css";
import Navbar from "../../components/Navbar/Navbar";
import { abrirOuBaixarPdfPedido } from "../../utils/pdfPedido";

// Mapeia o valor de status para os sufixos das classes CSS
const statusClasse = (status = "") => {
  const s = status.toLowerCase().replace(/\s+/g, "");
  if (s.includes("nov"))         return "Novo";
  if (s.includes("separ"))       return "Separacao";
  if (s.includes("envi"))        return "Enviado";
  if (s.includes("entreg"))      return "Entregue";
  if (s.includes("cancel"))      return "Cancelado";
  if (s.includes("aguard"))      return "Aguardando";
  return "";
};

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

  return (
    <>
      <Navbar />

      <div className={styles.container}>
        <h1>Meus Pedidos</h1>

        {pedidos.length === 0 && <p>Você ainda não possui pedidos.</p>}

        <div className={styles.lista}>
          {pedidos.map((pedido) => {
            const sc = statusClasse(pedido.status);
            return (
              <div
                className={`${styles.card} ${sc ? styles["status" + sc] : ""}`}
                key={pedido._id}
              >
                <div>
                  <h3>{pedido.numeroPedido}</h3>
                  <p>Data: {data(pedido)}</p>
                  <p className={sc ? styles["statusBadge" + sc] : ""}>
                    Status: {pedido.status}
                  </p>
                  <p>Total: {moeda(pedido.valorTotal)}</p>
                </div>

                <button onClick={() => baixarPdf(pedido)}>
                  Baixar PDF
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default MeusPedidos;
