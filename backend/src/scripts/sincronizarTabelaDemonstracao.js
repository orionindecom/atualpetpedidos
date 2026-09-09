import dotenv from "dotenv";
import mongoose from "mongoose";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import Produto from "../models/Produto.js";
import TabelaPreco from "../models/TabelaPreco.js";
import PrecoProduto from "../models/PrecoProduto.js";

const NOME = "Tabela Demonstração";
const normalizar = (v) => String(v ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
const id = (v) => String(v);
const ordenar = (v) => Array.isArray(v) ? v.map(ordenar) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])])) : v;
const hash = (docs) => createHash("sha256").update(JSON.stringify(JSON.parse(JSON.stringify(docs)).sort((a,b) => id(a._id).localeCompare(id(b._id))).map(ordenar))).digest("hex");

export function planejar(estado) {
  const { produtos, tabelas, precos } = estado;
  const candidatas = tabelas.filter((t) => normalizar(t.nome) === normalizar(NOME));
  const tabela = candidatas[0] ?? null;
  const ativos = produtos.filter((p) => p.ativo === true);
  const idsAtivos = new Set(ativos.map((p) => id(p._id)));
  const existentes = tabela ? precos.filter((p) => id(p.tabelaPrecoId) === id(tabela._id)) : [];
  const bloqueios = [];
  if (candidatas.length > 1) bloqueios.push("Mais de uma Tabela Demonstração normalizada");
  if (produtos.some((p) => typeof p.ativo !== "boolean")) bloqueios.push("Produto com status ativo ausente/inválido; confirmar antes de gravar");
  if (tabela?.ativa === false) bloqueios.push("Tabela Demonstração existente está inativa");
  if (new Set(existentes.map((p) => id(p.produtoId))).size !== existentes.length) bloqueios.push("Associações duplicadas na Tabela Demonstração");
  const porProduto = new Map(existentes.map((p) => [id(p.produtoId), p]));
  const plano = ativos.map((p) => ({ produtoId: id(p._id), nome: p.nome, linha: p.linha, valor: 1,
    acao: !porProduto.has(id(p._id)) ? "criar" : porProduto.get(id(p._id)).valor === 1 ? "inalterado" : "atualizar" }));
  const remover = existentes.filter((p) => !idsAtivos.has(id(p.produtoId))).map((p) => ({ precoId: id(p._id), produtoId: id(p.produtoId), motivo: produtos.some((x) => id(x._id) === id(p.produtoId)) ? "produto inativo" : "produto inexistente (associação órfã)" }));
  if (plano.length !== idsAtivos.size) bloqueios.push("IDs ativos duplicados no catálogo");
  return { modo: "SIMULACAO", tabela, totalProdutos: produtos.length, produtosAtivos: ativos.length,
    produtosInativos: produtos.filter((p) => p.ativo === false).length, itensPlanejados: plano.length,
    precoAplicado: 1, produtosNovosPlanejados: 0, outrasTabelasPlanejadas: 0, ativosForaDoPlano: ativos.filter((p) => !plano.some((x) => x.produtoId === id(p._id))).length,
    previstos: { criar: plano.filter((p) => p.acao === "criar").length, atualizar: plano.filter((p) => p.acao === "atualizar").length, inalterado: plano.filter((p) => p.acao === "inalterado").length, remover: remover.length }, plano, remover, bloqueios };
}

