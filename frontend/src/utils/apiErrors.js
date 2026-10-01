// Traduz respostas de erro da API ({ message, errors? }) em mensagens de interface.
// Mensagens do backend para 400/409 já são escritas para o usuário e são preservadas.
const STATUS_MESSAGES = {
  401: "Sua sessão expirou. Entre novamente para continuar.",
  403: "Você não tem permissão para realizar esta ação.",
  404: "Registro não encontrado. Ele pode ter sido removido por outra pessoa.",
  500: "Ocorreu um erro no servidor. Tente novamente em instantes.",
};

export function getApiErrorMessage(error, fallback = "Não foi possível concluir a operação.") {
  if (!error?.response) {
    if (error?.code === "ECONNABORTED") return "O servidor demorou para responder. Tente novamente.";
    return error?.request
      ? "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente."
      : fallback;
  }
  const { status, data } = error.response;
  const fieldErrors = data?.errors && typeof data.errors === "object"
    ? Object.values(data.errors).filter(Boolean)
    : [];
  if (fieldErrors.length) return fieldErrors.join(" ");
  if ([400, 409].includes(status) && data?.message) return data.message;
  return STATUS_MESSAGES[status] || data?.message || fallback;
}

export const isConflictError = (error) => error?.response?.status === 409;
