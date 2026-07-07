export const clearAuthSession = () => {
  localStorage.removeItem("token");
  localStorage.removeItem("usuario");
  sessionStorage.removeItem("authValidatedAt");
};

const parseStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem("usuario"));
  } catch {
    return null;
  }
};

const decodeJwtPayload = (token) => {
  const [, payload] = token.split(".");

  if (!payload) {
    return null;
  }

  try {
    const normalizedPayload = payload.replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = normalizedPayload.padEnd(
      normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
      "="
    );
    const decodedPayload = window.atob(paddedPayload);

    return JSON.parse(decodedPayload);
  } catch {
    return null;
  }
};

export const getAuthSession = () => {
  const token = localStorage.getItem("token");
  const usuario = parseStoredUser();

  if (!token || !usuario?.tipo) {
    return null;
  }

  const payload = decodeJwtPayload(token);

  if (!payload?.exp || payload.exp * 1000 <= Date.now()) {
    return null;
  }

  if (payload.tipo && payload.tipo !== usuario.tipo) {
    return null;
  }

  return {
    token,
    usuario,
    payload,
  };
};
