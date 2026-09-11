# Necessidade de Produção e pedidos pelo Comercial

Implementação local de 10/09/2026, com correção da necessidade de produção em 11/09/2026. Sem commit, push, deploy ou alterações em banco externo.

## Estrutura e regras encontradas

- Frontend React/Vite em JavaScript, com `RoleRoute`, `Navbar`, `PageHeader`, controles de listas e estilos compartilhados. Não há configuração TypeScript.
- Backend Express/Mongoose. As permissões usam o usuário consultado no banco pelo middleware `proteger`, além do JWT.
- `Pedido` é a entidade única para pedidos. Novos pedidos aguardam aprovação e exigem conferência e fechamento logístico.
- O cliente referencia uma `TabelaPreco`; `PrecoProduto` vincula cada produto a seu valor nessa tabela. Os valores e dados do cliente são gravados como snapshot no pedido.
- `getItemSeparation` em `backend/src/utils/pedidoLogistica.js` é a fonte de verdade para atendimento: quantidade final, se registrada, senão quantidade separada. Apenas quantidade conferida, sem quantidade final registrada, não substitui essa regra.
- Não foi encontrado módulo, entidade ou integração de saldo de estoque ou geração de OPs nesta base. A nova página apresenta a demanda em aberto para apoiar a priorização das OPs.

## Necessidade de Produção

Página `/necessidade-producao`; API `GET /api/logistica/necessidade-producao`.

Admin e Logística acessam; Comercial, Cliente, Marketing e Groomer não acessam. O menu e a rota usam as permissões existentes. A API fica sob `proteger` e `somenteOperacaoLogistica`, independentemente do frontend.

Um pedido só contribui após o início efetivo da separação. A ação **Iniciar separação**, definida em `getOrderFlowStage`, avança o pedido para `separando`. O backend grava essa transição em `historicoStatus`, com data e responsável; a auditoria a apresenta como `separacao_iniciada`. O cálculo reutiliza `extrairMarcosPedido`, já utilizado nas métricas, para reconhecer esse marco com data válida a partir da aprovação. As etapas atuais `separando` e `separado` também comprovam o início no fluxo existente, preservando pedidos legados sem histórico completo. Aprovação, liberação, operador associado ou quantidade preenchida isoladamente não comprovam início.

Os estados `aprovado`, `novo`, `em_analise`, `separando` e `separado` são apenas o pré-filtro da consulta, antes dessa verificação. Pedidos nas etapas anteriores à separação sem o marco de início são completamente ignorados, mesmo com quantidade separada inicializada em zero. Ficam fora `aguardando_aprovacao`, `faturado`, `enviado`, `entregue`, `cancelado` e estados desconhecidos, inclusive quando possuem início no histórico. Pedidos com entrega registrada na data ou no histórico também ficam fora, mesmo com status inconsistente.

Por item:

1. Após comprovar o início do pedido, reutiliza `getItemSeparation` para obter quantidade solicitada, atendida e faltante.
2. Quantidade separada ausente, nula, vazia ou inválida significa item não processado, como nos bloqueios existentes da separação. Esse item é ignorado, inclusive quando adicionado a uma separação reaberta.
3. Para itens processados, faltante = `max(solicitada − atendida, 0)`, usando a quantidade final registrada ou, na ausência dela, a separada. Zero explicitamente registrado depois do início pode representar falta total; campo não preenchido nunca vira falta total.
4. Itens totalmente atendidos e pedidos sem faltas identificadas são omitidos. Excedentes de um pedido não compensam faltas de outros.

O formulário logístico também foi corrigido: `buildOrderOperationsPayload` envia apenas quantidades preenchidas. Antes, salvar um item convertia os campos vazios dos demais em zero. Agora esses itens continuam não processados, enquanto o zero explícito é preservado. A correção usa campos e marcos existentes; não cria status, schema ou migração adicional.

A consolidação soma faltantes pelo ID do produto e conta pedidos distintos, não linhas. Ordena pela maior falta e destaca os três primeiros produtos. A consulta considera todos os pedidos elegíveis antes da paginação visual de 12 registros; o cálculo não usa somente a primeira página. A API projeta os campos necessários, usa o índice existente por status e limita o tempo de consulta. A consolidação ocorre em memória, reutilizando a função de atendimento, sem regra duplicada em uma agregação MongoDB.

## Novo pedido pelo Comercial

Página `/pedidos/novo`, disponível no menu e em Pedidos para o Comercial. Admin mantém suas permissões existentes; o lançamento em nome do cliente é específico do Comercial.

- Lista somente distribuidores ativos/aprovados com tabela ativa, usando projeção reduzida. Não libera o gerenciamento administrativo de clientes ao Comercial.
- O `Catalogo` existente atende os dois fluxos, incluindo busca, filtros, paginação, produtos, quantidades e resumo. A revisão comercial usa o modal e o tratamento de foco existentes.
- Ao trocar o distribuidor, desmonta o catálogo anterior, cancela suas consultas e reinicia itens, filtros e preços. Caso haja itens, a interface confirma seu descarte.
- O catálogo comercial e a criação revalidam o distribuidor e sua tabela no servidor. Se o vínculo da tabela mudar durante o lançamento, retorna 409 e solicita nova seleção. Valores sempre são calculados com os preços vigentes no backend.
- A criação continua no mesmo `criarPedido`, modelo, numeração e fluxo de aprovação. `clienteId` pertence ao distribuidor, inclusive para consulta dos próprios pedidos e confirmação de recebimento.
- `origem` registra `cliente` ou `comercial`. `criadoPor` registra ID, nome e perfil do Comercial autenticado. O servidor define esses campos; payloads não podem forjar autoria ou aprovação. Os campos de criação são imutáveis no schema.
- Origem e responsável aparecem no detalhe interno e no evento de criação do histórico, também usado pelo relatório de auditoria. O identificador interno do Comercial não é exposto na resposta ao cliente. Pedidos legados sem origem explícita são apresentados como Cliente, compatível com o antigo fluxo exclusivo de criação por cliente.
- A criação recusa o pedido inteiro se houver item inválido, duplicado, inativo ou sem preço, evitando pedidos incompletos silenciosos. Preserva a seleção quando a API retorna erro e bloqueia novo envio enquanto a requisição está em curso. A edição existente de pedidos permanece com suas regras próprias.

