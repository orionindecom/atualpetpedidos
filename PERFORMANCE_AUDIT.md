# Auditoria de performance do AtualPet

Data: 17/07/2026

## Escopo e metodo

Foram revisados controllers, rotas, middlewares, models, conexao MongoDB, indices,
ETag, rate limits e chamadas HTTP das paginas administrativas. As medicoes foram
feitas no backend local contra o Atlas configurado, somente com requisicoes de
leitura. Nenhum indice, dado, segredo, deploy ou ambiente de producao foi alterado.

A instrumentacao e ativada apenas com `PERF_LOG_ENABLED=true`. Ela registra metodo,
caminho sem query string ou ObjectId, status, tempo total e etapas nomeadas. Nao
registra headers, token, cookies, body ou dados pessoais.

Os numeros abaixo nao representam o Render em Oregon. Eles isolam o custo do codigo
e o numero de viagens ao Atlas. A linha de base usou uma chamada de aquecimento e
tres amostras; a medicao final usou aquecimento adicional e quatro amostras. As
tabelas usam mediana para reduzir o efeito de picos isolados do Atlas.

## Resumo executivo

A causa principal provavel em producao e a soma de viagens sequenciais entre Render
Oregon e Atlas Sao Paulo. Localmente, uma consulta simples de autenticacao levou em
geral 6 a 7 ms. Se uma viagem Oregon-Sao Paulo custar, por exemplo, 150 a 200 ms,
quatro consultas sequenciais podem acrescentar 600 a 800 ms antes de processamento,
TLS, fila do provedor e resposta. Esse cenario e compativel com TTFB de 900 ms a 2 s,
mas deve ser confirmado com a instrumentacao no Render.

Nao foi encontrado N+1 nos endpoints auditados. Os pontos comprovados foram:

- toda rota protegida consulta o usuario no Atlas para validar estado e `tokenVersion`;
- clientes e precos usavam `populate`, adicionando uma consulta dependente;
- o dashboard executava dez consultas independentes em serie;
- os indices declarados nos models nao estao presentes no Atlas atual;
- tres telas administrativas aguardavam duas requisicoes independentes em serie;
- o React `StrictMode` repete effects em desenvolvimento, mas nao no build de producao;
- o `RoleRoute` faz uma validacao remota antes de montar a pagina protegida;
- o ETag padrao do Express calcula o 304 somente depois de controller e consulta.

## Antes e depois

Tempos de ponta a ponta em milissegundos, backend local e Atlas atual:

| Endpoint | Antes | Depois | Variacao |
| --- | ---: | ---: | ---: |
| `GET /api/produtos` | 33,66 | 29,13 | -13,5% |
| `GET /api/tabelas` | 15,07 | 15,07 | estavel |
| `GET /api/clientes` | 22,38 | 16,17 | -27,8% |
| `GET /api/precos/tabela/:id` | 53,80 | 41,03 | -23,7% |
| `GET /api/catalogo?pagina=1&limite=12` | 31,15 | 32,86 | +5,5% |
| `GET /api/dashboard` | 75,17 | 43,99 | -41,5% |

A pequena variacao do catalogo esta dentro do ruido de rede; seu pipeline nao foi
alterado. Todos os endpoints responderam 200 e mantiveram o formato de resposta.

Tempos finais das telas, comparando as mesmas requisicoes sequenciais e paralelas:

| Tela | Sequencial | Paralelo | Resultado |
| --- | ---: | ---: | ---: |
| Precos | 41,57 | 27,95 | -32,8% |
| Clientes | 29,25 | 16,28 | -44,3% |
| Pedidos | 44,42 | 29,15 | -34,4% |

Pedidos teve uma amostra isolada de 337,53 ms no Atlas. A mediana foi usada para
nao apresentar esse pico de rede como custo normal do codigo.

### Etapas da linha de base

- autenticacao: consulta do usuario em geral 6 a 7 ms; JWT e admin abaixo de 1 ms;
- produtos: consulta 18,8 a 25,4 ms; serializacao 2,1 a 3,1 ms;
- tabelas: consulta 6,4 a 6,7 ms; resposta abaixo de 1 ms;
- clientes: find mais populate 12,9 a 14,0 ms;
- precos: find mais populate 39,4 a 42,4 ms; resposta 2,8 a 4,3 ms;
- catalogo: aggregate 21,9 a 23,6 ms e tabela 6,6 a 9,0 ms, ja em paralelo;
- dashboard: dez consultas sequenciais de aproximadamente 5,5 a 7,6 ms cada.

O login foi instrumentado em consulta, bcrypt, save e assinatura JWT, mas nao foi
executado com credencial real para evitar exposicao, mutacao e consumo do rate limit.
O model nao declara `ultimoLogin`; a atribuicao atual nao marca o documento como
modificado. A remocao ou inclusao desse campo deve ser uma decisao funcional futura.

## Correcoes de codigo

- consultas somente leitura de produtos e tabelas usam `lean()`;
- a listagem de tabelas reaplica defaults legados para manter o JSON existente;
- o auth busca somente os seis campos usados e preserva defaults do Mongoose;
- clientes usa um unico aggregate com lookup, preservando defaults e removendo
  `senha` e `tokenVersion`;
- precos por tabela usa aggregate com lookup e preserva exatamente o JSON populado;
- dashboard executa consultas independentes em lotes de duas;
- dez consultas simultaneas foram testadas e rejeitadas: elevaram a media para
  aproximadamente 102 ms no cluster atual;
- Precos, Clientes e Pedidos usam `Promise.all` nas duas cargas iniciais;
- o logger de performance mascara ObjectIds e remove query strings.

## Analise por endpoint

