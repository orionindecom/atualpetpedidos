# Auditoria de indices do MongoDB Atlas

Data da coleta: 17/07/2026

Banco conectado: `atualpet`

Modo: somente leitura (`listCollections`, `listIndexes` e
`explain("executionStats")`)

## Resumo executivo

O projeto possui cinco models e cinco colecoes. Nao existe model ou colecao
separada para Cliente; clientes sao documentos do model `Usuario` na colecao
`usuarios`.

O estado atual do Atlas e diferente do registrado na auditoria anterior. Os
indices compostos de `usuarios`, `produtos`, `precoprodutos` e `tabelaprecos`
agora existem fisicamente e estao sendo usados. Esta auditoria nao identifica
quando ou por quem foram criados.

Dos 11 indices declarados pelos schemas (sem contar `_id_`), 8 existem e 3 estao
ausentes. Os tres ausentes pertencem a `pedidos`:

1. `{ createdAt: -1 }`
2. `{ clienteId: 1, createdAt: -1 }`
3. `{ status: 1, createdAt: -1 }`

Nao foi encontrado indice fisico redundante, duplicado ou com opcoes diferentes
do schema. Nenhum indice foi criado, removido, ocultado ou sincronizado.

## Indices existentes

### Comparacao schema x Atlas

| Model / colecao | Indice declarado no schema | Indice no Atlas | Status | Impacto observado |
| --- | --- | --- | --- | --- |
| Usuario / `usuarios` | `{ email: 1 }`, unique | `email_1`, unique | EXISTE | Login usa `EXPRESS_IXSCAN`; tambem garante unicidade |
| Usuario / `usuarios` | `{ cnpj: 1 }`, unique e sparse | `cnpj_1`, unique e sparse | EXISTE | Garante unicidade sem indexar documentos sem CNPJ |
| Usuario / `usuarios` | `{ tipo: 1, statusCadastro: 1, ativo: 1, createdAt: -1 }` | `tipo_1_statusCadastro_1_ativo_1_createdAt_-1` | EXISTE | Clientes e contagens usam `IXSCAN`/`COUNT_SCAN` |
| Produto / `produtos` | `{ ativo: 1, linha: 1, categoria: 1, nome: 1 }` | `ativo_1_linha_1_categoria_1_nome_1` | EXISTE | Lista ativa usa `IXSCAN`; contagem usa `COUNT_SCAN` |
| PrecoProduto / `precoprodutos` | `{ tabelaPrecoId: 1, produtoId: 1 }`, unique | `tabelaPrecoId_1_produtoId_1`, unique | EXISTE | Catalogo e precos por tabela deixaram de fazer `COLLSCAN`; tambem impede preco duplicado |
| Pedido / `pedidos` | `{ numeroPedido: 1 }`, unique | `numeroPedido_1`, unique | EXISTE | Garante unicidade do numero do pedido |
| TabelaPreco / `tabelaprecos` | `{ nome: 1 }`, unique | `nome_1`, unique | EXISTE | Busca e integridade por nome |
| TabelaPreco / `tabelaprecos` | `{ tipo: 1, ativa: 1, updatedAt: -1 }` | `tipo_1_ativa_1_updatedAt_-1` | EXISTE | Consulta de tabela de cliente final usa 1 chave e 1 documento |

Todas as colecoes tambem possuem o indice obrigatorio `_id_`.

### Inventario fisico completo

| Colecao | Documentos | Indices fisicos |
| --- | ---: | --- |
| `usuarios` | 7 | `_id_`; `email_1` unique; `cnpj_1` unique sparse; `tipo_1_statusCadastro_1_ativo_1_createdAt_-1` |
| `produtos` | 158 | `_id_`; `ativo_1_linha_1_categoria_1_nome_1` |
| `precoprodutos` | 378 | `_id_`; `tabelaPrecoId_1_produtoId_1` unique |
| `pedidos` | 13 | `_id_`; `numeroPedido_1` unique |
| `tabelaprecos` | 4 | `_id_`; `nome_1` unique; `tipo_1_ativa_1_updatedAt_-1` |

Nao existem outras colecoes no banco `atualpet` nesta coleta.

## Indices ausentes

