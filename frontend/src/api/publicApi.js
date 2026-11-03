import axios from "axios";

// Cliente HTTP das páginas públicas (sem login): não envia token nem
// redireciona para o login em respostas 401, ao contrário de api/axios.js.
const normalizeBaseURL = (url) => url.replace(/\/+$/, "");
const configuredBaseURL = import.meta.env.VITE_API_URL?.trim();
const hasAbsoluteBaseURL = /^https?:\/\//i.test(configuredBaseURL || "");

const publicApi = axios.create({
  baseURL: normalizeBaseURL(
    import.meta.env.DEV && !hasAbsoluteBaseURL
      ? "http://localhost:5000/api"
      : configuredBaseURL || "/api"
  ),
  timeout: 60000,
});

export default publicApi;
