import FeedbackIcon from "../Feedback/FeedbackIcon";
import styles from "./EmptyState.module.css";

// Estado vazio com direção: explica a situação e oferece a próxima ação quando existir.
function EmptyState({ title, description, action, icon = "orders", headingLevel = 2 }) {
  const Heading = `h${headingLevel}`;
  return (
    <div className={styles.empty}>
      <span className={styles.icon}><FeedbackIcon name={icon} /></span>
      <Heading>{title}</Heading>
      {description && <p>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}

export default EmptyState;
