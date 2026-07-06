import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { parseAllowedOrigins, validateEnv } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { generalLimiter } from "./middlewares/rateLimitMiddleware.js";
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

dotenv.config();

validateEnv();
connectDB();

const app = express();

const allowedOrigins = parseAllowedOrigins();

app.set("trust proxy", 1);

app.use(securityHeaders);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origem não autorizada pelo CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    optionsSuccessStatus: 204,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(sanitizeRequest);
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

app.get("/", (req, res) => {
  res.json({ message: "API AtualPet rodando" });
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
      message: err.message,
    });
  }

  return res.status(500).json({
    message: "Erro interno do servidor",
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
