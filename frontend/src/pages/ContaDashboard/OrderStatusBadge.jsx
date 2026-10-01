import { orderStatusTone } from "./orderStatusTone";
import styles from "./OrderStatusBadge.module.css";

function OrderStatusBadge({ status, label }) {
  return <span className={styles.badge} data-tone={orderStatusTone(status)}>{label}</span>;
}

export default OrderStatusBadge;
