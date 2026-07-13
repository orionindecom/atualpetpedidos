import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Usuario from "../models/Usuario.js";

dotenv.config({ quiet: true });

const API_URL = (process.env.API_URL || "http://localhost:5000")
  .replace(/\/+$/, "")
  .replace(/\/api$/, "");

const requestCatalog = async (token, query) => {
  const response = await fetch(`${API_URL}/api/catalogo?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI, {
    autoIndex: false,
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 10000,
  });

  const cliente = await Usuario.findOne({
    tipo: "cliente",
    ativo: true,
    statusCadastro: "aprovado",
    tabelaPrecoId: { $ne: null },
  })
    .select("_id tipo tabelaPrecoId tokenVersion")
    .lean();

  assert(cliente, "Nenhum cliente aprovado disponível para o smoke test");

  const token = jwt.sign(
    {
      id: cliente._id,
      tipo: cliente.tipo,
      tabelaPrecoId: cliente.tabelaPrecoId,
      tokenVersion: cliente.tokenVersion ?? 0,
    },
    process.env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: "5m" }
  );

  await mongoose.disconnect();

  const legada = await requestCatalog(token, "");
  assert(legada.response.status === 200, "Resposta legada nao retornou 200");
  assert(Array.isArray(legada.body), "Resposta legada deve ser um array");

  const primeira = await requestCatalog(token, "pagina=1&limite=12");
  assert(primeira.response.status === 200, "Primeira página não retornou 200");
  assert(Array.isArray(primeira.body?.produtos), "Resposta sem produtos");
  assert(primeira.body.produtos.length <= 12, "Limite da página não respeitado");
  assert(primeira.body?.paginacao?.pagina === 1, "Metadados de página inválidos");

  if (primeira.body.paginacao.temMais) {
    const segunda = await requestCatalog(token, "pagina=2&limite=12");
    assert(segunda.response.status === 200, "Segunda página não retornou 200");
    const ids = new Set(primeira.body.produtos.map(({ id }) => String(id)));
    assert(
      segunda.body.produtos.every(({ id }) => !ids.has(String(id))),
      "Produtos repetidos entre páginas"
    );
  }

  const linha = primeira.body?.filtros?.linhas?.[0];

  if (linha) {
    const filtrada = await requestCatalog(
      token,
      `pagina=1&limite=12&linha=${encodeURIComponent(linha)}`
    );
    assert(filtrada.response.status === 200, "Filtro de linha não retornou 200");
    assert(
      filtrada.body.produtos.every((produto) => produto.linha === linha),
      "Filtro de linha retornou produto incorreto"
    );
  }

  const invalida = await requestCatalog(token, "pagina=0&limite=12");
  assert(invalida.response.status === 400, "Página inválida não retornou 400");

  console.log("OK - paginação, ausência de duplicados e filtros do catálogo");
};

run()
  .catch((error) => {
    console.error(`FAIL - ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
