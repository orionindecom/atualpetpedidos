import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import compression from "compression";
import mongoose from "mongoose";
import { parseAllowedOrigins, validateEnv } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { generalLimiter } from "./middlewares/rateLimitMiddleware.js";
import { performanceMiddleware } from "./utils/performance.js";
import {
  sanitizeRequest,
  securityHeaders,
} from "./middlewares/securityMiddleware.js";
import authRoutes from "./routes/authRoutes.js";
import clienteRoutes from "./routes/clienteRoutes.js";
import produtoRoutes from "./routes/produtoRoutes.js";
import tabelaPrecoRoutes from "./routes/tabelaPrecoRoutes.js";
import precoProdutoRoutes from "./routes/precoProdutoRoutes.js";
import catalogoRoutes from "./routes/catalogoRoutes.js";
import pedidoRoutes from "./routes/pedidoRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import adminMaterialMarketingRoutes from "./routes/adminMaterialMarketingRoutes.js";
import materialMarketingRoutes from "./routes/materialMarketingRoutes.js";

dotenv.config({ quiet: true });

const app = express();

const allowedOrigins = parseAllowedOrigins();

app.set("trust proxy", 1);

app.use(performanceMiddleware);
app.use(securityHeaders);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origem não autorizada pelo CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    optionsSuccessStatus: 204,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(compression());
app.use(sanitizeRequest);

app.get("/health/live", (req, res) => {
  return res.status(200).json({ status: "ok" });
});

app.get("/health/ready", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ status: "indisponível" });
    }

    await mongoose.connection.db.command({ ping: 1 }, { maxTimeMS: 1000 });
    return res.status(200).json({ status: "ok" });
  } catch (error) {
    return res.status(503).json({ status: "indisponível" });
  }
});

app.use(generalLimiter);
app.use(
  "/uploads",
  express.static("src/uploads", {
    dotfiles: "deny",
    index: false,
    maxAge: "1d",
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/clientes", clienteRoutes);
app.use("/api/produtos", produtoRoutes);
app.use("/api/tabelas", tabelaPrecoRoutes);
app.use("/api/precos", precoProdutoRoutes);
app.use("/api/catalogo", catalogoRoutes);
app.use("/api/pedidos", pedidoRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/admin/materiais-marketing", adminMaterialMarketingRoutes);
app.use("/api/materiais-marketing", materialMarketingRoutes);

app.get("/", (req, res) => {
  res.json({ message: "API AtualPet rodando" });
});

app.use((req, res) => {
  return res.status(404).json({ message: "Rota não encontrada" });
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err.message === "Origem não autorizada pelo CORS") {
    return res.status(403).json({
      message: "Origem não autorizada",
    });
  }

  if (err.message === "Tipo de arquivo não permitido") {
    return res.status(400).json({
      message: "Tipo de arquivo não permitido",
    });
  }

  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE"
      ? "Arquivo muito grande. Envie uma imagem de até 5MB."
      : "Arquivo de upload inválido";

    return res.status(400).json({
      message,
    });
  }

  return res.status(500).json({
    message: "Erro interno do servidor",
  });
});

const PORT = process.env.PORT || 5000;
let server;
let shuttingDown = false;

const shutdown = (signal) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`Encerramento iniciado por ${signal}`);

  const forceExitTimer = setTimeout(() => {
    console.error("Tempo limite de encerramento excedido");
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  server.close(async () => {
    await mongoose.disconnect();
    clearTimeout(forceExitTimer);
    process.exit(0);
  });
};

const startServer = async () => {
  validateEnv();
  await connectDB();

  server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });

  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
};

startServer().catch((error) => {
  const message = error?.message?.startsWith("Configuração obrigatória")
    ? error.message
    : "Falha ao iniciar o servidor";

  console.error(message);
  process.exit(1);
});
