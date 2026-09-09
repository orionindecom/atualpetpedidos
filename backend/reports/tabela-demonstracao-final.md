# Tabela Demonstração — concluída

Tabela criada em transação. ID: 6aa190aa8d8e3d5f6c88961f. Consulta e auditoria pós-gravação aprovadas.

## Simulação

162 produtos existentes: 152 ativos e 10 inativos. Todos os 152 ativos planejados a R$ 1,00. Produtos novos: 0. Outras tabelas alteradas: 0. Ativos fora do plano: 0. Bloqueios: 0.

## Resultado

| Verificação | Resultado |
|---|---:|
| Tabelas Demonstração encontradas | 1 |
| Produtos ativos | 152 |
| Itens reais | 152 |
| Preços criados | 152 |
| Preços atualizados | 0 |
| Associações removidas | 0 |
| Inativos incluídos | 0 |
| Produtos novos | 0 |
| Produtos modificados | 0 |
| Preços diferentes de R$ 1,00 | 0 |
| Duplicidades | 0 |
| Ativos ausentes | 0 |
| Outras tabelas/preços alterados | 0 |

Todos os documentos anteriores de produtos, tabelas e preços foram comparados integralmente, inclusive timestamps: intactos. A Dio Animalli permanece intacta. O Pré-Lavagem The Luxe 1:5 5L está incluído a R$ 1,00.

## Amostragem

| Linha | Produto | Preço |
|---|---|---:|
| Dream Color | Shampoo Dream Color Pré-Lavagem 1:12 5L | R$ 1,00 |
| The Luxe | Shampoo The Luxe Lichia & Romã 5L | R$ 1,00 |
| Zoom | Shampoo Zoom Pré Lavagem 5L | R$ 1,00 |
| Vanity Pet | PERFUME VANITY ULTRA PREMIUM BABY 50ML | R$ 1,00 |
| Dream Color Care | SHAMPOO DREAM COLOR LINE CARE PRÓPOLIS 500ML | R$ 1,00 |
| The Luxe | Shampoo The Luxe Pré-Lavagem 1:5 5L | R$ 1,00 |

## Idempotência

Nova execução somente leitura: 152 preços inalterados, zero criações, atualizações ou remoções. O script sincroniza exclusivamente as associações da Demonstração, removendo inativos/órfãos quando necessário. Não modifica produtos. Bloqueia tabelas ou associações duplicadas e status de produto desconhecido. A gravação exige transações e índices únicos existentes.

## Comandos executados (em backend)

Simulação: node src/scripts/sincronizarTabelaDemonstracao.js --report reports/tabela-demonstracao-simulacao.json

Aplicação: node src/scripts/sincronizarTabelaDemonstracao.js --report reports/tabela-demonstracao-execucao.json --apply

Pós-gravação: node src/scripts/sincronizarTabelaDemonstracao.js --report reports/tabela-demonstracao-pos-gravacao.json

Script: src/scripts/sincronizarTabelaDemonstracao.js. Quatro testes passaram: node --test test/tabelaDemonstracao.test.js. O relatório escolhido não pode existir, preservando execuções anteriores. O padrão usa timestamp. O script carrega o .env do backend; fora de development/test/staging exige também --permitir-producao.

Evidências: tabela-demonstracao-execucao.json, arquivos .antes.json e .depois.json, simulação e pós-gravação, todos em reports. Não houve commit, push ou deploy.
