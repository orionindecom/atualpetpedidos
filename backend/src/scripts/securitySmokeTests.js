import dotenv from "dotenv";
import { assertMutationAllowed } from "../utils/scriptSafety.js";

dotenv.config({ quiet: true });

const API_URL = (process.env.API_URL || "http://localhost:5000").replace(
  /\/$/,
  ""
);

const config = {
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  clientEmail: process.env.CLIENT_EMAIL,
  clientPassword: process.env.CLIENT_PASSWORD,
  clientToken: process.env.CLIENT_TOKEN,
  inactiveClientToken: process.env.INACTIVE_CLIENT_TOKEN,
  productId: process.env.PRODUCT_ID,
  unauthorizedOrigin: process.env.UNAUTHORIZED_ORIGIN || "https://evil.example",
  runRateLimit: process.env.RUN_RATE_LIMIT === "true",
};

const results = [];

const request = async (path, options = {}) => {
  const response = await fetch(`${API_URL}${path}`, options);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  return { response, body };
};

const authHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
});

const run = async (name, fn) => {
  try {
    const result = await fn();
    results.push({ name, ...result });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
};

const skip = (detail) => ({ ok: true, skipped: true, detail });

const expectStatus = (actual, expected) => {
  if (actual !== expected) {
    throw new Error(`Status esperado ${expected}, recebido ${actual}`);
  }
};

const expectOneOfStatuses = (actual, expectedStatuses) => {
  if (!expectedStatuses.includes(actual)) {
    throw new Error(
      `Status esperado ${expectedStatuses.join("/")}, recebido ${actual}`
    );
  }
};

let adminToken = process.env.ADMIN_TOKEN;
let clientToken = config.clientToken;
let mockAuthServer;
let mockAuthJwt;

const getMockAuthServer = async () => {
  if (mockAuthServer) {
    return mockAuthServer;
  }

  process.env.JWT_SECRET ||= "smoke-test-secret-with-at-least-32-chars";

  const [{ default: express }, jwt, { default: Usuario }] = await Promise.all([
    import("express"),
    import("jsonwebtoken"),
    import("../models/Usuario.js"),
  ]);

  Usuario.findById = (id) => ({
    select: async () => {
      const tipo = String(id).endsWith("001") ? "admin" : "cliente";

      return {
        _id: id,
        tipo,
        ativo: true,
        statusCadastro: "aprovado",
        tokenVersion: 0,
      };
    },
  });

  const [
    { default: produtoRoutes },
    { default: tabelaPrecoRoutes },
    { default: precoProdutoRoutes },
    { default: clienteRoutes },
    { default: dashboardRoutes },
  ] = await Promise.all([
    import("../routes/produtoRoutes.js"),
    import("../routes/tabelaPrecoRoutes.js"),
    import("../routes/precoProdutoRoutes.js"),
    import("../routes/clienteRoutes.js"),
    import("../routes/dashboardRoutes.js"),
  ]);

  const app = express();
  app.use(express.json());
  app.use("/api/clientes", clienteRoutes);
  app.use("/api/produtos", produtoRoutes);
  app.use("/api/tabelas", tabelaPrecoRoutes);
  app.use("/api/precos", precoProdutoRoutes);
  app.use("/api/dashboard", dashboardRoutes);

  const server = await new Promise((resolve) => {
    const startedServer = app.listen(0, "127.0.0.1", () => {
      resolve(startedServer);
    });
  });

  mockAuthJwt = jwt;
  mockAuthServer = {
    server,
    baseURL: `http://127.0.0.1:${server.address().port}`,
  };

  return mockAuthServer;
};

const requestWithMockAuth = async (path, tipo) => {
  const { baseURL } = await getMockAuthServer();
  const id =
    tipo === "admin"
      ? "000000000000000000000001"
      : "000000000000000000000002";
  const token = mockAuthJwt.default.sign(
    {
      id,
      tipo,
      tokenVersion: 0,
    },
    process.env.JWT_SECRET,
    {
      algorithm: "HS256",
      expiresIn: "5m",
    }
  );

  const response = await fetch(`${baseURL}${path}`, {
    headers: authHeaders(token),
  });

  return { response, body: null };
};

await run("login sem senha", async () => {
  const { response } = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: config.clientEmail || "cliente@example.com" }),
  });

  expectStatus(response.status, 401);
  return { ok: true };
});

