import test from "node:test";
import assert from "node:assert/strict";
import { planejar, auditar } from "../src/scripts/sincronizarTabelaDemonstracao.js";
const estado = () => ({ produtos: [{_id:"a",nome:"Ativo",ativo:true,linha:"The Luxe"},{_id:"b",nome:"Inativo",ativo:false}], tabelas:[{_id:"dio",nome:"Dio Animalli"}], precos:[{_id:"p0",produtoId:"a",tabelaPrecoId:"dio",valor:99}] });
test("todos e somente ativos; produtos e outras tabelas não entram nas operações",()=>{
  const e=estado(); const p=planejar(e);
  assert.equal(p.totalProdutos,2); assert.equal(p.produtosAtivos,1); assert.equal(p.produtosInativos,1);
  assert.equal(p.ativosForaDoPlano,0); assert.equal(p.produtosNovosPlanejados,0);
  assert.deepEqual(p.plano.map(x=>[x.produtoId,x.valor]),[["a",1]]);
  assert.deepEqual(p.bloqueios,[]);
});
test("sincroniza preço errado e remove apenas associações inativas/órfãs da demonstração",()=>{
  const e=estado(); e.tabelas.push({_id:"demo",nome:" tabela   DEMONSTRAÇÃO "});
  e.precos.push({_id:"p1",produtoId:"a",tabelaPrecoId:"demo",valor:2},{_id:"p2",produtoId:"b",tabelaPrecoId:"demo",valor:1},{_id:"p3",produtoId:"ausente",tabelaPrecoId:"demo",valor:1});
  const p=planejar(e); assert.deepEqual(p.previstos,{criar:0,atualizar:1,inalterado:0,remover:2});
  assert.deepEqual(p.remover.map(x=>x.precoId),["p2","p3"]);
});
test("duplicatas e status desconhecido bloqueiam",()=>{
  const e=estado(); e.produtos[0].ativo=undefined; assert.ok(planejar(e).bloqueios.length);
  e.tabelas.push({_id:"d1",nome:"Tabela Demonstração"},{_id:"d2",nome:"Tabela Demonstração"}); assert.ok(planejar(e).bloqueios.length>=2);
});
test("auditoria e reexecução detectam omissões, preço errado, duplicatas e alterações alheias",()=>{
  const antes=estado(); const depois=structuredClone(antes);
  depois.tabelas.push({_id:"demo",nome:"Tabela Demonstração"}); depois.precos.push({_id:"p1",produtoId:"a",tabelaPrecoId:"demo",valor:1});
  assert.equal(auditar(antes,depois,"demo").ok,true);
  assert.deepEqual(planejar(depois).previstos,{criar:0,atualizar:0,inalterado:1,remover:0});
  for(const mudar of [e=>e.produtos[0].nome="alterado",e=>e.precos[0].valor=1,e=>e.precos.pop(),e=>e.precos.push({...e.precos[1],_id:"duplicado"}),e=>e.precos[1].valor=0]) {
    const e=structuredClone(depois); mudar(e); assert.equal(auditar(antes,e,"demo").ok,false);
  }
});
