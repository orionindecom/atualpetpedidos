// Materializa uma única vez as decisões finais do usuário nos relatórios já revisados.
// Não acessa o banco. O JSON resultante é lido pelo importador, nunca este gerador.
import { readFile, writeFile } from "node:fs/promises";
import mongoose from "mongoose";
const read = async (name) => JSON.parse(await readFile(new URL(`../../reports/${name}`, import.meta.url)));
const original = await read("dio-animalli.json");
const investigacao = await read("dio-animalli-investigacao.json");
const { produtos } = await read("dio-animalli-investigacao-catalogo.json");
const ids = new Map(original.plano.map((p) => [p.linha, p.produtoId]));
for (const item of [...investigacao.pendencias, ...investigacao.zoom]) {
  if (item.linha === 81 || item.linha >= 176) continue;
  const candidatos = item.candidatosInvestigados.filter((c) => c.status === "ATIVO" && ["ALTA", "MÉDIA"].includes(c.confianca));
  if (candidatos.length !== 1) throw new Error(`Revisar linha ${item.linha}`);
  ids.set(item.linha, candidatos[0].id);
}
if (ids.size !== 150 || new Set(ids.values()).size !== 150) throw new Error("Mapa não contém 150 produtos existentes distintos");
const novoProduto = { _id: new mongoose.Types.ObjectId().toString(), nome: "Shampoo The Luxe Pré-Lavagem 1:5 5L", linha: "The Luxe", categoria: "Shampoo", ativo: true };
const mapa = { versao: "decisoes-finais-2026-09-09", sha256Excel: original.fonte.sha256,
  aba: "especializado nova ", coluna: "H", novoProduto,
  registros: original.fonte.registros.map((r) => {
    const p = produtos.find((p) => p._id === ids.get(r.linha));
    return { fonte: { linha: r.linha, nome: r.nome, embalagem: r.embalagem, diluicao: r.diluicao, ean: r.ean, celula: r.celula },
      decisao: r.linha >= 176 ? "excluir" : r.linha === 81 ? "criar-unico-autorizado" : "existente-aprovado",
      produto: p ? { _id: p._id, nome: p.nome, linha: p.linha, categoria: p.categoria, ativo: true } : r.linha === 81 ? novoProduto : null,
      motivo: r.linha >= 176 ? "não importado — produto não cadastrado / exclusão deliberadamente aprovada" : r.linha === 81 ? "criação excepcional autorizada; distinto de Talco" : "ID aprovado pelo usuário nas decisões finais; registro ativo" };
  }) };
await writeFile(new URL("./data/dioAnimalliAprovado.json", import.meta.url), JSON.stringify(mapa, null, 2)+"\n", {flag:"wx"});
console.log({existentes:ids.size,excluidos:9,novoProduto});