await run("login errado repetido ate rate limit", async () => {
  if (!config.runRateLimit) {
    return skip(
      "Defina RUN_RATE_LIMIT=true para executar este teste destrutivo de janela."
    );
  }

  let lastStatus = 0;

  for (let index = 0; index < 12; index += 1) {
    const { response } = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: config.clientEmail || "rate-limit@example.com",
        senha: "senha-incorreta",
      }),
    });

    lastStatus = response.status;

    if (lastStatus === 429) {
      return { ok: true };
    }
  }

  throw new Error(`Rate limit nao acionou; ultimo status ${lastStatus}`);
});

await run("login admin valido", async () => {
  if (adminToken) {
    return skip("ADMIN_TOKEN ja informado.");
  }

  if (!config.adminEmail || !config.adminPassword) {
    return skip("Defina ADMIN_EMAIL e ADMIN_PASSWORD.");
  }

  const { response, body } = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: config.adminEmail,
      senha: config.adminPassword,
    }),
  });

  expectStatus(response.status, 200);
  adminToken = body?.token;

  if (!adminToken) {
    throw new Error("Token admin nao retornado.");
  }

  return { ok: true };
});

await run("login cliente valido", async () => {
  if (clientToken) {
    return skip("CLIENT_TOKEN ja informado.");
  }

  if (!config.clientEmail || !config.clientPassword) {
    return skip("Defina CLIENT_EMAIL e CLIENT_PASSWORD.");
  }

  const { response, body } = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: config.clientEmail,
      senha: config.clientPassword,
    }),
  });

  expectStatus(response.status, 200);
  clientToken = body?.token;

  if (!clientToken) {
    throw new Error("Token cliente nao retornado.");
  }

  return { ok: true };
});

await run("cliente acessando rota admin", async () => {
  if (!clientToken) {
    return skip("Defina CLIENT_TOKEN ou credenciais do cliente.");
  }

  const { response } = await request("/api/dashboard", {
    headers: authHeaders(clientToken),
  });

  expectStatus(response.status, 403);
  return { ok: true };
});

await run("admin acessando rota admin", async () => {
  if (!adminToken) {
    return skip("Defina ADMIN_TOKEN ou credenciais admin.");
  }

  const { response } = await request("/api/dashboard", {
    headers: authHeaders(adminToken),
  });

  expectStatus(response.status, 200);
  return { ok: true };
});

const adminRouteChecks = [
  {
    name: "clientes",
    path: "/api/clientes",
    adminStatuses: [200],
  },
  {
    name: "produtos",
    path: "/api/produtos",
    adminStatuses: [200],
  },
  {
    name: "tabelas",
    path: "/api/tabelas",
    adminStatuses: [200],
  },
  {
    name: "precos",
    path: "/api/precos/tabela/000000000000000000000000",
    adminStatuses: [200],
  },
  {
    name: "dashboard",
    path: "/api/dashboard",
    adminStatuses: [200],
  },
];

for (const routeCheck of adminRouteChecks) {
  await run(`${routeCheck.name} sem token retorna 401`, async () => {
    const { response } = await request(routeCheck.path);

    expectStatus(response.status, 401);
    return { ok: true };
  });

  await run(`${routeCheck.name} com token cliente retorna 403`, async () => {
    const { response } = clientToken
      ? await request(routeCheck.path, {
          headers: authHeaders(clientToken),
        })
      : await requestWithMockAuth(routeCheck.path, "cliente");

    expectStatus(response.status, 403);
    return { ok: true };
  });

  await run(`${routeCheck.name} com token admin passa pela autorizacao`, async () => {
    if (!adminToken) {
      return skip("Defina ADMIN_TOKEN ou credenciais admin.");
    }

    const { response } = await request(routeCheck.path, {
      headers: authHeaders(adminToken),
    });

    expectOneOfStatuses(response.status, routeCheck.adminStatuses);
    return { ok: true };
  });
}

