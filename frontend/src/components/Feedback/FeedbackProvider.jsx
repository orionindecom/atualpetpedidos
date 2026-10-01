import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import FeedbackDialog from "./FeedbackDialog";
import FeedbackIcon from "./FeedbackIcon";
import { FeedbackContext } from "./feedbackContext";
import {
  createSingleFlight,
  createToast,
  normalizeDialogOptions,
  pushToast,
  runDialogAction,
  validateDialogField,
} from "./feedbackCore";
import dialogStyles from "./FeedbackDialog.module.css";
import styles from "./Toast.module.css";

const TOAST_ICONS = { success: "check", error: "error", warning: "alert", info: "info" };

function Toast({ toast, onDismiss }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || !toast.duration) return undefined;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [onDismiss, paused, toast.duration, toast.id]);

  return (
    <div
      className={styles.toast}
      data-variant={toast.variant}
      role={toast.variant === "error" ? "alert" : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className={styles.icon}><FeedbackIcon name={TOAST_ICONS[toast.variant]} /></span>
      <div className={styles.text}>
        <strong>{toast.title}</strong>
        {toast.description && <span>{toast.description}</span>}
      </div>
      <button type="button" className={styles.close} onClick={() => onDismiss(toast.id)} aria-label="Fechar notificação">
        <FeedbackIcon name="close" />
      </button>
    </div>
  );
}

function DialogHost({ dialog, onConfirm, onCancel, onValueChange }) {
  const fieldId = useId();
  const inputRef = useRef(null);
  const { options, phase, error, value, view } = dialog;

  // Erro de validação devolve o foco ao campo.
  useEffect(() => {
    if (error && options.field) inputRef.current?.focus();
  }, [error, options.field]);

  if (phase === "success") {
    return (
      <FeedbackDialog
        variant={view.variant || "success"}
        icon={view.icon}
        title={view.title}
        message={view.message}
        details={view.details || []}
        confirmLabel={view.confirmLabel || "Concluir"}
        onConfirm={onConfirm}
      />
    );
  }
  const field = options.field;
  return (
    <FeedbackDialog
      variant={options.variant}
      icon={options.icon}
      title={options.title}
      message={options.message}
      details={options.details}
      confirmLabel={options.confirmLabel}
      cancelLabel={options.cancelLabel}
      busy={phase === "busy"}
      busyLabel={options.busyLabel}
      error={error}
      dismissible={options.dismissible}
      focusContent={Boolean(field)}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {field && (
        <div className={dialogStyles.field}>
          <label htmlFor={fieldId}>{field.label}</label>
          <input
            ref={inputRef}
            autoFocus
            id={fieldId}
            type={field.type || "text"}
            value={value}
            autoComplete={field.autoComplete || "off"}
            maxLength={field.maxLength}
            disabled={phase === "busy"}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={field.help ? `${fieldId}-help` : undefined}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onConfirm();
              }
            }}
          />
          {field.help && <small id={`${fieldId}-help`}>{field.help}</small>}
        </div>
      )}
    </FeedbackDialog>
  );
}

// Provedor único de diálogos e toasts da Central.
export function FeedbackProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const [toasts, setToasts] = useState([]);
  const dialogRef = useRef(null);
  const [flight] = useState(createSingleFlight);

  useEffect(() => {
    dialogRef.current = dialog;
  }, [dialog]);

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const showToast = useCallback((variant, title, options) => {
    setToasts((current) => pushToast(current, createToast(variant, title, options)));
  }, []);

  const openDialog = useCallback((kind, rawOptions) => new Promise((resolve) => {
    // Um diálogo aberto é encerrado como cancelado antes de abrir outro.
    dialogRef.current?.resolve(false);
    const options = normalizeDialogOptions(kind, rawOptions);
    setDialog({ options, phase: "idle", error: "", value: options.field?.initialValue || "", resolve });
  }), []);

  const finish = useCallback((result) => {
    const current = dialogRef.current;
    if (!current) return;
    current.resolve(result);
    setDialog(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    const current = dialogRef.current;
    if (!current || flight.running) return;
    if (current.phase === "success") {
      finish(true);
      return;
    }
    const fieldError = validateDialogField(current.options.field, current.value);
    if (fieldError) {
      setDialog({ ...current, error: fieldError });
      return;
    }
    if (!current.options.action) {
      finish(true);
      return;
    }
    setDialog({ ...current, phase: "busy", error: "" });
    const { skipped, value: outcome } = await flight.run(() => runDialogAction(current.options, current.value));
    if (skipped) return;
    if (outcome.status === "error") {
      setDialog((latest) => (latest && { ...latest, phase: "idle", error: outcome.message }));
      return;
    }
    if (outcome.status === "success") {
      setDialog((latest) => (latest && { ...latest, phase: "success", view: outcome.view }));
      return;
    }
    finish(true);
    if (outcome.toast) showToast(outcome.toast.variant || "success", outcome.toast.title, outcome.toast);
  }, [finish, flight, showToast]);

  const handleCancel = useCallback(() => {
    if (flight.running) return;
    finish(false);
  }, [finish, flight]);

  const value = useMemo(() => ({
    dialog: {
      confirm: (options) => openDialog("confirm", options),
      alert: (options) => openDialog("alert", options),
    },
    toast: {
      success: (title, options) => showToast("success", title, options),
      error: (title, options) => showToast("error", title, options),
      warning: (title, options) => showToast("warning", title, options),
      info: (title, options) => showToast("info", title, options),
    },
  }), [openDialog, showToast]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {dialog && (
        <DialogHost
          dialog={dialog}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          onValueChange={(next) => setDialog((current) => current && { ...current, value: next, error: "" })}
        />
      )}
      {createPortal(
        <div className={styles.region} aria-label="Notificações" role="region" aria-live="polite" aria-relevant="additions">
          {toasts.map((toast) => <Toast key={toast.id} toast={toast} onDismiss={dismissToast} />)}
        </div>,
        document.body
      )}
    </FeedbackContext.Provider>
  );
}

export default FeedbackProvider;
