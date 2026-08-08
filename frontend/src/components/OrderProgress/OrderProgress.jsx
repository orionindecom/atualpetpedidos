import {
  formatOrderStatus,
  getOrderProgress,
  ORDER_PROGRESS_STEPS,
} from "../../utils/orderLogistics";
import styles from "./OrderProgress.module.css";

function OrderProgress({ status }) {
  const progress = getOrderProgress(status);

  if (progress.canceled) {
    return <div className={styles.canceled}>Pedido cancelado</div>;
  }

  return (
    <ol className={styles.timeline} aria-label="Andamento do pedido">
      {ORDER_PROGRESS_STEPS.map((step, index) => {
        const isComplete = status === "entregue" || index < progress.currentIndex;
        const isCurrent = index === progress.currentIndex && status !== "entregue";
        return (
          <li
            key={step}
            className={`${isComplete ? styles.complete : ""} ${isCurrent ? styles.current : ""}`}
            aria-current={isCurrent ? "step" : undefined}
          >
            <span aria-hidden="true">{isComplete ? "✓" : isCurrent ? "•" : ""}</span>
            <strong>{formatOrderStatus(step)}</strong>
          </li>
        );
      })}
    </ol>
  );
}

export default OrderProgress;
