// Regras do sistema de feedback, independentes de React.
//
// Dialog: decisões, ações destrutivas, bloqueios e informações que precisam
//   ser lidas antes de continuar (recebimento, exclusão, cadastro em análise).
// Toast: resultado de operações simples e erros que não bloqueiam a tela.
// Inline: validação de campo e mensagens dentro do próprio formulário/modal.
import { getApiErrorMessage } from "../../utils/apiErrors.js";

export const TOAST_DURATIONS = { success: 5000, info: 6000, warning: 7000, error: 9000 };
export const TOAST_LIMIT = 4;

export function normalizeDialogOptions(kind, options = {}) {
  const isConfirm = kind === "confirm";
  return {
    variant: options.variant || (isConfirm ? "confirm" : "info"),
    icon: options.icon,
    title: options.title || "",
    message: options.message || "",
    details: options.details || [],
    field: options.field || null,
    confirmLabel: options.confirmLabel || (isConfirm ? "Confirmar" : "Entendi"),
    cancelLabel: isConfirm ? (options.cancelLabel || "Cancelar") : null,
    busyLabel: options.busyLabel,
    action: options.action || null,
    success: options.success || null,
    successToast: options.successToast || null,
    errorFallback: options.errorFallback || "Não foi possível concluir a operação.",
    dismissible: options.dismissible !== false,
  };
}

export function validateDialogField(field, value = "") {
  if (!field) return "";
  const text = String(value);
  if (field.required !== false && !text.trim()) return field.requiredMessage || `Informe ${field.label.toLowerCase()}.`;
  if (field.minLength && text.length < field.minLength) return `Use pelo menos ${field.minLength} caracteres.`;
  if (field.maxLength && text.length > field.maxLength) return `Use no máximo ${field.maxLength} caracteres.`;
  return "";
}

const resolveView = (view, result) => (typeof view === "function" ? view(result) : view);

// Executa a ação do diálogo. O diálogo só fecha depois da resposta da API:
// sucesso pode transformar o próprio diálogo ou virar toast; erro mantém o diálogo aberto.
export async function runDialogAction(options, value) {
  if (!options.action) return { status: "done" };
  try {
    const result = await options.action(value);
    if (options.success) return { status: "success", view: resolveView(options.success, result) };
    return { status: "done", toast: resolveView(options.successToast, result) };
  } catch (error) {
    return { status: "error", message: getApiErrorMessage(error, options.errorFallback) };
  }
}

// Garante uma única execução por vez: cliques repetidos durante a requisição são ignorados.
export function createSingleFlight() {
  let running = false;
  return {
    get running() { return running; },
    async run(task) {
      if (running) return { skipped: true };
      running = true;
      try {
        return { skipped: false, value: await task() };
      } finally {
        running = false;
      }
    },
  };
}

export function createToast(variant, title, options = {}, id = Date.now() + Math.random()) {
  return {
    id,
    variant: TOAST_DURATIONS[variant] ? variant : "info",
    title,
    description: options.description || "",
    duration: options.duration ?? TOAST_DURATIONS[variant] ?? TOAST_DURATIONS.info,
  };
}

// Mais recentes por último; mantém no máximo TOAST_LIMIT visíveis.
export const pushToast = (list, toast) => [...list, toast].slice(-TOAST_LIMIT);
