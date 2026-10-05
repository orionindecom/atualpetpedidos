import { formatOrderPickupDate } from "../../utils/orderLogistics";

function OrderPickupDetails({ pedido, showUser = false }) {
  if (pedido.status !== "retirado") return null;
  return (
    <p>
      Retirado em: {formatOrderPickupDate(pedido.retiradoEm)}
      {showUser && ` por ${pedido.retiradoPor?.usuarioNome || "Admin"}`}
    </p>
  );
}

export default OrderPickupDetails;