export function auditar(antes, depois, tabelaId) {
  const tabela = id(tabelaId);
  const ativos = depois.produtos.filter((p) => p.ativo === true);
  const itens = depois.precos.filter((p) => id(p.tabelaPrecoId) === tabela);
  const idsAtivos = new Set(ativos.map((p) => id(p._id)));
  const idsAntes = new Set(antes.produtos.map((p) => id(p._id)));
  const outrasTabelas = (s) => s.tabelas.filter((t) => id(t._id) !== tabela);
  const outrosPrecos = (s) => s.precos.filter((p) => id(p.tabelaPrecoId) !== tabela);
  const dio = (s) => {
    const tabelas = s.tabelas.filter((t) => normalizar(t.nome) === "dio animalli");
    const ids = new Set(tabelas.map((t) => id(t._id)));
    return { tabelas, precos: s.precos.filter((p) => ids.has(id(p.tabelaPrecoId))) };
  };
  const checks = {
    tabelasDemonstracao: depois.tabelas.filter((t) => normalizar(t.nome) === normalizar(NOME)).length,
    produtosAtivos: ativos.length, itensReais: itens.length,
    ativosAusentes: ativos.filter((p) => !itens.some((x) => id(x.produtoId) === id(p._id))).length,
    inativosOuOrfaosIncluidos: itens.filter((p) => !idsAtivos.has(id(p.produtoId))).length,
    precosDiferentesDeUm: itens.filter((p) => p.valor !== 1).length,
    duplicidades: itens.length - new Set(itens.map((p) => id(p.produtoId))).size,
    produtosNovosCriados: depois.produtos.filter((p) => !idsAntes.has(id(p._id))).length,
    produtosIntactos: hash(antes.produtos) === hash(depois.produtos),
    outrasTabelasIntactas: hash(outrasTabelas(antes)) === hash(outrasTabelas(depois)),
    outrosPrecosIntactos: hash(outrosPrecos(antes)) === hash(outrosPrecos(depois)),
    dioAnimalliIntacta: hash(dio(antes).tabelas) === hash(dio(depois).tabelas) && hash(dio(antes).precos) === hash(dio(depois).precos),
  };
  const ok = checks.tabelasDemonstracao === 1 && checks.itensReais === checks.produtosAtivos && ["ativosAusentes","inativosOuOrfaosIncluidos","precosDiferentesDeUm","duplicidades","produtosNovosCriados"].every((k) => checks[k] === 0) && ["produtosIntactos","outrasTabelasIntactas","outrosPrecosIntactos","dioAnimalliIntacta"].every((k) => checks[k]);
  const amostras = [];
  for (const p of ativos) {
    if (!amostras.some((a) => a.linha === p.linha) || p.nome === "Shampoo The Luxe Pré-Lavagem 1:5 5L") amostras.push({ produtoId: id(p._id), nome: p.nome, linha: p.linha, valor: itens.find((x) => id(x.produtoId) === id(p._id))?.valor ?? null });
  }
  return { ok, checks, amostras };
}

async function fotografia(session) {
  // Leituras sequenciais para compatibilidade com sessões/transações MongoDB.
  const produtos = await Produto.collection.find({}, { session }).toArray();
  const tabelas = await TabelaPreco.collection.find({}, { session }).toArray();
  const precos = await PrecoProduto.collection.find({}, { session }).toArray();
  return { produtos, tabelas, precos };
}

