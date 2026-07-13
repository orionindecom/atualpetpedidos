import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
const API_URL = BASE_URL.endsWith("/api") ? BASE_URL : `${BASE_URL}/api`;
const hostMatch = BASE_URL.match(/^https?:\/\/(\[[^\]]+\]|[^/:]+)/i);

if (!hostMatch) {
  throw new Error("BASE_URL invalida. Informe uma URL HTTP ou HTTPS completa.");
}

const targetHost = hostMatch[1].replace(/^\[|\]$/g, "").toLowerCase();
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const isLocal = localHosts.has(targetHost);
const allowedRemoteHosts = new Set(
  (__ENV.LOAD_TEST_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
);
const targetEnvironment = (__ENV.TARGET_ENV || "").trim().toLowerCase();

if (!isLocal && !allowedRemoteHosts.has(targetHost)) {
  throw new Error(
    `Host remoto ${targetHost} bloqueado. Inclua o hostname exato em ` +
      "LOAD_TEST_ALLOWED_HOSTS somente apos autorizacao."
  );
}

if (!isLocal && targetEnvironment === "staging") {
  // A allowlist exata acima e suficiente para staging autorizado.
} else if (!isLocal && targetEnvironment === "production") {
  if (
    __ENV.ALLOW_PRODUCTION_LOAD_TEST !== "true" ||
    __ENV.CONFIRM_PRODUCTION_LOAD_TEST !== "I_UNDERSTAND_THIS_HITS_PRODUCTION"
  ) {
    throw new Error(
      "Producao exige ALLOW_PRODUCTION_LOAD_TEST=true e " +
        "CONFIRM_PRODUCTION_LOAD_TEST=I_UNDERSTAND_THIS_HITS_PRODUCTION."
    );
  }
} else if (!isLocal) {
  throw new Error("Host remoto exige TARGET_ENV=staging ou TARGET_ENV=production.");
}

const duration = __ENV.DURATION || "20s";
const catalogVus = Number(__ENV.CATALOG_VUS || 2);
const filterVus = Number(__ENV.FILTER_VUS || 1);
const loginIterations = Number(__ENV.LOGIN_ITERATIONS || 4);
const runOrderLoad = __ENV.RUN_ORDER_LOAD === "true";

if (
  runOrderLoad &&
  !["test", "staging"].includes((__ENV.NODE_ENV || "").toLowerCase()) &&
  __ENV.CONFIRM_MUTATING_TESTS !== "true"
) {
  throw new Error(
    "Carga de pedidos exige NODE_ENV=test/staging ou " +
      "CONFIRM_MUTATING_TESTS=true."
  );
}

const scenarios = {
  login: {
    executor: "shared-iterations",
    exec: "loginFlow",
    vus: 1,
    iterations: loginIterations,
    maxDuration: "30s",
  },
  catalogo: {
    executor: "constant-vus",
    exec: "catalogFlow",
    vus: catalogVus,
    duration,
  },
  filtros: {
    executor: "constant-vus",
    exec: "filterFlow",
    vus: filterVus,
    duration,
  },
};

if (runOrderLoad) {
  scenarios.pedidos = {
    executor: "shared-iterations",
    exec: "orderFlow",
    vus: 1,
    iterations: Number(__ENV.ORDER_ITERATIONS || 2),
    maxDuration: "30s",
  };
}

export const options = {
  scenarios,
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<1200"],
  },
};

const credentials = () => ({
  email: __ENV.CLIENT_EMAIL,
  senha: __ENV.CLIENT_PASSWORD,
});

const login = () => http.post(
  `${API_URL}/auth/login`,
  JSON.stringify(credentials()),
  { headers: { "Content-Type": "application/json" }, tags: { fluxo: "login" } }
);

export function setup() {
  if (!__ENV.CLIENT_EMAIL || !__ENV.CLIENT_PASSWORD) {
    throw new Error("CLIENT_EMAIL e CLIENT_PASSWORD sao obrigatorios.");
  }

  const response = login();
  const ok = check(response, { "setup login 200": (res) => res.status === 200 });

  if (!ok) {
    throw new Error("Nao foi possivel autenticar o cliente de teste.");
  }

  return { token: response.json("token") };
}

export function loginFlow() {
  const response = login();
  check(response, { "login 200": (res) => res.status === 200 });
  sleep(1);
}

export function catalogFlow(data) {
  const response = http.get(`${API_URL}/catalogo?pagina=1&limite=12`, {
    headers: { Authorization: `Bearer ${data.token}` },
    tags: { fluxo: "catalogo" },
  });
  check(response, {
    "catalogo 200": (res) => res.status === 200,
    "catalogo paginado": (res) => Boolean(res.json("paginacao")),
  });
  sleep(1);
}

export function filterFlow(data) {
  const busca = encodeURIComponent(__ENV.SEARCH_TERM || "shampoo");
  const response = http.get(
    `${API_URL}/catalogo?pagina=1&limite=12&busca=${busca}`,
    {
      headers: { Authorization: `Bearer ${data.token}` },
      tags: { fluxo: "filtros" },
    }
  );
  check(response, { "filtro 200": (res) => res.status === 200 });
  sleep(1);
}

export function orderFlow(data) {
  if (!__ENV.PRODUCT_ID) {
    throw new Error("PRODUCT_ID e obrigatorio quando RUN_ORDER_LOAD=true.");
  }

  const response = http.post(
    `${API_URL}/pedidos`,
    JSON.stringify({
      itens: [{ produtoId: __ENV.PRODUCT_ID, quantidade: 1 }],
      observacao: "Teste de carga autorizado",
    }),
    {
      headers: {
        Authorization: `Bearer ${data.token}`,
        "Content-Type": "application/json",
      },
      tags: { fluxo: "pedidos" },
    }
  );
  check(response, { "pedido 201": (res) => res.status === 201 });
  sleep(1);
}
