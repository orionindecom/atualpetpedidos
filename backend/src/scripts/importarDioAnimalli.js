import dotenv from "dotenv";
import mongoose from "mongoose";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import Produto from "../models/Produto.js";
import TabelaPreco from "../models/TabelaPreco.js";
import PrecoProduto from "../models/PrecoProduto.js";
import aprovacao from "./data/dioAnimalliAprovado.json" with { type: "json" };

const NOME = "Dio Animalli";
export const normalizar = (v) => String(v ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
// Somente espaço entre número e unidade; nunca remove diluição, fragrância ou marca.
const nomeNormalizado = (v) => normalizar(v).replace(/(\d)\s+(ml|kg|l|g)\b/g, "$1$2");
const camposId = ["ean", "sku", "codigo", "codigoBarras", "gtin"];
const resumoProduto = (p) => ({ produtoId: String(p._id), produto: p.nome });

export function localizar(registro, produtos) {
  const ids = camposId.filter((campo) => registro[campo]);
  const conjuntos = ids.flatMap((campo) => {
    const encontrados = produtos.filter((p) => p[campo] != null && String(p[campo]).trim() === String(registro[campo]).trim());
    return encontrados.length ? [encontrados] : [];
  });
  if (conjuntos.length) {
    const unicos = new Map(conjuntos.flat().map((p) => [String(p._id), p]));
    if (unicos.size !== 1) return { motivo: "identificador ambíguo/conflitante", candidatos: [...unicos.values()].map(resumoProduto) };
    const produto = [...unicos.values()][0];
    if (produto.ativo === false) return { motivo: "produto inativo", candidatos: [resumoProduto(produto)] };
    return { produto, criterio: "identificador exato" };
  }
  const diluicao = registro.diluicao === "-" ? "" : registro.diluicao;
  const nomes = new Set([
    [registro.nome, diluicao, registro.embalagem],
    [registro.nome, registro.embalagem, diluicao],
  ].map((partes) => nomeNormalizado(partes.filter(Boolean).join(" "))));
  const candidatos = produtos.filter((p) => nomes.has(nomeNormalizado(p.nome)));
  if (candidatos.length !== 1 || candidatos[0].ativo === false) {
    return { motivo: candidatos.length > 1 ? "nome ambíguo" : candidatos.length ? "produto inativo" : "nome completo não encontrado", candidatos: candidatos.map(resumoProduto) };
  }
  // Não contorna um identificador diferente já cadastrado usando o nome.
  if (ids.some((campo) => candidatos[0][campo] != null && String(candidatos[0][campo]).trim() !== String(registro[campo]).trim())) {
    return { motivo: "nome coincide mas identificador diverge", candidatos: candidatos.map(resumoProduto) };
  }
  return { produto: candidatos[0], criterio: "nome completo + embalagem + diluição" };
}

export function planejar(fonte, produtos, tabelas, precos, resolver = localizar) {
  const candidatas = tabelas.filter((t) => normalizar(t.nome) === normalizar(NOME));
  const r = { modo: "SIMULACAO", fonte, tabela: candidatas[0] ?? null,
    linhasValidas: fonte.registros.length, encontrados: [], naoEncontrados: [], duplicidades: [],
    bloqueios: [], plano: [], gravados: 0, verificacao: [] };
  if (candidatas.length > 1) r.bloqueios.push("Mais de uma tabela Dio Animalli normalizada");
  if (r.tabela && (r.tabela.ativa === false || (r.tabela.tipo ?? "distribuidor") !== "distribuidor")) r.bloqueios.push("Tabela existente inativa ou de outro tipo");
  const existentes = new Map();
  for (const p of precos.filter((p) => String(p.tabelaPrecoId) === String(r.tabela?._id))) {
    const id = String(p.produtoId);
    if (existentes.has(id)) { r.duplicidades.push({ tipo: "preço no banco", produtoId: id }); r.bloqueios.push("Preços duplicados na tabela"); }
    existentes.set(id, p);
  }
  const eans = new Map();
  const vinculados = new Map();
  for (const registro of fonte.registros) {
    if (registro.ean) {
      if (eans.has(registro.ean)) {
        const anterior = eans.get(registro.ean);
        r.duplicidades.push({ tipo: "EAN no Excel", ean: registro.ean, linhas: [anterior.linha, registro.linha] });
        if (resolver === localizar && produtos.some((p) => String(p.ean ?? "").trim() === registro.ean) &&
            ["nome", "embalagem", "diluicao"].some((k) => nomeNormalizado(anterior[k]) !== nomeNormalizado(registro[k]))) {
          r.bloqueios.push(`EAN ${registro.ean} identifica produtos distintos no Excel`);
        }
      } else eans.set(registro.ean, registro);
    }
    const match = resolver(registro, produtos);
    if (!match.produto) { r.naoEncontrados.push({ ...registro, ...match }); continue; }
    const id = String(match.produto._id);
    const item = { ...registro, ...resumoProduto(match.produto), criterio: match.criterio };
    r.encontrados.push(item);
    if (vinculados.has(id)) {
      const anterior = vinculados.get(id);
      r.duplicidades.push({ tipo: "produto repetido no Excel", produtoId: id, linhas: [anterior.linha, registro.linha] });
      if (anterior.valor !== registro.valor) r.bloqueios.push(`Preços conflitantes para ${id}`);
      continue;
    }
    vinculados.set(id, item);
    const existente = existentes.get(id);
    r.plano.push({ ...item, anterior: existente?.valor ?? null,
      acao: !existente ? "criar" : existente.valor === registro.valor ? "inalterado" : "atualizar" });
  }
  r.produtosEncontrados = vinculados.size;
  r.previstos = Object.fromEntries(["criar", "atualizar", "inalterado"].map((acao) => [acao, r.plano.filter((p) => p.acao === acao).length]));
  if (r.naoEncontrados.length) r.bloqueios.push("Há produtos sem correspondência segura; revisar relatório antes de aplicar");
  if (fonte.ignoradas.some((i) => i.celula)) r.bloqueios.push("Há linhas de produto com dados inválidos");
  if (!r.plano.length) r.bloqueios.push("Nenhum preço seguro para importar");
  return r;
}

export function planejarFinal(fonte, produtos, tabelas, precos) {
  const erros = [];
  if (fonte.sha256 !== aprovacao.sha256Excel || fonte.aba !== aprovacao.aba || fonte.colunaPreco !== "Valor Unitário") erros.push("Fonte diverge do Excel/aba/coluna aprovados");
  const mapa = new Map(aprovacao.registros.map((r) => [r.fonte.linha, r]));
  if (fonte.registros.length !== 160 || new Set(fonte.registros.map((r) => r.linha)).size !== 160) erros.push("Esperadas 160 linhas válidas distintas");
  for (const r of fonte.registros) {
    const esperado = mapa.get(r.linha)?.fonte;
    if (!esperado || Object.keys(esperado).some((k) => r[k] !== esperado[k]) || r.celula !== `H${r.linha}` || !Number.isFinite(r.valor) || r.valor <= 0) erros.push(`Fonte não aprovada na linha ${r.linha}`);
  }
  const excluidos = fonte.registros.filter((r) => mapa.get(r.linha)?.decisao === "excluir").map((r) => ({ ...r, motivo: mapa.get(r.linha).motivo }));
  if (excluidos.length !== 9) erros.push("Esperadas exatamente 9 exclusões aprovadas");
  const novo = aprovacao.novoProduto;
  const identidadeCorreta = (p, esperado) => ["nome", "linha", "categoria"].every((k) => normalizar(p[k]) === normalizar(esperado[k])) && p.ativo === true;
  const simplificar = (v) => normalizar(v).normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]/g, "");
  const similares = produtos.filter((p) => simplificar(p.linha).includes("theluxe") && simplificar(p.nome).includes("prelavagem"));
  const reservado = produtos.find((p) => String(p._id) === novo._id);
  if (reservado && !identidadeCorreta(reservado, novo)) erros.push("ID reservado ao novo Pré-Lavagem ocupado por cadastro diferente/inativo");
  if (similares.length > 1 || similares.some((p) => !identidadeCorreta(p, novo))) erros.push("Pré-Lavagem já possui cadastro semelhante/ambíguo/inativo; criação bloqueada");
  const existenteNovo = similares.find((p) => identidadeCorreta(p, novo));
  const produtoNovo = existenteNovo ?? novo;
  const criarProduto = !existenteNovo && !reservado;
  const catalogo = criarProduto ? [...produtos, produtoNovo] : produtos;
  const resolver = (r) => {
    const item = mapa.get(r.linha);
    const esperado = r.linha === 81 ? { ...novo, _id: String(produtoNovo._id) } : item?.produto;
    const p = esperado && catalogo.find((p) => String(p._id) === esperado._id);
    if (!p || !identidadeCorreta(p, esperado)) return { motivo: "ID aprovado ausente, inativo ou com identidade alterada", candidatos: p ? [resumoProduto(p)] : [] };
    return { produto: p, criterio: r.linha === 81 ? "único produto novo autorizado (ou reuso idempotente)" : "mapa explícito de IDs aprovado pelo usuário" };
  };
  const resultado = planejar({ ...fonte, registros: fonte.registros.filter((r) => mapa.get(r.linha)?.decisao !== "excluir") }, catalogo, tabelas, precos, resolver);
  resultado.fonte = fonte;
  resultado.linhasValidas = fonte.registros.length;
  resultado.excluidos = excluidos;
  resultado.produtoNovo = produtoNovo;
  resultado.produtosNovosPlanejados = criarProduto ? 1 : 0;
  resultado.produtosExistentesUtilizados = resultado.plano.length - resultado.produtosNovosPlanejados;
  resultado.produtosInativosUtilizados = resultado.plano.filter((p) => catalogo.find((c) => String(c._id) === p.produtoId)?.ativo !== true).length;
  if (resultado.plano.length !== 151 || new Set(resultado.plano.map((p) => p.produtoId)).size !== 151) erros.push("Plano não contém exatamente 151 produtos distintos; não forçar importação");
  if (resultado.produtosInativosUtilizados) erros.push("Produto inativo no plano");
  if (resultado.duplicidades.some((d) => d.tipo !== "EAN no Excel")) erros.push("Duplicidade de produto/preço não autorizada");
  const idsPlanejados = new Set(resultado.plano.map((p) => p.produtoId));
  if (precos.some((p) => String(p.tabelaPrecoId) === String(resultado.tabela?._id) && !idsPlanejados.has(String(p.produtoId)))) erros.push("Dio Animalli contém preços fora do plano aprovado");
  for (const [a,b] of [[69,81],[76,80],[166,168]]) {
    if (resultado.plano.find((p) => p.linha === a)?.produtoId === resultado.plano.find((p) => p.linha === b)?.produtoId) erros.push(`Linhas ${a}/${b} devem apontar para produtos distintos`);
  }
  resultado.bloqueios.push(...erros);
  return resultado;
}