| Colecao | Declarado e ausente | Consultas beneficiadas | Impacto atual |
| --- | --- | --- | --- |
| `pedidos` | `{ createdAt: -1 }` | Todos os pedidos, ultimos pedidos, pedidos do mes, faturamento do mes e contagem diaria usada no numero do pedido | Atualmente 13 documentos sao examinados e o tempo e 0 ms; impacto cresce linearmente |
| `pedidos` | `{ clienteId: 1, createdAt: -1 }` | Meus pedidos ordenados | Atualmente examina os 13 documentos e ordena em memoria |
| `pedidos` | `{ status: 1, createdAt: -1 }` | Contagem de pedidos novos e futuras listagens por status/data | Atualmente examina os 13 documentos |

Os tres indices ja estao declarados no model `Pedido`; a divergencia e apenas
fisica no Atlas.

## Indices redundantes

Nenhum indice fisico e exatamente duplicado ou redundante no conjunto atual.

- `_id_` e obrigatorio e sustenta autenticacao, lookups e buscas por id.
- `numeroPedido_1`, `email_1`, `cnpj_1`, `nome_1` e o indice de precos possuem
  funcao de integridade, alem de desempenho.
- o indice de produto e largo, mas seu prefixo `ativo` e usado pela listagem e
  pela contagem. Nao deve ser substituido por outro `{ ativo: 1 }` sem medicao.
- o indice de usuario nao satisfaz o sort de clientes quando somente `tipo` e
  filtrado, pois `statusCadastro` e `ativo` ficam entre `tipo` e `createdAt`.
  Mesmo assim, ele e usado nas contagens e nao e redundante.
- o indice de tabela comeca por `tipo`; por isso nao atende `{ ativa: true }`
  isoladamente, mas atende exatamente a consulta de cliente final.

Nao se recomenda remover nenhum indice existente.

## Resultado dos explains

Os totais de agregacoes com `$lookup` incluem trabalho da colecao de origem e da
colecao relacionada. Tempos de 0 ms significam abaixo da resolucao reportada pelo
servidor para o volume atual, nao custo zero.

| Consulta | ms | Docs | Keys | Winning plan / indice |
| --- | ---: | ---: | ---: | --- |
| Produtos ativos | 0 | 151 | 151 | `FETCH -> IXSCAN`, indice de produto |
| Produtos por ids ativos no pedido | 0 | 5 | 7 | `FETCH -> IXSCAN`, `_id_` e indice de produto |
| Clientes ordenados com tabela | 1 | 12 | 12 | `EQ_LOOKUP + IXSCAN + SORT`, indice de usuario e `_id_` |
| Clientes pendentes | 0 | 0 | 0 | `FETCH -> IXSCAN`, indice de usuario; nao havia resultado |
| Login por email inexistente | 1 | 0 | 0 | `EXPRESS_IXSCAN`, `email_1` |
| Autenticacao por `_id` | 0 | 1 | 1 | `EXPRESS_IXSCAN`, `_id_` |
| Precos por tabela com produtos | 4 | 312 | 312 | `EQ_LOOKUP + IXSCAN`, indice de precos e `_id_` |
| Precos em lote na criacao de pedido | 0 | 5 | 7 | `FETCH -> IXSCAN`, indice de precos |
| Catalogo paginado sem filtros | 17 | 160 | 160 | `FETCH -> IXSCAN`, indice de precos e `_id_` |
| Tabelas ordenadas por criacao | 0 | 4 | 0 | `SORT -> COLLSCAN` |
| Tabela cliente final ativa mais recente | 1 | 1 | 1 | `LIMIT -> FETCH -> IXSCAN`, indice de tabela |
| Pedidos do cliente ordenados | 0 | 13 | 0 | `SORT -> COLLSCAN` |
| Todos os pedidos ordenados | 0 | 13 | 0 | `SORT -> COLLSCAN` |
| Dashboard: pedidos do mes | 0 | 13 | 0 | `GROUP -> COLLSCAN` |
| Dashboard: faturamento do mes | 0 | 13 | 0 | `GROUP -> COLLSCAN` |
| Dashboard: pedidos novos | 0 | 13 | 0 | `GROUP -> COLLSCAN` |
| Dashboard: pedidos por status | 0 | 13 | 0 | `GROUP -> COLLSCAN` |
| Dashboard: ultimos pedidos | 0 | 13 | 0 | `SORT -> COLLSCAN` |
| Dashboard: top produtos | 0 | 13 | 0 | `PROJECTION -> COLLSCAN` |
| Dashboard: clientes pendentes | 0 | 0 | 0 | `GROUP -> COUNT_SCAN`, indice de usuario |
| Dashboard: clientes ativos | 0 | 0 | 6 | `GROUP -> COUNT_SCAN`, indice de usuario |
| Dashboard: produtos ativos | 0 | 0 | 151 | `GROUP -> COUNT_SCAN`, indice de produto |
| Dashboard: tabelas ativas | 0 | 4 | 0 | `GROUP -> COLLSCAN` |

