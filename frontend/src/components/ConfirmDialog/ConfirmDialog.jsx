import FeedbackDialog from "../Feedback/FeedbackDialog";

const VARIANT_BY_TONE = { default: "confirm", warning: "warning", danger: "danger" };

// Confirmação declarativa para modais que controlam o próprio estado
// (descartar alterações, trocar vendedor). Usa o mesmo FeedbackDialog do sistema.
function ConfirmDialog({
  title,
  message,
  children,
  icon,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  busyLabel = "Salvando...",
  tone = "default",
  busy = false,
  onConfirm,
  onCancel,
}) {
  return (
    <FeedbackDialog
      variant={VARIANT_BY_TONE[tone] || "confirm"}
      icon={icon}
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      busy={busy}
      busyLabel={busyLabel}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {children}
    </FeedbackDialog>
  );
}

export default ConfirmDialog;