const serializar = (valor) => JSON.parse(JSON.stringify(valor));
const ordenar = (v) => Array.isArray(v) ? v.map(ordenar) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])])) : v;
const hashDocumentos = (docs) => createHash("sha256").update(JSON.stringify(docs.map(serializar).sort((a,b) => String(a._id).localeCompare(String(b._id))).map(ordenar))).digest("hex");

async function fotografia(session) {
  const produtos = await Produto.collection.find({}, { session }).toArray();
  const tabelas = await TabelaPreco.collection.find({}, { session }).toArray();
  const precos = await PrecoProduto.collection.find({}, { session }).toArray();
  return { produtos, tabelas, precos };
}

export function verificarFinal(relatorio, antes, depois) {
  const tabelaId = String(relatorio.tabela._id);
  const reais = depois.precos.filter((p) => String(p.tabelaPrecoId) === tabelaId);
  const verificacao = relatorio.plano.map((p) => {
    const encontrados = reais.filter((g) => String(g.produtoId) === p.produtoId);
    return { linha: p.linha, celula: p.celula, produtoId: p.produtoId, produto: p.produto, esperado: p.valor, gravado: encontrados[0]?.valor ?? null, quantidade: encontrados.length };
  });
  const idsAntes = new Set(antes.produtos.map((p) => String(p._id)));
  const novos = depois.produtos.filter((p) => !idsAntes.has(String(p._id)));
  const outrasTabelas = (s) => s.tabelas.filter((t) => String(t._id) !== tabelaId);
  const outrosPrecos = (s) => s.precos.filter((p) => String(p.tabelaPrecoId) !== tabelaId);
  const checks = {
    tabelaUnica: depois.tabelas.filter((t) => normalizar(t.nome) === normalizar(NOME)).length === 1,
    itensReais: reais.length,
    divergenciasPreco: verificacao.filter((v) => v.esperado !== v.gravado).length,
    duplicidades: reais.length - new Set(reais.map((p) => String(p.produtoId))).size,
    produtosInativosUtilizados: reais.filter((p) => depois.produtos.find((x) => String(x._id) === String(p.produtoId))?.ativo !== true).length,
    produtosNovosCriados: novos.length,
    somenteNovoAutorizado: novos.every((p) => String(p._id) === String(relatorio.produtoNovo._id)),
    produtosExistentesIntactos: hashDocumentos(antes.produtos) === hashDocumentos(depois.produtos.filter((p) => idsAntes.has(String(p._id)))),
    outrasTabelasIntactas: hashDocumentos(outrasTabelas(antes)) === hashDocumentos(outrasTabelas(depois)),
    outrosPrecosIntactos: hashDocumentos(outrosPrecos(antes)) === hashDocumentos(outrosPrecos(depois)),
    preLavagemExiste: depois.produtos.some((p) => String(p._id) === String(relatorio.produtoNovo._id) && p.nome === aprovacao.novoProduto.nome && p.ativo === true),
    apenasIdsAprovados: reais.every((p) => relatorio.plano.some((r) => r.produtoId === String(p.produtoId))),
    noveAcessoriosExcluidos: relatorio.excluidos.length === 9 && relatorio.plano.every((p) => !relatorio.excluidos.some((e) => e.linha === p.linha)),
  };
  const ok = checks.tabelaUnica && checks.itensReais === 151 && checks.divergenciasPreco === 0 && checks.duplicidades === 0 && checks.produtosInativosUtilizados === 0 && checks.produtosNovosCriados === relatorio.produtosNovosPlanejados && ["somenteNovoAutorizado","produtosExistentesIntactos","outrasTabelasIntactas","outrosPrecosIntactos","preLavagemExiste","apenasIdsAprovados","noveAcessoriosExcluidos"].every((k) => checks[k]) && verificacao.every((v) => v.quantidade === 1);
  return { ok, checks, verificacao };
}

