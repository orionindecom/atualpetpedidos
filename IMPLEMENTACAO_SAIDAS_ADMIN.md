# Saídas administrativas de pedidos

Alterações locais de 05/10/2026. Não foi feito deploy, commit, push ou alteração de dados externos.

## Escopo e Necessidade de Produção

Baixa significa concluir a saída do pedido na lógica existente da Central e encerrar sua contribuição à Necessidade de Produção. O projeto mantém o cálculo das quantidades faltantes dos pedidos em `separando`, usando `getItemSeparation`. Não foram criados saldo, movimentações, integração ou módulo de estoque.

`retirado` é uma saída concluída e não participa do consolidado de produção, independentemente das quantidades separadas antigas, incompletas ou ausentes. O mesmo vale para `enviado`, inclusive quando o Admin pula etapas. A conclusão não precisa alterar quantidades físicas registradas nem inventar histórico de etapas intermediárias.

A consulta de produção projeta `retiradoEm` e o histórico existente. A mesma proteção usada pelos pedidos concluídos impede reabrir demanda quando existe data ou evento de retirada, mesmo com status inconsistente. A página de produção recebe o sinal existente de atualização após as duas ações, incluindo as outras abas.

Requisições repetidas ou concorrentes não alteram a data/autoria da primeira saída, não duplicam o evento nem provocam novas pendências. A transição e os registros são persistidos atomicamente no próprio pedido.

## Implementado

- `PATCH /api/pedidos/:id/marcar-enviado`: ação exclusiva de Admin, protegida no middleware e novamente no serviço. Avança diretamente de um estado ativo para `enviado` e grava a data de envio e um único evento `envio_direto_admin`. Não cria aprovação, separação, conferência ou faturamento fictícios.
- `PATCH /api/pedidos/:id/retirar`: ação exclusiva de Admin. Permite retirada a partir de `separado` ou `faturado`. Em `separado`, reutiliza os bloqueios existentes de separação, conferência e fechamento. Pedidos faturados legados mantêm a preparação encerrada sem exigência retroativa dos campos novos.
- `retirado` é terminal: sem regressão, edição operacional, exclusão ou confirmação de recebimento pelo cliente. Usa `retiradoEm` e `retiradoPor`, definidos pelo servidor. A data não vem de `updatedAt` nem do corpo da requisição.
- A gravação conjunta de status, data e auditoria usa comparação da versão `__v` e do status atual. Repetições retornam o pedido persistido, preservando data e autor originais. Uma edição concorrente retorna conflito; envio e retirada concorrentes não criam dois finais.
- As ações ficam no detalhe administrativo, com os modais de confirmação do sistema. Os demais perfis não recebem os botões.
- Meus Pedidos exibe `Retirado pelo distribuidor` e `Retirado em: DD/MM/AAAA às HH:mm`, no fuso `America/Sao_Paulo`. O componente de retirada usa exclusivamente `retiradoEm` e preserva minutos do registro.
- Badges próprios, filtros, representação do andamento, dashboards e relatório de auditoria reconhecem `retirado`. Os pedidos retirados contam como concluídos. O relatório inclui data e responsável.
- A necessidade de produção existente já exclui estados fora de `separando`; as saídas deixam de contribuir automaticamente, sem duplicar o cálculo nem inventar ordens de produção.
- Pedidos antigos mantêm seus campos opcionais e estados existentes. `retiradoEm` e `retiradoPor` são obrigatórios apenas para documentos em `retirado`.

## Arquivos alterados e criados

Backend:

- `backend/src/controllers/logisticaController.js`
- `backend/src/controllers/necessidadeProducaoController.js`
- `backend/src/controllers/pedidoController.js`
- `backend/src/controllers/pedidoSaidaController.js` (novo)
- `backend/src/models/Pedido.js`
- `backend/src/routes/pedidoRoutes.js`
- `backend/src/services/pdfAuditoriaPedidoService.js`
- `backend/src/services/pedidoSaidaService.js` (novo)
- `backend/src/utils/pedidoAuditoria.js`
- `backend/src/utils/necessidadeProducao.js`
- `backend/src/utils/pedidoEdicaoAdmin.js`
- `backend/src/utils/pedidoLogistica.js`
- `backend/src/utils/pedidoLogisticaView.js`
- `backend/test/logistica.test.js`
- `backend/test/necessidadeProducao.test.js`
- `backend/test/pedidoSaida.test.js` (novo)

Frontend:

- `frontend/src/components/OrderDetails/OrderDetailModal.jsx`
- `frontend/src/components/OrderDetails/OrderPickupDetails.jsx` (novo)
- `frontend/src/components/OrderProgress/OrderProgress.jsx`
- `frontend/src/components/OrderProgress/OrderProgress.module.css`
- `frontend/src/pages/AdminPedidos/AdminPedidos.jsx`
- `frontend/src/pages/AdminPedidos/AdminPedidos.module.css`
- `frontend/src/pages/ContaDashboard/ContaDashboard.jsx`
- `frontend/src/pages/ContaDashboard/OrderStatusBadge.module.css`
- `frontend/src/pages/ContaDashboard/orderStatusTone.js`
- `frontend/src/pages/ContaDashboard/orderSummary.js`
- `frontend/src/pages/Dashboard/Dashboard.jsx`
- `frontend/src/pages/LogisticaDashboard/LogisticaDashboard.jsx`
- `frontend/src/pages/LogisticaPedidos/LogisticaPedidos.module.css`
- `frontend/src/pages/MeusPedidos/MeusPedidos.jsx`
- `frontend/src/pages/MeusPedidos/MeusPedidos.module.css`
- `frontend/src/utils/orderLogistics.js`
- `frontend/src/utils/orderOperations.js`
- `frontend/test/logistica.test.js`
- `frontend/test/orderDetailsRendering.test.js`
- `frontend/test/productionDemandUpdates.test.js`

Documentação: `IMPLEMENTACAO_SAIDAS_ADMIN.md` (este arquivo).

## Verificação

Resultado da nova execução completa: **435 testes backend e 263 testes frontend aprovados**, ESLint sem erros, build Vite concluído e `git diff --check` aprovado.

As suítes usam rotas Express e JWT reais, schemas Mongoose e persistência simulada. Foram adicionados testes de autorização, avanço direto, retirada, `retiradoEm`/autoria, histórico, legados, concorrência, bloqueio de preparação incompleta, filtros e renderização React da data e das ações.

Testes específicos de produção verificam: retirada com quantidades faltantes, pendentes ou ausentes; consolidação com outro pedido ativo do mesmo produto; proteção por data/histórico com status inconsistente; projeção de `retiradoEm` pela API; envio direto com demanda aberta; consulta após retirada e repetições; preservação das quantidades e do histórico; atualização da página local e das outras abas.

Comandos locais:

```text
backend:  node --test
frontend: node --test
frontend: node node_modules/eslint/bin/eslint.js .
frontend: node node_modules/vite/bin/vite.js build
raiz:     git diff --check
```

O comando `npm` deste ambiente aponta para uma instalação ausente; os scripts equivalentes foram executados diretamente com Node.js. Não houve instalação de dependências. O build mantém o aviso de bundle maior que 500 kB. Não foi feita validação contra MongoDB real.
