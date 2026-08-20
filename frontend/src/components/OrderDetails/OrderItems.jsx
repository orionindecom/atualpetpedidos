import { formatCurrency } from "../../utils/orderLogistics";
import styles from "./OrderDetails.module.css";

const ITEM_STATUS_LABELS = {
  pendente: "Aguardando separação",
  completo: "Completo",
  parcial: "Falta parcial",
  indisponivel: "Indisponível",
  excedente: "Acima do pedido atual",
};

function OrderItems({
  items = [],
  editable = false,
  separation = {},
  onSeparationChange,
  showPrices = true,
  showFulfillment = true,
  deriveEditableStatus = true,
  separatedLabel = "Separado",
}) {
  return (
    <div className={styles.itemsTable}>
      {items.map((item) => {
        const produtoId = String(item.produtoId);
        const separatedValue = editable
          ? separation[produtoId]
          : item.quantidadeSeparada;
        const hasSeparation =
          separatedValue !== null &&
          separatedValue !== undefined &&
          separatedValue !== "";
        const separated = hasSeparation ? Number(separatedValue) : null;
        const missing = separated === null
          ? null
          : Math.max(Number(item.quantidade) - separated, 0);
        const excess = separated === null
          ? null
          : Math.max(separated - Number(item.quantidade), 0);
        let itemStatus = item.situacaoSeparacao || "pendente";
        if (editable && deriveEditableStatus && separated !== null) {
          itemStatus = excess > 0
            ? "excedente"
            : separated === 0 && Number(item.quantidade) > 0
            ? "indisponivel"
            : missing > 0
              ? "parcial"
              : "completo";
        }

        return (
          <div
            className={`${styles.itemRow} ${!showFulfillment ? styles.customerItemRow : ""}`}
            key={`${produtoId}-${item.nomeProduto}`}
          >
            <div className={styles.itemIdentity}>
              <strong>{item.nomeProduto}</strong>
              {showFulfillment && <span data-item-status={itemStatus}>
                {ITEM_STATUS_LABELS[itemStatus] || itemStatus}
              </span>}
            </div>
            <div className={styles.quantityCell}>
              <span>Solicitado</span>
              <strong>{item.quantidade}</strong>
            </div>
            {showFulfillment && <div className={styles.quantityCell}>
              <span>{separatedLabel}</span>
              {editable ? (
                <input
                  aria-label={`Quantidade separada de ${item.nomeProduto}`}
                  type="number"
                  min="0"
                  max={item.quantidade}
                  step="any"
                  required
                  value={separation[produtoId] ?? ""}
                  onChange={(event) => onSeparationChange(produtoId, event.target.value)}
                />
              ) : (
                <strong>{separated ?? "—"}</strong>
              )}
            </div>}
            {showFulfillment && <div className={styles.quantityCell} data-shortage={(missing > 0 || excess > 0) || undefined}>
              <span>{excess > 0 ? "Excedente" : "Faltante"}</span>
              <strong>{excess > 0 ? excess : missing ?? "—"}</strong>
            </div>}
            {showPrices && (
              <div className={styles.priceCell}>
                <span>{formatCurrency(item.valorUnitario)} / un.</span>
                <strong>{formatCurrency(item.subtotal)}</strong>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default OrderItems;