export async function executar() {
  dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });
  const { values: args } = parseArgs({ options: {
    file: { type: "string" }, python: { type: "string", default: process.env.PYTHON || "python" },
    report: { type: "string", default: `reports/dio-animalli-final-${Date.now()}.json` },
    apply: { type: "boolean", default: false }, "permitir-producao": { type: "boolean", default: false },
  } });
  if (!args.file) throw new Error("Informe --file caminho.xlsx");
  const reportPath = resolve(args.report);
  if (reportPath === resolve(args.file)) throw new Error("Relatório não pode sobrescrever o Excel");
  const fonte = JSON.parse(execFileSync(args.python, [fileURLToPath(new URL("./lerDioAnimalli.py", import.meta.url)), resolve(args.file)], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }));
  fonte.arquivo = resolve(args.file);
  fonte.sha256 = createHash("sha256").update(await readFile(args.file)).digest("hex");
  let relatorio = { modo: "LEITURA_EXCEL", fonte, linhasValidas: fonte.registros.length, gravados: 0 };
  const salvar = async () => { await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(relatorio, null, 2) + "\n"); };
  // Nunca sobrescreve um relatório de execução anterior, mesmo se --report o apontar.
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, "{}\n", { flag: "wx" });
  try {
    await salvar(); // Confirma acesso ao relatório antes de qualquer escrita no banco.
    if (!process.env.MONGO_URI) throw new Error("MONGO_URI não configurada");
    await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
    const antes = await fotografia();
    relatorio = planejarFinal(fonte, antes.produtos, antes.tabelas, antes.precos);
    relatorio.comando = [process.execPath, ...process.argv.slice(1)];
    relatorio.consultadoEm = new Date().toISOString();
    await salvar();
    if (args.apply) {
      if (!["development", "test", "staging"].includes(process.env.NODE_ENV) && !args["permitir-producao"]) throw new Error("Ambiente não seguro: requer --permitir-producao");
      if (relatorio.bloqueios.length) throw new Error(relatorio.bloqueios.join("; "));
      const hello = await mongoose.connection.db.admin().command({ hello: 1 });
      if (!hello.setName && hello.msg !== "isdbgrid") throw new Error("MongoDB sem suporte a transações");
      // Índices devem existir; o importador nunca cria/altera índices globais.
      const ti = await TabelaPreco.collection.indexes();
      const pi = await PrecoProduto.collection.indexes();
      if (!ti.some((i) => i.unique && Object.keys(i.key).length === 1 && i.key.nome === 1) ||
          !pi.some((i) => i.unique && Object.keys(i.key).length === 2 && i.key.tabelaPrecoId === 1 && i.key.produtoId === 1)) throw new Error("Índices únicos obrigatórios ausentes");
      // Toda a proteção usa documentos completos, inclusive timestamps e registros inativos.
      await writeFile(`${reportPath}.antes.json`, JSON.stringify(antes, null, 2)+"\n", { flag: "wx" });
      const session = await mongoose.startSession();
      let aplicado;
      try {
        await session.withTransaction(async () => {
          const antesTransacao = await fotografia(session);
          if (["produtos", "tabelas", "precos"].some((k) => hashDocumentos(antes[k]) !== hashDocumentos(antesTransacao[k]))) throw new Error("Banco mudou desde a simulação inicial desta execução; refazer simulação");
          const atual = planejarFinal(fonte, antesTransacao.produtos, antesTransacao.tabelas, antesTransacao.precos);
          if (atual.bloqueios.length) throw new Error(atual.bloqueios.join("; "));
          if (atual.produtosNovosPlanejados === 1) {
            await Produto.create([{ ...aprovacao.novoProduto }], { session });
          }
          let tabela = atual.tabela;
          if (!tabela) [tabela] = await TabelaPreco.create([{ nome: NOME, tipo: "distribuidor", ativa: true, descricao: "Preços da coluna Valor Unitário do Excel Dio Animalli" }], { session });
          for (const item of atual.plano.filter((i) => i.acao !== "inalterado")) {
            await PrecoProduto.updateOne({ tabelaPrecoId: tabela._id, produtoId: item.produtoId }, { $set: { valor: item.valor } }, { upsert: true, runValidators: true, session });
          }
          atual.tabela = tabela;
          const auditoria = verificarFinal(atual, antesTransacao, await fotografia(session));
          if (!auditoria.ok) throw new Error(`Conferência dentro da transação falhou; rollback: ${JSON.stringify(auditoria.checks)}`);
          aplicado = { ...atual, tabela, modo: "APLICADO", gravados: atual.previstos.criar + atual.previstos.atualizar, auditoriaTransacao: auditoria };
        });
      } finally { await session.endSession(); }
      relatorio = { ...aplicado, comando: relatorio.comando, consultadoEm: relatorio.consultadoEm, commitEm: new Date().toISOString() };
      await salvar();
      const depois = await fotografia();
      relatorio.auditoriaAposCommit = verificarFinal(relatorio, antes, depois);
      const final = planejarFinal(fonte, depois.produtos, depois.tabelas, depois.precos);
      relatorio.reexecucaoPrevista = { precos: final.previstos, produtosNovos: final.produtosNovosPlanejados, bloqueios: final.bloqueios };
      if (!relatorio.auditoriaAposCommit.ok || final.bloqueios.length || final.previstos.criar || final.previstos.atualizar || final.produtosNovosPlanejados) throw new Error("Divergência após commit; verificar relatório e banco");
      relatorio.verificacaoAposCommit = true;
    }
    await salvar();
    console.log(JSON.stringify({ modo: relatorio.modo, linhasValidas: relatorio.linhasValidas, itensPlanejados: relatorio.plano.length, produtosExistentesUtilizados: relatorio.produtosExistentesUtilizados, produtosNovosPlanejados: relatorio.produtosNovosPlanejados, excluidos: relatorio.excluidos.length, produtosInativosUtilizados: relatorio.produtosInativosUtilizados, previstos: relatorio.previstos, gravados: relatorio.gravados, naoEncontrados: relatorio.naoEncontrados.length, duplicidades: relatorio.duplicidades, bloqueios: relatorio.bloqueios, auditoria: relatorio.auditoriaAposCommit?.checks, relatorio: reportPath }, null, 2));
    return relatorio;
  } catch (error) {
    relatorio.erro = String(error.message).replaceAll(process.env.MONGO_URI || "__ausente__", "[URI ocultada]");
    await salvar();
    throw new Error(relatorio.erro);
  } finally { await mongoose.disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  executar().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