## Consultas que fazem COLLSCAN

### Solucionaveis pelos indices ja declarados

1. Pedidos do cliente ordenados
   - Atual: 13 documentos, sort em memoria.
   - Indice: `{ clienteId: 1, createdAt: -1 }`.
   - Depois: busca somente a faixa do cliente e entrega na ordem correta.

2. Todos os pedidos e ultimos cinco pedidos
   - Atual: 13 documentos e sort em memoria.
   - Indice: `{ createdAt: -1 }`.
   - Depois: os ultimos cinco tendem a examinar apenas cinco chaves/documentos.

3. Pedidos/faturamento do mes e contagem diaria do numero do pedido
   - Atual: todos os pedidos sao examinados.
   - Indice: `{ createdAt: -1 }`.
   - Depois: somente a faixa de datas e percorrida; contagens podem usar plano de
     contagem por indice.

4. Pedidos novos
   - Atual: todos os pedidos sao examinados.
   - Indice: `{ status: 1, createdAt: -1 }`.
   - Depois: somente a faixa de status e percorrida, com possibilidade de
     `COUNT_SCAN`.

### COLLSCAN aceitavel ou nao eliminavel no volume atual

- Tabelas ordenadas: `{ createdAt: -1 }` removeria o scan/sort, mas a colecao tem
  quatro documentos e a consulta devolve todos. O custo de mais um indice nao se
  justifica hoje.
- Dashboard tabelas ativas: `{ ativa: 1 }` permitiria contagem por indice, mas
  quatro documentos tornam o ganho irrelevante.
- Pedidos por status: a agregacao precisa contar todos os status. Um indice pode
  trocar leitura de documentos por leitura de chaves, mas continua O(N).
- Top produtos: precisa ler os pedidos nao cancelados e fazer `$unwind` dos itens.
  Nenhum indice elimina o processamento dos itens. O indice por status pode ajudar
  somente se cancelados forem uma parcela seletiva.

## Consultas que usam IXSCAN

- Login por email: `email_1`.
- Autenticacao e buscas relacionadas: `_id_`.
- Produtos ativos e contagem: indice composto de produto.
- Clientes e contagens: indice composto de usuario.
- Precos, catalogo e precos do pedido: indice unico de preco.
- Tabela cliente final: indice composto de tabela.
- Lookups de produto e tabela: `_id_` das colecoes relacionadas.

## Ganho estimado para cada indice

As estimativas sao estruturais. Com apenas 13 pedidos, o Atlas reportou 0 ms para
todos os scans dessa colecao; portanto nao ha ganho de latencia mensuravel hoje.

| Indice | Antes | Depois esperado em escala | Ganho estimado |
| --- | --- | --- | --- |
| `{ createdAt: -1 }` | O(N) mais sort para listas; O(N) para faixas de data | O(log N + K), sem sort; ultimos pedidos limitados a poucas chaves | Alto quando pedidos crescerem |
| `{ clienteId: 1, createdAt: -1 }` | O(N) mais sort | O(log N + K) para os pedidos do cliente, ja ordenados | Alto para distribuidores com historico; baixo hoje |
| `{ status: 1, createdAt: -1 }` | O(N) para status | O(log N + K); contagem pode virar `COUNT_SCAN` | Medio; depende da seletividade dos status |
| `{ createdAt: -1 }` em tabelas | 4 documentos | Evitaria sort de 4 documentos | Desprezivel; nao recomendado |
| `{ ativa: 1 }` em tabelas | 4 documentos | Contagem por indice | Desprezivel; nao recomendado |

## Ordem de prioridade

### Prioridade 1

Criar `{ createdAt: -1 }` em `pedidos`.

E o indice com maior reutilizacao: lista administrativa, ultimos pedidos,
dashboard mensal e sequencial diario do numero do pedido.

### Prioridade 2

Criar `{ clienteId: 1, createdAt: -1 }` em `pedidos`.

Evita varrer todo o historico para cada cliente e remove o sort da tela Meus
Pedidos.

### Prioridade 3

Criar `{ status: 1, createdAt: -1 }` em `pedidos`.

Beneficia contagens e futuras listagens por status/data. O ganho atual e menor
porque existem somente 13 pedidos.

## Revisao dos schemas Mongoose

