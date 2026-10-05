# Correção do modal de pedidos

## Causa comprovada

A inclusão das ações administrativas em `OrderDetailModal.jsx` ampliou a largura intrínseca do grupo de botões que ocupava uma coluna `auto` do cabeçalho. O grid era `minmax(0, 1fr) auto auto`: título, ações e Fechar disputavam a mesma linha. A coluna do título podia chegar a zero, mesmo com `flex-wrap` no grupo de ações.

Com `overflow-wrap: anywhere`, número e cliente quebravam praticamente caractere por caractere. O cabeçalho com `flex: 0 0 auto` não podia encolher; sua altura ultrapassava o modal, limitado pela viewport. O conteúdo ficava sem altura útil e era recortado pelo `overflow: hidden` do modal/overlay, enquanto a página permanecia corretamente bloqueada pelo diálogo aberto.

Não era um erro de estado Separação nem do hook de bloqueio do body. A quantidade de ações tornava o problema visível. A mudança recente que o desencadeou foi a inclusão de “Marcar como enviado” e, nos estados elegíveis, “Retirado pelo distribuidor” na coluna de ações existente.

### Reprodução e isolamento

Pedido com 12 itens e cliente de nome longo, Admin, Separação, viewport 1024 × 768:

| Medida | Antes | Depois |
| --- | ---: | ---: |
| Largura do título | 0 px | 833 px |
| Altura do número | 621 px | 35 px |
| Altura do cabeçalho | 1719 px | 125 px |
| Área de conteúdo | 28 px | 595 px |

A reprodução anterior falhou na asserção de largura do título. Uma sondagem temporária, removendo apenas o botão novo, devolveu 143 px ao título. Outra sondagem, mantendo todos os botões e colocando as ações em outra linha, devolveu 833 px. As sondagens não ficaram no código final.

[Captura antes](qa/modal-pedidos/antes/admin-separando-1024.png) · [Captura depois](qa/modal-pedidos/depois/admin-separando-1024.png)

## Alterações

- `frontend/src/components/OrderDetails/OrderDetailModal.jsx`: cabeçalho contém título e Fechar; o grupo de ações passa para o início do conteúdo rolável. Condições de estado/permissão, callbacks e funcionalidades são preservados.
- `frontend/src/components/OrderDetails/OrderDetails.module.css`: modal centralizado, cabeçalho com duas colunas, ações com largura limitada ao conteúdo e quebra organizada; duas colunas de ações no mobile. A região de conteúdo mantém `min-height: 0`, `flex: 1 1 auto` e `overflow-y: auto`.
- `frontend/src/utils/orderOperations.js`: corrigido também um bloqueio observado ao faturar pedidos legados. O payload reenviava `separacaoItens` após encerrar a separação e o backend recusava a requisição. Agora essas quantidades só são enviadas quando a etapa permite editar separação.
- `frontend/test/orderDetailsRendering.test.js`: regressões de estrutura do modal com todas as sete ações elegíveis e do payload de faturamento legado.
- `frontend/scripts/verificarLayoutModalPedidosUI.mjs`: regressão em navegador, medidas, screenshots e fluxo de ações nas diferentes resoluções.

Nenhum código de backend, regra de estoque ou Necessidade de Produção foi alterado por esta correção visual. Não houve deploy.

## Validação

Navegador real Microsoft Edge, headless, via Playwright, executando o build de produção local. APIs simuladas em memória; atualizações de logística usam os validadores e a função de atualização reais do backend. Não foram usados dados de produção nem banco externo. As capturas foram também inspecionadas visualmente, incluindo notebook, tablet e faturamento no mobile.

| Tela | Resolução |
| --- | --- |
| Desktop largo | 1440 × 900 |
| Notebook | 1024 × 768 |
| Tablet | 768 × 1024 |
| Mobile | 390 × 844 |
| Mobile estreito | 320 × 640 |

Matriz de 90 cenários de layout:

- Admin: `novo`, `em_analise`, `aguardando_aprovacao`, `aprovado`, `separando`, `separado`, `faturado`, `enviado`, `entregue`, `retirado`, `cancelado`, nas cinco resoluções.
- Vendedor e Comercial: aprovação, separação e faturado, nas cinco resoluções; ausência das ações exclusivas de Admin conferida.
- Admin: faturamento no fluxo atual, com conferência concluída e fechamento logístico preenchido, nas cinco resoluções.

A matriz verifica limites da viewport, largura útil do título, ausência de overflow horizontal, dimensões dos botões, scroll real até o histórico, ausência de erros JavaScript, fechamento pelo botão e por Escape e restauração do `body.style.overflow`.

Nas cinco resoluções foi executado pela interface: aprovar, iniciar separação, preencher as 12 quantidades, concluir separação, preencher NF e data, faturar, preencher os quatro campos de transporte/envio, baixar os três PDFs, cancelar/confirmar retirada, editar/salvar, marcar como enviado e excluir. O faturamento foi confirmado também no fluxo atual com conferência/fechamento. Nos pedidos separados foram mantidas todas as sete ações administrativas elegíveis; em Separação todas as seis ações elegíveis.

No Distribuidor foram verificados os diálogos de confirmação e sucesso do recebimento nas cinco resoluções, incluindo cancelar, confirmar, concluir, limites da viewport e liberação da rolagem. Cancelar uma confirmação sobre o detalhe mantém o bloqueio até o detalhe ser fechado.

Número permanece em uma linha quando há espaço; em 320 px quebra em duas linhas normais. Nenhuma informação fica espremida em caracteres verticais. Os campos de faturamento e o histórico permanecem alcançáveis pela rolagem.

### Resultados

- Backend: **435 testes passaram**, zero falhas.
- Frontend: **265 testes passaram**, zero falhas.
- ESLint: passou.
- Build: passou; permanece o aviso de bundle acima de 500 kB.
- Regressão no navegador: todos os cenários e ações passaram.

[Métricas completas](qa/modal-pedidos/depois/metrics.json) · [Faturamento mobile preenchido](qa/modal-pedidos/depois/faturamento-preenchido-320.png) · [Todas as ações no notebook](qa/modal-pedidos/depois/admin-separado-1024.png)

## Reexecutar

No diretório `frontend`, com Node 22 e dependências instaladas:

```powershell
node --test
node node_modules/eslint/bin/eslint.js .
node node_modules/vite/bin/vite.js build
# Informe PLAYWRIGHT_MODULE se Playwright estiver instalado fora do projeto.
$env:PLAYWRIGHT_MODULE = 'C:\caminho\para\playwright\index.mjs'
$env:QA_OUTPUT_DIR = 'C:\caminho\para\capturas'
node scripts/verificarLayoutModalPedidosUI.mjs
```

`QA_REPRO_ONLY=1` executa apenas o cenário mínimo de Separação no notebook. `QA_BROWSER` permite outro canal Chromium disponível; o padrão é `msedge`.
