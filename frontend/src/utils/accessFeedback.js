// Feedbacks do ciclo de acesso: cadastro enviado, cadastro não aprovado e conta desativada.
// Usa somente os estados que o backend informa; não inventa motivos de recusa.
import { getApiErrorMessage } from "./apiErrors.js";

export const REGISTRATION_SENT_DIALOG = {
  variant: "success",
  icon: "userCheck",
  title: "Cadastro enviado!",
  message: "Recebemos seus dados. Agora vamos analisar seu cadastro. Assim que ele for aprovado, você poderá entrar na Central.",
  confirmLabel: "Ir para o login",
  dismissible: false,
};

export const GROOMER_REGISTRATION_SENT_DIALOG = {
  ...REGISTRATION_SENT_DIALOG,
  message: "Recebemos seus dados de Groomer. Agora vamos analisar seu cadastro. Assim que ele for aprovado, você poderá entrar na Central.",
};

// Códigos do login (POST /auth/login, HTTP 403) após a validação da senha.
export const REGISTRATION_PENDING = "REGISTRATION_PENDING";
export const REGISTRATION_REJECTED = "REGISTRATION_REJECTED";

export const PENDING_APPROVAL_DIALOG = {
  variant: "pending",
  icon: "hourglass",
  title: "Cadastro em análise",
  message: "Seu cadastro ainda está sendo analisado. Quando ele for aprovado, seu acesso à Central será liberado.",
  confirmLabel: "Entendi",
};

// O backend não retorna motivo público de reprovação: nada é inventado nem prometido.
export const REJECTED_REGISTRATION_DIALOG = {
  variant: "warning",
  icon: "fileX",
  title: "Cadastro não aprovado",
  message: "Seu cadastro não foi aprovado para acesso à Central Atual Pet.",
  confirmLabel: "Entendi",
};

export const ACCOUNT_DISABLED_DIALOG = {
  variant: "warning",
  icon: "lock",
  title: "Acesso desativado",
  message: "Esta conta está desativada e não pode entrar na Central no momento. Para voltar a acessar, fale com a equipe Atual Pet.",
  confirmLabel: "Entendi",
};

// Outros bloqueios sem código (estados legados) mantêm a mensagem segura do backend.
const blockedAccessDialog = (message) => ({
  variant: "warning",
  icon: "lock",
  title: "Acesso não liberado",
  message: message || "Esta conta ainda não pode entrar na Central.",
  confirmLabel: "Entendi",
});

// Pendente e reprovado são identificados pelo code; nunca pelo texto da mensagem.
export function classifyLoginError(error) {
  const status = error?.response?.status;
  const data = error?.response?.data || {};
  if (status === 403 && data.code === REGISTRATION_PENDING) return { dialog: PENDING_APPROVAL_DIALOG };
  if (status === 403 && data.code === REGISTRATION_REJECTED) return { dialog: REJECTED_REGISTRATION_DIALOG };
  // Conta desativada preserva o contrato anterior: 403 sem code, mensagem "Usuário desativado".
  if (status === 403 && !data.code && /desativad/i.test(String(data.message || ""))) return { dialog: ACCOUNT_DISABLED_DIALOG };
  if (status === 403) return { dialog: blockedAccessDialog(typeof data.message === "string" ? data.message : "") };
  if (status === 401) return { message: "E-mail ou senha inválidos. Confira os dados e tente novamente." };
  return { message: getApiErrorMessage(error, "Não foi possível entrar agora. Tente novamente.") };
}
