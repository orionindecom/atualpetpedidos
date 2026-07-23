import styles from "./PageHeader.module.css";

function PageHeader({
  eyebrow,
  title,
  description,
  action,
  children,
  className = "",
}) {
  return (
    <header className={`${styles.header} ${className}`}>
      <div className={styles.copy}>
        {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {children}
      </div>
      {action && <div className={styles.action}>{action}</div>}
    </header>
  );
}

export default PageHeader;
