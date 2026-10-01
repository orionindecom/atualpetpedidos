import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useModalDialog } from "../../hooks/useModalDialog";
import FeedbackIcon from "./FeedbackIcon";
import styles from "./FeedbackDialog.module.css";

const DEFAULT_ICONS = {
  confirm: "info",
  danger: "trash",
  success: "check",
  error: "error",
  warning: "alert",
  info: "info",
  pending: "hourglass",
};

// Diálogos que pedem decisão ou comunicam algo urgente usam alertdialog.
const ALERT_VARIANTS = new Set(["confirm", "danger", "warning", "error"]);

// Diálogo de feedback da Central: confirmação, sucesso, erro, aviso, informação e pendência.
// Cancelar recebe o foco inicial em decisões, para que Enter nunca confirme sem querer.
function FeedbackDialog({
  variant = "confirm",
  icon,
  title,
  message,
  details = [],
  children,
  confirmLabel = "Entendi",
  cancelLabel,
  busy = false,
  busyLabel,
  error = "",
  dismissible = true,
  focusContent = false,
  onConfirm,
  onCancel,
}) {
  const id = useId().replaceAll(":", "");
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);
  const hasCancel = Boolean(cancelLabel);
  const close = hasCancel ? onCancel : onConfirm;
  const dialogRef = useModalDialog({
    onClose: dismissible ? close : undefined,
    closeDisabled: busy || !dismissible,
    // Com campo de preenchimento, o foco vai para o campo marcado com autoFocus.
    initialFocusRef: focusContent ? undefined : hasCancel ? cancelRef : confirmRef,
  });

  // Quando o próprio diálogo muda de estado (ex.: confirmação → sucesso),
  // o foco acompanha a nova ação principal.
  useEffect(() => {
    if (!hasCancel && dialogRef.current?.contains(document.activeElement) === false) {
      confirmRef.current?.focus({ preventScroll: true });
    }
  }, [dialogRef, hasCancel, title]);

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible && !busy) close?.();
      }}
    >
      <section
        ref={dialogRef}
        className={styles.dialog}
        role={ALERT_VARIANTS.has(variant) ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-message`}
        aria-busy={busy || undefined}
        tabIndex="-1"
        data-variant={variant}
      >
        <span className={styles.icon} key={`${variant}-${icon}`}>
          <FeedbackIcon name={icon || DEFAULT_ICONS[variant] || "info"} />
        </span>
        <h2 id={`${id}-title`}>{title}</h2>
        <div id={`${id}-message`} className={styles.message}>
          {message && <p>{message}</p>}
          {details.map((item) => (
            <div className={styles.detail} key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
          {children}
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <footer className={styles.actions}>
          {hasCancel && (
            <button ref={cancelRef} type="button" className={styles.secondaryButton} onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            className={variant === "danger" ? styles.dangerButton : styles.primaryButton}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? (busyLabel || "Aguarde...") : confirmLabel}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}

export default FeedbackDialog;
