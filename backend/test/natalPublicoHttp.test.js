import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

// Período de homologação aberto "agora" para exercitar o envio público real via HTTP.
const agora = Date.now();
process.env.NATAL2026_INICIO = new Date(agora - 5 * 24 * 60 * 60 * 1000).toISOString();
process.env.NATAL2026_FIM_CADASTROS = new Date(agora + 5 * 24 * 60 * 60 * 1000).toISOString();
process.env.JWT_SECRET ||= "segredo-de-teste-com-mais-de-32-caracteres!!";

const { natalPublicRoutes } = await import("../src/routes/natalRoutes.js");
const { mensagemEnvioPublico } = await import("../src/controllers/natalController.js");
const { criarStorageMemoria, setComprovanteStorage } = await import("../src/services/natalComprovanteService.js");
const { sincronizarPedidoNatal } = await import("../src/services/natalLoteService.js");
const { default: Pedido } = await import("../src/models/Pedido.js");
const { default: NatalParticipacao } = await import("../src/models/NatalParticipacao.js");
const { default: NatalConta } = await import("../src/models/NatalConta.js");
const { NatalCampanhaEstado } = await import("../src/models/NatalCampanhaEstado.js");

let replSet;
let server;
let base;
const storage = criarStorageMemoria();

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: "natal-http" });
  setComprovanteStorage(storage);
  await NatalCampanhaEstado.create({ _id: "natal-2026", modoCumulativo: "ativo" });
  const app = express();
  app.use("/api/public/natal-2026", natalPublicRoutes);
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/public/natal-2026`;
});

after(async () => {
  server?.close();
  setComprovanteStorage(null);
  await mongoose.disconnect();
  await replSet?.stop();
});

const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

const formulario = (extra = {}) => {
  const form = new FormData();
  const campos = {
    vendedorNome: "Joana Vendas",
    nomeFantasia: "Pet Shop Estrela",
    razaoSocial: "Estrela Pet LTDA",
    documento: "11.222.333/0001-81",
    responsavel: "Marcos Lima",
    whatsapp: "(21) 99876-5432",
    instagram: "@petestrela",
    dataCompra: hoje(),
    valorCompra: "1.250,90",
    aceiteTermos: "true",
    iniciadoEm: String(Date.now() - 30000),
    ...extra,
  };
  for (const [campo, valor] of Object.entries(campos)) form.append(campo, valor);
  return form;
};

const png = () => new Blob([Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(500, 7)])], { type: "image/png" });

test("14 e 30. envio público sem login (multipart, como no celular) fica pendente", async () => {
  const pedido = await Pedido.create({
    numeroPedido: "PED-HTTP-1",
    clienteId: new mongoose.Types.ObjectId(),
    nomeFantasiaCliente: "Distribuidora Norte",
    tabelaPrecoId: new mongoose.Types.ObjectId(),
    dia: 1, mes: 11, ano: 2026,
    itens: [{ produtoId: new mongoose.Types.ObjectId(), nomeProduto: "Kit", quantidade: 1, valorUnitario: 30000, subtotal: 30000 }],
    valorTotal: 30000,
    status: "aprovado",
  });
  const { conta } = await sincronizarPedidoNatal({ pedido, usuario: null, origem: "aprovacao" });
  assert.equal(conta.cupons.total, 300);

  const info = await fetch(`${base}/lotes/${conta.codigoPublico}`).then((r) => r.json());
  assert.equal(info.aceitandoCadastros, true);
  assert.equal(info.distribuidorNome, "Distribuidora Norte");

  const semArquivo = await fetch(`${base}/lotes/${conta.codigoPublico}/participacoes`, { method: "POST", body: formulario() });
  assert.equal(semArquivo.status, 400);
  assert.ok((await semArquivo.json()).errors.comprovante);

  const camposInvalidos = formulario({ documento: "12.345.678/0001-00", instagram: "" });
  camposInvalidos.append("comprovante", png(), "nota.png");
  const invalido = await fetch(`${base}/lotes/${conta.codigoPublico}/participacoes`, { method: "POST", body: camposInvalidos });
  assert.equal(invalido.status, 400);
  const erros = (await invalido.json()).errors;
  assert.ok(erros.documento && erros.instagram);

  const rapido = formulario({ iniciadoEm: String(Date.now()) });
  rapido.append("comprovante", png(), "nota.png");
  assert.equal((await fetch(`${base}/lotes/${conta.codigoPublico}/participacoes`, { method: "POST", body: rapido })).status, 400);

  const form = formulario();
  form.append("comprovante", png(), "IMG_0001.png");
  const envio = await fetch(`${base}/lotes/${conta.codigoPublico}/participacoes`, { method: "POST", body: form });
  const corpo = await envio.json();
  assert.equal(envio.status, 201, corpo.message);
  assert.equal(corpo.message, mensagemEnvioPublico(1));
  assert.match(corpo.protocolo, /^NP26-[A-Z2-9]{8}$/);

  const salvo = await NatalParticipacao.findOne({ protocolo: corpo.protocolo });
  assert.equal(salvo.status, "pendente");
  assert.equal(salvo.petshop.documento, "11222333000181");
  assert.equal(salvo.petshop.instagram, "petestrela");
  assert.equal(salvo.compra.valor, 1250.9);
  assert.equal(String(salvo.clienteId), String(pedido.clienteId));
  assert.notEqual(salvo.origem.ipHash, "127.0.0.1", "IP não é guardado em texto puro");
  assert.equal((await NatalConta.findById(conta._id)).contadores.pendentes, 1);
  assert.equal(storage.arquivos.size, 1);
});