APIs comerciais protegidas por `proteger` e `somenteComercial`:

- `GET /api/pedidos/comercial/distribuidores`
- `GET /api/pedidos/comercial/distribuidores/:id/catalogo`
- `POST /api/pedidos/comercial`

A criação direta continua em `POST /api/pedidos`, exclusiva do Cliente. Não é necessário migrar pedidos existentes; os novos registros recebem os campos de origem.

## Arquivos principais

| Responsabilidade | Arquivos |
| --- | --- |
| Cálculo e consulta da necessidade | `backend/src/utils/necessidadeProducao.js`, `backend/src/controllers/necessidadeProducaoController.js`, `backend/src/routes/logisticaRoutes.js` |
| Distribuidor, catálogo e criação comercial | `backend/src/services/clientePedidoService.js`, `backend/src/controllers/pedidoComercialController.js`, `backend/src/controllers/pedidoController.js`, `backend/src/controllers/catalogoController.js`, `backend/src/routes/pedidoRoutes.js` |
| Autorização e rastreabilidade | `backend/src/middlewares/adminMiddleware.js`, `backend/src/models/Pedido.js`, `backend/src/utils/pedidoAuditoria.js`, `backend/src/utils/pedidoLogistica.js` |
| Telas e navegação | `frontend/src/pages/NecessidadeProducao/`, `frontend/src/pages/NovoPedidoComercial/`, `frontend/src/pages/Catalogo/`, `frontend/src/pages/AdminPedidos/`, `frontend/src/components/Navbar/Navbar.jsx`, `frontend/src/App.jsx` |
| Consulta da origem | `frontend/src/components/OrderDetails/OrderDetailModal.jsx` |
| Preservação de itens não processados | `frontend/src/utils/orderOperations.js`, `frontend/test/logistica.test.js` |
| Testes novos | `backend/test/necessidadeProducao.test.js`, `backend/test/novosPedidosApi.test.js`, `frontend/scripts/verificarPedidosUI.mjs` |

## Validação local

As suítes existentes foram executadas com `node --test`. O teste estrutural em `clientesAdmin.test.js` foi ajustado para acompanhar a extração da consulta do comprador para o serviço compartilhado.

Resultado final: **365 testes backend e 165 testes frontend aprovados**. ESLint sem erros; build Vite concluído; sintaxe dos arquivos backend modificados e `git diff --check` aprovados. O build emitiu apenas o aviso de chunk JavaScript maior que 500 kB. Não foi adicionada configuração TypeScript a um projeto que utiliza JavaScript.

Os testes novos exercitam as rotas HTTP reais do Express, JWT, autorização e validação Mongoose, com persistência simulada. Cobrem todos os perfis, cálculo e consolidação, atendimento parcial/final, legados, estados excluídos, preços por distribuidor, valores zero, autoria, propriedade do pedido, rejeição de itens inválidos e integração criação → aprovação → separação → necessidade.

A regressão foi reproduzida antes da correção. A suíte cobre os seis cenários solicitados: aprovado sem início (0), iniciado com 0 de 10 (10), com 4 de 10 (6), com 10 de 10 (0), dois pedidos não iniciados (consolidado vazio) e falta real de 5 junto a pedido não iniciado solicitando 20 do mesmo produto (somente 5). Também cobre os marcos do histórico, campos não processados e o payload real do frontend persistido pela rota logística, garantindo que salvar um item não registre zero nos demais.

Comandos, executados na respectiva pasta:

```text
backend:  node --test
frontend: node --test
frontend: node node_modules/eslint/bin/eslint.js .
frontend: node node_modules/vite/bin/vite.js build
```

O script `frontend/scripts/verificarPedidosUI.mjs` usa Playwright e Edge em modo headless com API simulada, sem banco ou pedidos reais. Valida Admin/Logística, exclusão de pedidos não iniciados e itens não processados nas duas visões, consolidado vazio quando existem apenas pedidos não iniciados, bloqueio Comercial/Cliente, lista e catálogo, revisão, preços distintos, troca durante carregamento, erro sem perder itens, envio único e preservação do fluxo do cliente. Larguras: 1440, 1024, 390 e 320 px, incluindo verificação de overflow e modal dentro do viewport.

Para repetir a verificação visual, inicie o Vite local com `VITE_API_URL=http://127.0.0.1:4173/api` e `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173 --strictPort`. Em outro terminal, execute `node scripts/verificarPedidosUI.mjs`. É necessário Playwright instalado; `PLAYWRIGHT_MODULE` aceita o caminho absoluto de seu `index.mjs`. `QA_OUTPUT_DIR` opcional salva capturas; `QA_BROWSER` permite outro canal instalado. O script aceita apenas servidor local.

Não houve validação contra uma instância real do MongoDB ou contas de produção. A verificação foi feita com dados controlados, rotas HTTP locais, schemas reais e navegador.
