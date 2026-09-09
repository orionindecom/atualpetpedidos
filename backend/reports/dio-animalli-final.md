# Dio Animalli — importação final concluída

Tabela **Dio Animalli** criada e conferida. ID: `6aa18e7309e5a582e3f79384`. Execução com commit em 2026-09-09T16:51:00.333Z. Consulta independente posterior: 2026-09-09T16:51:33.489Z.

## Resultado

| Verificação | Resultado |
|---|---:|
| Linhas válidas no Excel | 160 |
| Produtos existentes utilizados | 150 |
| Produtos novos criados | 1 |
| Itens/preços reais na Dio Animalli | 151 |
| Preços criados | 151 |
| Preços atualizados | 0 |
| Exclusões deliberadas | 9 |
| Produtos inativos utilizados | 0 |
| Divergências entre preços e coluna H | 0 |
| Duplicidades de tabela/produto/preço criadas | 0 |
| Produtos existentes alterados | 0 |
| Outras tabelas ou seus preços alterados | 0 |

Único produto criado: **Shampoo The Luxe Pré-Lavagem 1:5 5L**, ID `6aa18d6dbfe61130929f9fb1`, linha **The Luxe**, categoria **Shampoo**, ativo. Nenhuma descrição, foto ou EAN inventado. Preço de H81: **R$ 63,10**.

## Simulação e execução

A simulação final, antes de qualquer escrita, apresentou 160 linhas, 151 IDs distintos, 150 produtos existentes, um novo autorizado, nove exclusões e zero bloqueios/inativos. Todos os 151 preços foram conferidos contra o XML da coluna H antes da gravação. A importação ocorreu em transação MongoDB, com validação dentro da transação e nova leitura após o commit.

Os IDs das 150 correspondências existentes estão fixados em `src/scripts/data/dioAnimalliAprovado.json`, com linha/célula e identidade esperada de cada registro. A criação autorizada também tem ID reservado, permitindo repetição segura. O importador não usa fuzzy matching durante a gravação. Divergência da fonte, identidade ou status ativo bloqueia a operação.

## Conferência independente após importação

Uma nova consulta carregou produtos, tabelas e preços diretamente das coleções. A auditoria Python leu o XML da aba `especializado nova ` e comparou cada uma das 151 células H com o preço real do respectivo ID: **151 conferidos, zero divergências**, com arredondamento decimal ROUND_HALF_UP para centavos. A aba antiga não foi utilizada.

O catálogo passou de 161 para 162 produtos; as tabelas, de 4 para 5; os preços totais, de 614 para 765. Todos os documentos dos produtos anteriores e todas as outras tabelas/preços foram comparados integralmente, inclusive timestamps: permanecem idênticos.

A nova execução SEM --apply apresentou **151 preços inalterados, zero criações/atualizações de preço e zero produtos novos planejados**. Nenhuma segunda gravação foi necessária para testar idempotência.

## Amostras individuais — Excel versus banco (16 produtos)

| Célula | Produto no banco | Excel arredondado | Banco | Resultado |
|---|---|---:|---:|---|
| H11 | SHAMPOO DREAM COLOR PRÉ-LAVAGEM 1:5 5L | R$ 137,50 | R$ 137,50 | Confere |
| H26 | CONDICIONADOR DREAM COLOR JASMIM C/ AMENDOAS1:5 1L | R$ 47,02 | R$ 47,02 | Confere |
| H32 | CONDICIONADOR DREAM COLOR JASMIM C/ AMENDOAS 1:5 5L | R$ 157,33 | R$ 157,33 | Confere |
| H68 | Shampoo The Luxe Limpeza Profunda (Coco) 5L | R$ 74,38 | R$ 74,38 | Confere |
| H69 | Shampoo The Luxe Limpeza Profunda 5L | R$ 74,38 | R$ 74,38 | Confere |
| H76 | Condicionador The Luxe - Pronto Uso 5L | R$ 66,63 | R$ 66,63 | Confere |
| H79 | Condicionador The Luxe - Melancia 5L | R$ 135,00 | R$ 135,00 | Confere |
| H80 | Condicionador The Luxe - Neutro 5L | R$ 135,00 | R$ 135,00 | Confere |
| H81 | Shampoo The Luxe Pré-Lavagem 1:5 5L | R$ 63,10 | R$ 63,10 | Confere |
| H82 | Máscara de Hidratação The Luxe - Cereja & Avelã 500g | R$ 64,00 | R$ 64,00 | Confere |
| H86 | Máscara de Hidratação The Luxe 60 Seg - Cereja & Avelã 1kg | R$ 85,00 | R$ 85,00 | Confere |
| H102 | Colônia The Luxe One 500ml | R$ 49,50 | R$ 49,50 | Confere |
| H114 | PERFUME VANITY ULTRA PREMIUM BABY 50ML | R$ 24,52 | R$ 24,52 | Confere |
| H156 | Shampoo Zoom Pré Lavagem 5L | R$ 31,68 | R$ 31,68 | Confere |
| H166 | SHAMPOO ZOOM PELOS ESCUROS 750ML | R$ 4,84 | R$ 4,84 | Confere |
| H168 | SHAMPOO ZOOM MORANGO 750ML | R$ 4,84 | R$ 4,84 | Confere |