- `unique: true` em Mongoose declara indice unico; nao e apenas uma validacao de
  formulario.
- `cnpj` usa corretamente `unique + sparse`, permitindo documentos sem CNPJ sem
  perder unicidade dos valores presentes.
- o indice unico de preco corresponde exatamente aos filtros de leitura e upsert.
- os tres indices de pedido sao distintos e nao sao redundantes: cada um possui um
  prefixo necessario para uma familia diferente de consultas.
- nao foram encontradas declaracoes duplicadas via propriedade e `schema.index()`.
- nao existe uso de `syncIndexes()` no projeto.

## autoIndex em producao

O startup conecta com:

```js
autoIndex: process.env.MONGO_AUTO_INDEX === "true"
```

O `render.yaml` define `MONGO_AUTO_INDEX=false`. Portanto, producao nao cria
automaticamente os indices declarados nos schemas. Declarar `schema.index()` ou
`unique: true` apenas registra a especificacao no Mongoose; com `autoIndex=false`,
nenhum DDL e enviado pelo startup.

Existe um script manual `src/scripts/createIndexes.js`, protegido por
`CONFIRM_INDEX_CREATION=true`, que usa `model.createIndexes()`. Ele nao e chamado
no build nem no start. Os indices fisicos existentes foram criados por alguma
operacao separada; esta auditoria nao executou esse script.

Manter `autoIndex=false` em producao e adequado: evita builds inesperados durante
startup e permite controlar horario, ordem e monitoramento.

## Criacao posterior com impacto minimo

Nao existe promessa absoluta de zero impacto. O procedimento recomendado e:

1. Confirmar tier, versao, espaco em disco, CPU e cache do cluster.
2. Tirar snapshot/backup e manter `MONGO_AUTO_INDEX=false`.
3. Criar um indice por vez, na ordem de prioridade, em janela de baixo trafego.
4. Preferir o build padrao otimizado quando o cluster estiver saudavel.
5. Em cluster M10+ e somente se o build padrao nao for adequado, avaliar rolling
   build pelo Atlas. Rolling build aumenta o tempo e reduz temporariamente a
   resiliencia; nao e suportado em M0/M2/M5.
6. Monitorar CPU, WiredTiger cache, disco, conexoes e replication lag.
7. Aguardar cada build terminar e repetir `listIndexes()` e os explains antes do
   proximo.
8. Nao usar `syncIndexes()` em producao, pois a sincronizacao pode remover indices
   fora do schema.

Os tres indices ausentes nao sao unicos, portanto nao exigem saneamento de
duplicidades. Ainda assim, devem ser criados somente apos aprovacao explicita.

Referencias oficiais:

- [Gerenciamento de indices no Atlas](https://www.mongodb.com/docs/atlas/atlas-ui/indexes/)
- [Rolling index builds](https://www.mongodb.com/docs/manual/core/rolling-index-builds/)
- [Atlas API para rolling index](https://www.mongodb.com/docs/api/doc/atlas-admin-api-v2/operation/operation-creategroupclusterindexrollingindex)

## Arquivos analisados

- `backend/src/models/Usuario.js`
- `backend/src/models/Produto.js`
- `backend/src/models/PrecoProduto.js`
- `backend/src/models/Pedido.js`
- `backend/src/models/TabelaPreco.js`
- `backend/src/controllers/authController.js`
- `backend/src/controllers/catalogoController.js`
- `backend/src/controllers/clienteController.js`
- `backend/src/controllers/dashboardController.js`
- `backend/src/controllers/pedidoController.js`
- `backend/src/controllers/precoProdutoController.js`
- `backend/src/controllers/produtoController.js`
- `backend/src/controllers/tabelaPrecoController.js`
- `backend/src/middlewares/authMiddleware.js`
- `backend/src/utils/gerarNumeroPedido.js`
- `backend/src/config/db.js`
- `backend/src/config/env.js`
- `backend/src/scripts/dbAudit.js`
- `backend/src/scripts/createIndexes.js`
- `backend/package.json`
- `render.yaml`

## Confirmacao de seguranca

- Nenhum `createIndex()`, `createIndexes()`, `syncIndexes()` ou comando equivalente
  foi executado.
- Nenhum documento foi criado, alterado ou removido.
- Nenhum controller, model, frontend, rota, JWT ou configuracao foi alterado.
- Nenhum commit, push ou deploy foi executado.
- A unica alteracao desta auditoria e este arquivo `INDEX_AUDIT.md`.
