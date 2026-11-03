// Ambiente local de homologação do Natal Premiado 2026.
//
// - Banco MongoDB em memória (mongodb-memory-server): o MONGO_URI do .env é ignorado.
// - Comprovantes ficam em memória: nada é enviado ao Cloudinary.
//   Com HOMOLOG_CLOUDINARY_REAL=true, usa o Cloudinary do .env, mas somente na
//   pasta isolada atualpet/natal-2026-homologacao (nunca a pasta oficial).
// - As datas da campanha são liberadas só neste processo, via NATAL2026_INICIO
//   e NATAL2026_FIM_CADASTROS; o código e a produção mantêm as datas oficiais.
// - Todos os dados somem quando o processo é encerrado.
//
// Uso: npm run homolog:natal  (contas fictícias em CONTAS_HOMOLOGACAO, abaixo)

import bcrypt from "bcryptjs";
import { MongoMemoryReplSet } from "mongodb-memory-server";

if (process.env.NODE_ENV === "production") {
  console.error("Homologação bloqueada: NODE_ENV=production.");
  process.exit(1);
}

export const CONTAS_HOMOLOGACAO = Object.freeze({
  admin: { email: "admin.natal@homologacao.local", senha: "Natal2026!Admin", nome: "Admin Homologação" },
  comercial: { email: "leticia.natal@homologacao.local", senha: "Natal2026!Leticia", nome: "Letícia (Comercial)" },
  distribuidor: { email: "distribuidor.natal@homologacao.local", senha: "Natal2026!Distribuidor", nome: "João Distribuidor" },
});

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
const mongoUri = replSet.getUri("natal-homologacao");
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(mongoUri)) {
  console.error("Homologação bloqueada: o banco não é local.");
  process.exit(1);
}

const CLOUDINARY_REAL = process.env.HOMOLOG_CLOUDINARY_REAL === "true";

// Definidas antes de carregar o servidor: o dotenv não sobrescreve variáveis existentes.
Object.assign(process.env, {
  NODE_ENV: "development",
  PORT: process.env.HOMOLOG_PORT || "5000",
  MONGO_URI: mongoUri,
  MONGO_AUTO_INDEX: "true",
  JWT_SECRET: "homologacao-natal-2026-segredo-local-ficticio-0001",
  JWT_EXPIRES_IN: "12h",
  ...(CLOUDINARY_REAL ? {
    NATAL2026_CLOUDINARY_PASTA: "atualpet/natal-2026-homologacao/comprovantes",
  } : {
    CLOUDINARY_CLOUD_NAME: "homologacao-sem-cloudinary",
    CLOUDINARY_API_KEY: "homologacao-sem-cloudinary",
    CLOUDINARY_API_SECRET: "homologacao-sem-cloudinary",
  }),
  CORS_ORIGIN: "http://localhost:5173,http://127.0.0.1:5173",
  FRONTEND_URL: "http://localhost:5173",
  NATAL2026_INICIO: process.env.NATAL2026_INICIO || "2026-10-29T00:00:00.000-03:00",
  NATAL2026_FIM_CADASTROS: process.env.NATAL2026_FIM_CADASTROS || "2026-12-10T23:59:59.999-03:00",
});

const { criarStorageMemoria, setComprovanteStorage } = await import("../services/natalComprovanteService.js");
if (!CLOUDINARY_REAL) setComprovanteStorage(criarStorageMemoria());

const { default: mongoose } = await import("mongoose");
await mongoose.connect(mongoUri);
const { default: Usuario } = await import("../models/Usuario.js");
const { default: TabelaPreco } = await import("../models/TabelaPreco.js");
const { default: Produto } = await import("../models/Produto.js");
const { default: PrecoProduto } = await import("../models/PrecoProduto.js");
const { default: Pedido } = await import("../models/Pedido.js");
const { gerarNumeroPedido } = await import("../utils/gerarNumeroPedido.js");
const { NATAL_2026 } = await import("../config/natalPremiado2026.js");