| Endpoint | Consultas e causa provavel |
| --- | --- |
| Produtos | auth mais find sem indice fisico; lista completa sem paginacao |
| Tabelas | auth mais find/sort; colecao atual tem apenas 4 documentos |
| Clientes | auth e antigo find/populate sequencial; agora um lookup |
| Precos | auth e antigo find/populate; sem indice fisico por tabela |
| Catalogo | auth, aggregate com lookup/facet/sort e tabela em paralelo |
| Dashboard | auth e dez agregacoes/contagens; agora concorrencia limitada |
| Login | find por email, bcrypt e tentativa de save; instrumentado, nao medido |

A busca do catalogo usa regex de substring sem prefixo. Um indice B-tree comum nao
resolve esse filtro. Em escala maior, avaliar Atlas Search ou busca prefixada, sem
mudar agora a semantica existente.

## MongoDB e indices

O `audit:db` encontrou:

| Colecao | Documentos | Indices fisicos |
| --- | ---: | --- |
| usuarios | 7 | `_id_`, `email_1`, `cnpj_1` |
| produtos | 158 | `_id_` |
| tabelaprecos | 4 | `_id_`, `nome_1` |
| precoprodutos | 378 | `_id_` |
| pedidos | 13 | `_id_`, `numeroPedido_1` |

Nao ha grupos duplicados de preco por tabela/produto. Os explains mostraram:

- produtos ativos: `COLLSCAN`, 158 documentos examinados para 151 retornados;
- precos por tabela: `COLLSCAN`, 378 examinados para 156 retornados;
- clientes, tabelas e pedidos: `SORT` em memoria nas colecoes pequenas;
- autenticacao por `_id`: `EXPRESS_IXSCAN`, um documento e uma chave examinados.

Prioridade recomendada apos revisao e janela operacional:

1. criar o indice unico `{ tabelaPrecoId: 1, produtoId: 1 }` em precoprodutos;
2. criar os indices ja declarados nos models de produtos, usuarios e pedidos;
3. medir crescimento antes de adicionar indices exclusivos para sort de clientes
   `{ tipo: 1, createdAt: -1 }` ou tabelas `{ createdAt: -1 }`.

Indices aumentam custo de escrita e armazenamento. Nao foram criados. O comando
existente exige confirmacao explicita:

```powershell
$env:CONFIRM_INDEX_CREATION="true"; npm.cmd run db:create-indexes
```

Executar somente no diretorio `backend`, apos backup, revisao do Atlas e autorizacao.

## Frontend e requisicoes duplicadas

- AdminPrecos, AdminClientes e AdminPedidos aguardavam requests independentes em serie;
- agora cada par usa `Promise.all` sem mudar endpoint, estado ou layout;
- nao ha retry no interceptor Axios;
- os effects de mount nao possuem dependencias que causem loop;
- `StrictMode` duplica effects somente no servidor de desenvolvimento;
- `RoleRoute` valida admin em `/produtos` e cliente em `/pedidos/meus` antes de
  renderizar. Isso pode repetir a consulta da pagina Produtos ou Meus Pedidos.

A validacao do `RoleRoute` foi preservada por seguranca. Remover a ida ao banco ou
usar cache de sessao mudaria a garantia de bloqueio imediato de token revogado.
Uma futura rota dedicada de sessao pode reduzir payload, mas ainda tera uma viagem
ao Atlas enquanto a revogacao imediata for requisito.

## Cache e 304

O Express gera ETag por padrao. Nao foi encontrado `Last-Modified` customizado. O
controller consulta o MongoDB, transforma e serializa a resposta antes de o Express
comparar `If-None-Match` e decidir por 304. Assim, o 304 economiza download, mas nao
economiza autenticacao, consultas ou a maior parte do processamento no servidor.
O cache nao foi desativado porque ainda reduz transferencia.

## Conexao, limites e serializacao

- existe um unico `mongoose.connect()` no startup; controllers nao reconectam;
- pool padrao: maximo 10 e minimo 0, configuravel por ambiente;
- timeouts: selecao/conexao 10 s, socket 45 s, request HTTP 30 s;
- catalogo tem `maxTimeMS` de 5 s e tabela de apoio 3 s;
- rate limit e middlewares nao apareceram como gargalo local;
- serializacao foi pequena frente ao banco, exceto o payload de precos de 79 KB;
- produtos, clientes, tabelas e precos admin continuam sem paginacao por
  compatibilidade. Devem ser paginados quando as colecoes crescerem.

## Infraestrutura futura

1. Prioridade alta: hospedar backend e Atlas na mesma regiao ou em regioes proximas.
2. Ativar `PERF_LOG_ENABLED=true` por uma janela curta no Render e comparar p50/p95.
3. Desativar a flag depois da coleta para evitar volume permanente de logs.
4. Medir cold start do plano Render separadamente da latencia quente.
5. Adicionar APM/metricas de p50, p95, erros e pool antes de aumentar concorrencia.

## Validacoes e riscos restantes

- respostas otimizadas foram comparadas semanticamente com as respostas Mongoose;
- nenhum contrato, permissao, JWT, regra de negocio ou layout foi alterado;
- nenhum teste de carga ou mutacao foi executado;
- os ganhos do Render precisam ser medidos depois do deploy, pois a distancia ao
  Atlas domina cada viagem e o plano do cluster reagiu mal a concorrencia dez;
- criar indices em producao e aproximar regioes dependem de autorizacao manual.

## Comandos de verificacao

```powershell
# backend
npm.cmd test
npm.cmd run audit:db
node --check src/server.js

# frontend
npm.cmd test
npm.cmd run lint
npm.cmd run build

# repositorio
git diff --check
```

Para uma coleta temporaria local:

```powershell
$env:PERF_LOG_ENABLED="true"; npm.cmd run dev
```