Talco e Pré-Lavagem têm IDs distintos. Pronto Uso e Neutro concentrado têm IDs distintos. Os dois Jasmim c/ Amêndoas utilizam somente os IDs ativos aprovados. Máscaras específicas e versões 60 Seg foram vinculadas conforme decisão final.

## Exclusões deliberadamente aprovadas

| Linha | Produto | Embalagem | Motivo |
|---:|---|---|---|
| 176 | ALMOTOLIA | 1L | não importado — produto não cadastrado / exclusão deliberadamente aprovada |
| 177 | ALMOTOLIA | 500ML | não importado — produto não cadastrado / exclusão deliberadamente aprovada |
| 178 | AMOSTRA | 30ML | não importado — produto não cadastrado / exclusão deliberadamente aprovada |
| 179 | AVENTAL | U | não importado — produto não cadastrado / exclusão deliberadamente aprovada |
| 180 | JALECO | P | não importado — produto não cadastrado / exclusão deliberadamente aprovada |
| 181 | JALECO | M | não importado — produto não cadastrado / exclusão deliberadamente aprovada |
| 182 | JALECO | G | não importado — produto não cadastrado / exclusão deliberadamente aprovada |
| 183 | JALECO | GG | não importado — produto não cadastrado / exclusão deliberadamente aprovada |
| 184 | VÁLVULA PUMP PARA GALÃO 5L | U | não importado — produto não cadastrado / exclusão deliberadamente aprovada |

Os nove itens não foram criados e não têm preço na Dio Animalli. As demais 104 linhas vazias, títulos, cabeçalhos e metadados da planilha continuam fora das 160 linhas válidas, conforme relatório de leitura.

## EAN repetido na fonte

O EAN **7898360015566** continua repetido nas linhas 166 e 168 do Excel. Isso não gerou duplicidade no banco: Pelos Escuros 750ml usa `6a5aab4b97e2675dd0e46f42`; Morango 750ml usa `6a5aab4b97e2675dd0e46f44`. O EAN não decidiu essas associações e não foi alterado.

## Comandos executados (a partir de backend)

Simulação final:

```powershell
node src/scripts/importarDioAnimalli.js --file 'C:\Users\Administrador\Downloads\Eans e tabela de preço - Dio animalli.xlsx' --python 'C:\Users\Administrador\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' --report reports/dio-animalli-simulacao-final.json
```

Importação real:

```powershell
node src/scripts/importarDioAnimalli.js --file 'C:\Users\Administrador\Downloads\Eans e tabela de preço - Dio animalli.xlsx' --python 'C:\Users\Administrador\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' --report reports/dio-animalli-execucao-final.json --apply
```

Nova simulação pós-importação:

```powershell
node src/scripts/importarDioAnimalli.js --file 'C:\Users\Administrador\Downloads\Eans e tabela de preço - Dio animalli.xlsx' --python 'C:\Users\Administrador\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' --report reports/dio-animalli-pos-importacao.json
```

## Arquivos e validações

- Importador atualizado: `src/scripts/importarDioAnimalli.js`.
- Mapa explícito: `src/scripts/data/dioAnimalliAprovado.json`.
- Simulação: `reports/dio-animalli-simulacao-final.json`.
- Execução e auditorias: `reports/dio-animalli-execucao-final.json`.
- Estado anterior: `reports/dio-animalli-execucao-final.json.antes.json`.
- Nova consulta do banco: `reports/dio-animalli-conferencia-banco.json`.
- Conferência independente dos 151 preços: `reports/dio-animalli-validacao-independente.json`.
- Idempotência: `reports/dio-animalli-pos-importacao.json`.
- Nove testes de correspondência, bloqueios, idempotência e preservação passaram (`node --test test/importarDioAnimalli.test.js`).

Os relatórios anteriores foram preservados. Não houve commit, push ou deploy.
