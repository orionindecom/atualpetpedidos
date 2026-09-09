import test from "node:test";
import assert from "node:assert/strict";
import { localizar, planejar, planejarFinal, verificarFinal } from "../src/scripts/importarDioAnimalli.js";
import { readFileSync } from "node:fs";
import aprovacao from "../src/scripts/data/dioAnimalliAprovado.json" with { type: "json" };
import Produto from "../src/models/Produto.js";

const registro = { linha: 11, nome: "Shampoo Exemplo", diluicao: "1:5", embalagem: "5 L", ean: "123", valor: 137.5 };
const produto = { _id: "p1", nome: " SHAMPOO  EXEMPLO 1:5 5L ", ativo: true };
const fonte = (registros) => ({ registros, ignoradas: [] });

test("nome normalizado preserva diluição e embalagem", () => {
  assert.equal(localizar(registro, [produto]).produto._id, "p1");
  for (const nome of ["Shampoo Exemplo 1:12 5L", "Shampoo Exemplo 1:5 1L", "Shampoo Exemplo 5L", "Shampoo Exemplos 1:5 5L"]) {
    assert.equal(localizar(registro, [{ ...produto, nome }]).produto, undefined);
  }
});
test("identificador prevalece e duplicidades/conflitos não escolhem primeiro", () => {
  assert.equal(localizar(registro, [{ ...produto, ean: "123", nome: "Outro nome" }]).criterio, "identificador exato");
  assert.equal(localizar(registro, [{ ...produto, ean: "456" }]).produto, undefined);
  assert.equal(localizar(registro, [produto, { ...produto, _id: "p2" }]).produto, undefined);
  assert.equal(localizar(registro, [{ ...produto, ativo: false }]).produto, undefined);
  assert.equal(localizar(registro, [{ ...produto, ean: "123" }, { ...produto, _id: "p2", ean: "123" }]).produto, undefined);
});
test("reexecução não planeja escrita e não considera preços de outras tabelas", () => {
  const tabela = { _id: "t1", nome: " dio   ANIMALLI ", ativa: true };
  const r = planejar(fonte([registro]), [produto], [tabela], [
    { tabelaPrecoId: "t1", produtoId: "p1", valor: 137.5 },
    { tabelaPrecoId: "t2", produtoId: "p1", valor: 999 },
  ]);
  assert.deepEqual(r.previstos, { criar: 0, atualizar: 0, inalterado: 1 });
  assert.equal(r.bloqueios.length, 0);
});
test("linhas repetidas iguais colapsam; valores diferentes bloqueiam", () => {
  const iguais = planejar(fonte([registro, { ...registro, linha: 12 }]), [produto], [], []);
  assert.equal(iguais.plano.length, 1);
  assert.equal(iguais.bloqueios.length, 0);
  const conflito = planejar(fonte([registro, { ...registro, linha: 12, valor: 99 }]), [produto], [], []);
  assert.ok(conflito.bloqueios.length);
});
test("tabelas duplicadas, preços duplicados e itens ausentes bloqueiam", () => {
  const tabela = { _id: "t1", nome: "Dio Animalli" };
  assert.ok(planejar(fonte([registro]), [], [], []).bloqueios.length);
  assert.ok(planejar(fonte([registro]), [produto], [tabela, { ...tabela, _id: "t2" }], []).bloqueios.length);
  const preco = { tabelaPrecoId: "t1", produtoId: "p1", valor: 1 };
  assert.ok(planejar(fonte([registro]), [produto], [tabela], [preco, preco]).bloqueios.length);
});

test("EAN repetido em identidades diferentes não permite associação automática pelo código", () => {
  const r = planejar(fonte([registro, { ...registro, linha: 12, nome: "Shampoo Outro" }]), [{ ...produto, ean: "123" }], [], []);
  assert.ok(r.bloqueios.some((b) => b.includes("identifica produtos distintos")));
});

const original = JSON.parse(readFileSync(new URL("../reports/dio-animalli.json", import.meta.url)));
const snapshot = JSON.parse(readFileSync(new URL("../reports/dio-animalli-investigacao-catalogo.json", import.meta.url)));
const simular = (produtos = snapshot.produtos, f = original.fonte, tabelas = [], precos = []) => planejarFinal(f, produtos, tabelas, precos);

test("decisões finais fecham 160/151/150/1/9 sem inativos e separam variantes", async () => {
  const r = simular();
  assert.deepEqual(r.bloqueios, []);
  assert.equal(r.linhasValidas, 160);
  assert.equal(r.plano.length, 151);
  assert.equal(r.produtosExistentesUtilizados, 150);
  assert.equal(r.produtosNovosPlanejados, 1);
  assert.equal(r.excluidos.length, 9);
  assert.equal(r.produtosInativosUtilizados, 0);
  await new Produto(aprovacao.novoProduto).validate();
  for (const [a,b] of [[69,81],[76,80],[166,168]]) assert.notEqual(r.plano.find(p=>p.linha===a).produtoId,r.plano.find(p=>p.linha===b).produtoId);
  assert.equal(r.plano.find(p=>p.linha===79).produtoId,"6a512da7328c36f3a611f34d");
});

test("mapa bloqueia fonte alterada, ID inativo/renomeado e pré-lavagem semelhante", () => {
  assert.ok(simular(snapshot.produtos,{...original.fonte,aba:"especializado"}).bloqueios.length);
  const f=structuredClone(original.fonte); f.registros[0].celula="G11";
  assert.ok(simular(snapshot.produtos,f).bloqueios.length);
  const p=structuredClone(snapshot.produtos); p.find(x=>x._id==="6a5e4a86011c103e77abdda2").ativo=false;
  assert.ok(simular(p).bloqueios.length);
  assert.ok(simular([...snapshot.produtos,{...aprovacao.novoProduto,_id:"outro",nome:"Shampoo The Luxe Pré-Lavagem 5L"}]).bloqueios.length);
});

test("reexecução preserva produto e 151 preços; auditoria detecta alteração alheia", () => {
  const r=simular(); r.tabela={_id:"t1",nome:"Dio Animalli",ativa:true};
  const antes={produtos:snapshot.produtos,tabelas:[],precos:[]};
  const depois={produtos:[...snapshot.produtos,aprovacao.novoProduto],tabelas:[r.tabela],precos:r.plano.map((p,i)=>({_id:String(i),tabelaPrecoId:"t1",produtoId:p.produtoId,valor:p.valor}))};
  assert.equal(verificarFinal(r,antes,depois).ok,true);
  const segundo=simular(depois.produtos,original.fonte,depois.tabelas,depois.precos);
  assert.deepEqual(segundo.bloqueios,[]);
  assert.equal(segundo.produtosNovosPlanejados,0);
  assert.deepEqual(segundo.previstos,{criar:0,atualizar:0,inalterado:151});
  const alterado=structuredClone(depois); alterado.produtos[0].nome="Não autorizado";
  assert.equal(verificarFinal(r,antes,alterado).ok,false);
  const extra=structuredClone(depois); extra.precos.push({_id:"extra",produtoId:"outro",tabelaPrecoId:"t1",valor:1});
  assert.equal(verificarFinal(r,antes,extra).ok,false);
  assert.ok(simular(depois.produtos,original.fonte,depois.tabelas,extra.precos).bloqueios.length);
});