export async function executar() {
  dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });
  const { values: args } = parseArgs({ options: { apply: { type: "boolean", default: false }, "permitir-producao": { type: "boolean", default: false }, report: { type: "string", default: `reports/tabela-demonstracao-${Date.now()}.json` } } });
  const destino = resolve(args.report);
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, "{}\n", { flag: "wx" });
  let relatorio = { modo: "INICIADO", comando: [process.execPath, ...process.argv.slice(1)] };
  const salvar = () => writeFile(destino, JSON.stringify(relatorio, null, 2)+"\n");
  try {
    if (!process.env.MONGO_URI) throw new Error("MONGO_URI não configurada");
    await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
    const antes = await fotografia();
    relatorio = { ...relatorio, ...planejar(antes), consultadoEm: new Date().toISOString() };
    await salvar();
    if (relatorio.bloqueios.length || relatorio.ativosForaDoPlano) throw new Error(relatorio.bloqueios.join("; ") || "Ativo fora do plano");
    if (args.apply) {
      if (!["development","test","staging"].includes(process.env.NODE_ENV) && !args["permitir-producao"]) throw new Error("Ambiente exige --permitir-producao");
      const hello = await mongoose.connection.db.admin().command({ hello: 1 });
      if (!hello.setName && hello.msg !== "isdbgrid") throw new Error("MongoDB sem suporte a transações");
      const ti = await TabelaPreco.collection.indexes();
      const pi = await PrecoProduto.collection.indexes();
      if (!ti.some((i) => i.unique && !i.sparse && !i.partialFilterExpression && Object.keys(i.key).length === 1 && i.key.nome === 1) || !pi.some((i) => i.unique && !i.sparse && !i.partialFilterExpression && Object.keys(i.key).length === 2 && i.key.tabelaPrecoId === 1 && i.key.produtoId === 1)) throw new Error("Índices únicos obrigatórios ausentes");
      await writeFile(`${destino}.antes.json`, JSON.stringify(antes,null,2)+"\n", {flag:"wx"});
      const session = await mongoose.startSession();
      let resultado;
      try {
        await session.withTransaction(async () => {
          const atual = await fotografia(session);
          if (["produtos","tabelas","precos"].some((k) => hash(antes[k]) !== hash(atual[k]))) throw new Error("Estado mudou desde a simulação; repetir sem gravar");
          const plano = planejar(atual);
          if (plano.bloqueios.length || plano.ativosForaDoPlano) throw new Error("Plano inconsistente dentro da transação");
          let tabela = plano.tabela;
          if (!tabela) [tabela] = await TabelaPreco.create([{ nome: NOME, tipo: "distribuidor", ativa: true, descricao: "Demonstrações/testes: todos os produtos ativos a R$ 1,00." }], { session });
          for (const item of plano.plano.filter((p) => p.acao !== "inalterado")) {
            await PrecoProduto.updateOne({ tabelaPrecoId: tabela._id, produtoId: item.produtoId }, { $set: { valor: 1 } }, { upsert: true, runValidators: true, session });
          }
          // Exclusão estritamente limitada às associações da própria Demonstração.
          if (plano.remover.length) await PrecoProduto.deleteMany({ tabelaPrecoId: tabela._id, _id: { $in: plano.remover.map((p) => p.precoId) } }, { session });
          const auditoria = auditar(atual, await fotografia(session), tabela._id);
          if (!auditoria.ok) throw new Error(`Auditoria falhou: rollback. ${JSON.stringify(auditoria.checks)}`);
          resultado = { ...plano, tabela, modo: "APLICADO", auditoriaTransacao: auditoria };
        });
      } finally { await session.endSession(); }
      relatorio = { ...relatorio, ...resultado, commitEm: new Date().toISOString() };
      await salvar();
      const depois = await fotografia();
      await writeFile(`${destino}.depois.json`, JSON.stringify(depois,null,2)+"\n", {flag:"wx"});
      relatorio.auditoriaAposCommit = auditar(antes, depois, relatorio.tabela._id);
      const novamente = planejar(depois);
      relatorio.reexecucaoPrevista = novamente.previstos;
      if (!relatorio.auditoriaAposCommit.ok || novamente.bloqueios.length || ["criar","atualizar","remover"].some((k) => novamente.previstos[k])) throw new Error("Falha na conferência após commit; ver relatório (gravação já confirmada)");
    }
    await salvar();
    const { plano, remover, auditoriaTransacao, ...resumo } = relatorio;
    console.log(JSON.stringify(resumo,null,2));
    return relatorio;
  } catch (error) {
    relatorio.erro = String(error.message).replaceAll(process.env.MONGO_URI || "__ausente__", "[URI ocultada]");
    await salvar();
    throw new Error(relatorio.erro);
  } finally { await mongoose.disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) executar().catch((e) => { console.error(e.message); process.exitCode = 1; });
