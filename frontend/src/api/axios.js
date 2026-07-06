import axios from "axios";

const normalizeBaseURL = (url) => url.replace(/\/+$/, "");
const configuredBaseURL = import.meta.env.VITE_API_URL?.trim();
const hasAbsoluteBaseURL = /^https?:\/\//i.test(configuredBaseURL || "");

const apiBaseURL = normalizeBaseURL(
  import.meta.env.DEV && !hasAbsoluteBaseURL
    ? "http://localhost:5000/api"
    : configuredBaseURL || "/api"
);

const api = axios.create({
  baseURL: apiBaseURL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

export default api;