const tabela = await TabelaPreco.create({ nome: "Tabela Homologação Natal", tipo: "distribuidor", ativa: true });
const produtos = await Produto.create([
  { nome: "Shampoo Profissional 5L (homologação)", linha: "Banho", categoria: "Shampoo", descricao: "Produto fictício de homologação" },
  { nome: "Condicionador Profissional 5L (homologação)", linha: "Banho", categoria: "Condicionador", descricao: "Produto fictício de homologação" },
  { nome: "Perfume Pet 1L (homologação)", linha: "Finalização", categoria: "Perfume", descricao: "Produto fictício de homologação" },
]);
const precos = [1000, 500, 250];
await PrecoProduto.create(produtos.map((produto, indice) => ({ produtoId: produto._id, tabelaPrecoId: tabela._id, valor: precos[indice] })));

const criarConta = async (tipo, conta, extra = {}) => Usuario.create({
  nomeResponsavel: conta.nome,
  email: conta.email,
  senha: await bcrypt.hash(conta.senha, 10),
  tipo,
  statusCadastro: "aprovado",
  aprovadoEm: new Date(),
  ...extra,
});

await criarConta("admin", CONTAS_HOMOLOGACAO.admin);
await criarConta("comercial", CONTAS_HOMOLOGACAO.comercial);
const distribuidor = await criarConta("cliente", CONTAS_HOMOLOGACAO.distribuidor, {
  nomeFantasia: "Distribuidora Homologação Natal",
  razaoSocial: "Distribuidora Homologação Natal LTDA",
  cnpj: "11222333000181",
  telefone: "11987654321",
  whatsapp: "11987654321",
  cidade: "São Paulo",
  estado: "SP",
  tabelaPrecoId: tabela._id,
});

// Pedido inicial de R$ 12.000 (12 × R$ 1.000), aguardando aprovação.
const agora = new Date();
const pedido = await Pedido.create({
  numeroPedido: await gerarNumeroPedido(),
  clienteId: distribuidor._id,
  origem: "cliente",
  nomeResponsavel: distribuidor.nomeResponsavel,
  nomeFantasiaCliente: distribuidor.nomeFantasia,
  razaoSocialCliente: distribuidor.razaoSocial,
  cnpjCliente: distribuidor.cnpj,
  emailCliente: distribuidor.email,
  whatsappCliente: distribuidor.whatsapp,
  tabelaPrecoId: tabela._id,
  nomeTabela: tabela.nome,
  dia: agora.getDate(),
  mes: agora.getMonth() + 1,
  ano: agora.getFullYear(),
  itens: [{ produtoId: produtos[0]._id, nomeProduto: produtos[0].nome, quantidade: 12, valorUnitario: 1000, subtotal: 12000 }],
  valorTotal: 12000,
  status: "aguardando_aprovacao",
  conferenciaObrigatoria: true,
  fechamentoLogisticoObrigatorio: true,
  observacao: "Pedido fictício de homologação do Natal Premiado 2026",
});

await import("../server.js");

console.log([
  "",
  "=== Homologação Natal Premiado 2026 pronta (banco em memória) ===",
  `Backend:  http://localhost:${process.env.PORT}/api`,
  "Frontend: http://localhost:5173",
  `Campanha liberada de ${NATAL_2026.inicio.toISOString()} a ${NATAL_2026.fimCadastros.toISOString()}`,
  `Pedido de R$ 12.000 aguardando aprovação: ${pedido.numeroPedido}`,
  "Contas fictícias: CONTAS_HOMOLOGACAO em src/scripts/homologacaoNatal2026.js",
  CLOUDINARY_REAL ? "Comprovantes: Cloudinary real, pasta atualpet/natal-2026-homologacao/comprovantes" : "Comprovantes: em memória",
  "",
].join("\n"));

const encerrar = async () => {
  await mongoose.disconnect().catch(() => {});
  await replSet.stop().catch(() => {});
};
process.once("SIGINT", encerrar);
process.once("SIGTERM", encerrar);
