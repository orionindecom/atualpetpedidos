import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDB } from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import clienteRoutes from "./routes/clienteRoutes.js";
import produtoRoutes from "./routes/produtoRoutes.js";
import tabelaPrecoRoutes from "./routes/tabelaPrecoRoutes.js";
import precoProdutoRoutes from "./routes/precoProdutoRoutes.js";
import catalogoRoutes from "./routes/catalogoRoutes.js";
import pedidoRoutes from "./routes/pedidoRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";

dotenv.config();

connectDB();

const app = express();

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("src/uploads"));

app.use("/api/auth", authRoutes);
app.use("/api/clientes", clienteRoutes);
app.use("/api/produtos", produtoRoutes);
app.use("/api/tabelas", tabelaPrecoRoutes);
app.use("/api/precos", precoProdutoRoutes);
app.use("/api/catalogo", catalogoRoutes);
app.use("/api/pedidos", pedidoRoutes);
app.use(
  "/uploads",
  express.static("src/uploads")
);
app.use("/api/dashboard", dashboardRoutes);

app.get("/", (req, res) => {
  res.json({ message: "API AtualPet rodando" });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});