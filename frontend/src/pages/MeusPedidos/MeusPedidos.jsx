import { useEffect, useState } from "react";
import api from "../../api/axios";
import styles from "./MeusPedidos.module.css";
import Navbar from "../../components/Navbar/Navbar";
import OrderProgress from "../../components/OrderProgress/OrderProgress";
import { abrirOuBaixarPdfPedido } from "../../utils/pdfPedido";
import {
  formatCurrency,
  formatOrderDate,
  formatOrderDateTime,
  formatOrderStatus,
} from "../../utils/orderLogistics";

// Mapeia o valor de status para os sufixos das classes CSS
const statusClasse = (status = "") => {
  const s = status.toLowerCase().replace(/\s+/g, "");
  if (s.includes("nov"))         return "Novo";
  if (s.includes("aprov"))       return "Novo";
  if (s.includes("separ"))       return "Separacao";
  if (s.includes("envi"))        return "Enviado";
  if (s.includes("entreg"))      return "Entregue";
  if (s.includes("cancel"))      return "Cancelado";
  if (s.includes("aguard"))      return "Aguardando";
  return "";
};

function MeusPedidos() {
  const [pedidos, setPedidos] = useState([]);
  const [pedidoExpandido, setPedidoExpandido] = useState(null);
  const [confirmandoRecebimento, setConfirmandoRecebimento] = useState(null);

  useEffect(() => {
    async function carregarPedidos() {
      const response = await api.get("/pedidos/meus");
      setPedidos(response.data);
    }

    carregarPedidos();
  }, []);

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

  const confirmarRecebimento = async (pedido) => {
    if (!window.confirm("Confirma que este pedido foi recebido?")) return;

    setConfirmandoRecebimento(pedido._id);
    try {
      const response = await api.patch(`/pedidos/${pedido._id}/confirmar-recebimento`);
      setPedidos((current) => current.map((item) => (
        item._id === pedido._id ? response.data.pedido : item
      )));
    } catch (error) {
      alert(error.response?.data?.message || "Não foi possível confirmar o recebimento.");
    } finally {
      setConfirmandoRecebimento(null);
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
                <div className={styles.summary}>
                  <h3>{pedido.numeroPedido}</h3>
                  <p>Data: {formatOrderDate(pedido.dataPedido || pedido.createdAt)}</p>
                  <p className={sc ? styles["statusBadge" + sc] : ""}>
                    Status: {formatOrderStatus(pedido.status)}
                  </p>
                  <p>Total: {formatCurrency(pedido.valorTotal)}</p>
                </div>

                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.trackingButton}
                    aria-expanded={pedidoExpandido === pedido._id}
                    onClick={() => setPedidoExpandido((current) => (
                      current === pedido._id ? null : pedido._id
                    ))}
                  >
                    {pedidoExpandido === pedido._id ? "Ocultar andamento" : "Ver andamento"}
                  </button>
                  <button type="button" className={styles.pdfButton} onClick={() => baixarPdf(pedido)}>
                    Baixar PDF
                  </button>
                  {pedido.status === "enviado" && (
                    <button
                      type="button"
                      className={styles.confirmReceiptButton}
                      disabled={confirmandoRecebimento === pedido._id}
                      onClick={() => confirmarRecebimento(pedido)}
                    >
                      {confirmandoRecebimento === pedido._id
                        ? "Confirmando..."
                        : "Confirmar recebimento"}
                    </button>
                  )}
                </div>

                {pedidoExpandido === pedido._id && (
                  <section className={styles.trackingPanel} aria-label={`Andamento do pedido ${pedido.numeroPedido}`}>
                    <OrderProgress status={pedido.status} />

                    <div className={styles.shippingData}>
                      <div><span>Nota fiscal</span><strong>{pedido.numeroNotaFiscal || "Ainda não informada"}</strong></div>
                      <div><span>Transportadora</span><strong>{pedido.transportadora || "Ainda não informada"}</strong></div>
                      <div><span>Código de rastreio</span><strong>{pedido.codigoRastreio || "Ainda não informado"}</strong></div>
                      <div><span>Data de envio</span><strong>{formatOrderDate(pedido.dataEnvio, "Ainda não enviada")}</strong></div>
                      <div><span>Data de entrega</span><strong>{formatOrderDateTime(pedido.dataEntrega, "Ainda não confirmada")}</strong></div>
                      {pedido.linkRastreio?.startsWith("https://") && (
                        <a href={pedido.linkRastreio} target="_blank" rel="noreferrer">
                          Acompanhar entrega
                        </a>
                      )}
                    </div>

                  </section>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default MeusPedidos;