await run("token invalido", async () => {
  const { response } = await request("/api/catalogo", {
    headers: authHeaders("token-invalido"),
  });

  expectStatus(response.status, 401);
  return { ok: true };
});

await run("token expirado", async () => {
  const expiredToken = process.env.EXPIRED_TOKEN;

  if (!expiredToken) {
    return skip("Defina EXPIRED_TOKEN.");
  }

  const { response } = await request("/api/catalogo", {
    headers: authHeaders(expiredToken),
  });

  expectStatus(response.status, 401);
  return { ok: true };
});

await run("cliente inativado usando token antigo", async () => {
  if (!config.inactiveClientToken) {
    return skip(
      "Defina INACTIVE_CLIENT_TOKEN capturado antes de inativar o cliente."
    );
  }

  const { response } = await request("/api/catalogo", {
    headers: authHeaders(config.inactiveClientToken),
  });

  if (![401, 403].includes(response.status)) {
    throw new Error(`Status esperado 401/403, recebido ${response.status}`);
  }

  return { ok: true };
});

await run("upload invalido com MIME falso", async () => {
  if (!adminToken) {
    return skip("Defina ADMIN_TOKEN ou credenciais admin.");
  }

  const form = new FormData();
  form.set("nome", "Smoke Test Upload");
  form.set("linha", "Smoke");
  form.set("categoria", "Smoke");
  form.set("descricao", "Arquivo falso enviado pelo smoke test.");
  form.set(
    "foto",
    new Blob(["not a real image"], { type: "image/png" }),
    "fake.png"
  );

  const { response } = await request("/api/produtos", {
    method: "POST",
    headers: authHeaders(adminToken),
    body: form,
  });

  expectStatus(response.status, 400);
  return { ok: true };
});

await run("ID invalido", async () => {
  if (!adminToken) {
    return skip("Defina ADMIN_TOKEN ou credenciais admin.");
  }

  const { response } = await request("/api/produtos/id-invalido", {
    method: "DELETE",
    headers: authHeaders(adminToken),
  });

  expectStatus(response.status, 400);
  return { ok: true };
});

await run("CORS com origem nao autorizada", async () => {
  const { response } = await request("/api/auth/login", {
    method: "OPTIONS",
    headers: {
      Origin: config.unauthorizedOrigin,
      "Access-Control-Request-Method": "POST",
    },
  });

  expectStatus(response.status, 403);
  return { ok: true };
});

await run("pedido com preco manipulado pelo frontend", async () => {
  if (!clientToken || !config.productId) {
    return skip(
      "Defina CLIENT_TOKEN/credenciais do cliente e PRODUCT_ID com preco na tabela do cliente."
    );
  }

  assertMutationAllowed({
    action: "criar pedido no smoke test",
    confirmationVariable: "CONFIRM_MUTATING_TESTS",
  });

  const { response, body } = await request("/api/pedidos", {
    method: "POST",
    headers: {
      ...authHeaders(clientToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tabelaPrecoId: "000000000000000000000000",
      valorTotal: 0.01,
      itens: [
        {
          produtoId: config.productId,
          quantidade: 1,
          valorUnitario: 0.01,
          subtotal: 0.01,
        },
      ],
    }),
  });

  expectStatus(response.status, 201);

  if (
    body?.pedido?.valorTotal === 0.01 ||
    body?.pedido?.itens?.[0]?.valorUnitario === 0.01
  ) {
    throw new Error("Pedido aceitou preco manipulado pelo frontend.");
  }

  return { ok: true };
});

const failed = results.filter((result) => !result.ok);

for (const result of results) {
  const status = result.ok ? (result.skipped ? "SKIP" : "OK") : "FAIL";
  console.log(
    `${status} - ${result.name}${result.detail ? `: ${result.detail}` : ""}`
  );
}

if (mockAuthServer) {
  await new Promise((resolve) => mockAuthServer.server.close(resolve));
}

if (failed.length > 0) {
  process.exit(1);
}
