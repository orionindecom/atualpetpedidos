# Edição de pedido no mobile

## Causa e reprodução

O seletor atual não é um popover: ele é a lista de produtos com campos de quantidade dentro do modal de edição. A lista era o único bloco que podia encolher e rolar; cliente, busca e rodapé ocupavam o espaço restante. No breakpoint estreito, Buscar/Limpar e Salvar/Cancelar também se distribuíam em mais linhas. Com a altura disponível reduzida pelo teclado, o espaço da lista desaparecia e o rodapé ficava fora da tela.

Reprodução local antes da correção: Admin, pedido em Separação, 60 produtos, cliente com nome longo, largura 320 px. A lista tinha 160 px em uma viewport de 740 px de altura. Reduzindo a altura para 380 px, a lista passou a **0 px**, e o rodapé terminou em 554 px, fora da área acessível. A asserção de espaço útil falhou antes da implementação.

[Antes, com altura reduzida](qa/edicao-mobile/antes/edicao-320-380.png) · [Métricas antes](qa/edicao-mobile/antes/metrics.json)

## Correção

- No mobile, edição ocupa a largura e a altura disponíveis, respeitando safe areas.
- Header e rodapé permanecem acessíveis. Salvar/Cancelar ficam lado a lado para preservar altura útil.
- Cliente, busca e produtos passam para uma única região central rolável. A lista de resultados não tem um segundo scroll no mobile.
- A busca fica ancorada durante a rolagem. Ao focar/pesquisar, o conteúdo se posiciona para dar espaço aos resultados.
- Busca e quantidade usam campos de 48 px e fonte de 16 px. Os nomes completos quebram em várias linhas, sem ellipsis ou limite de linhas.
- Tocar no nome do produto foca sua quantidade. A regra existente é preservada: quantidade positiva inclui o produto; quantidade 0 o remove. O texto da lista explica isso.
- O modal acompanha `visualViewport.height` e `offsetTop`, pois teclados móveis podem reduzir apenas a visual viewport. Sem essa API, usa `100dvh`, com fallback em `100vh`.
- No desktop permanece o modal centralizado com a lista rolável e quantidades à direita. Os ajustes maiores são restritos ao breakpoint de 768 px.

## Arquivos deste ajuste

- `frontend/src/pages/AdminPedidos/AdminPedidos.jsx`
- `frontend/src/pages/AdminPedidos/AdminPedidos.module.css`
- `frontend/src/hooks/useDialogVisualViewport.js`
- `frontend/scripts/verificarEdicaoPedidoMobileUI.mjs`
- `frontend/scripts/verificarLayoutModalPedidosUI.mjs` (integração do novo teste e fixture de catálogo/edição)
- Este relatório e as evidências em `qa/edicao-mobile/`.

A correção anterior do modal de detalhes permanece aplicada e foi novamente validada. Sua causa e seus arquivos estão em [CORRECAO_LAYOUT_MODAL_PEDIDOS.md](CORRECAO_LAYOUT_MODAL_PEDIDOS.md). Nenhuma regra de backend, estoque ou Necessidade de Produção mudou neste ajuste.

## Validação visual e funcional

Microsoft Edge/Playwright com build local e APIs simuladas. Não foram usados dados de produção nem feito deploy. A validação de teclado é simulada no navegador; não foi executada em teclado nativo de um aparelho Android/iOS.

### Mobile

Fluxo completo nos perfis Admin, Vendedor e Comercial, respeitando os estados com permissão de edição: **9 execuções**, em **320, 375 e 430 px**. Admin começou em Separação; Vendedor/Comercial em Aguardando aprovação.

Cada execução verificou:

1. Abrir detalhes e Editar pedido.
2. Buscar produtos com nomes curtos e longos, 60 resultados da mesma busca, resultado único e busca sem resultados.
3. Buscar/Limpar e nomes completos sem truncamento.
4. Tocar no nome para acessar a quantidade e alterar um item existente.
5. Remover um produto com quantidade 0 e incluir dois produtos novos.
6. Rolar até o último resultado, preencher sua quantidade e salvar.
7. Conferir os itens/quantidades enviados e reabrir a edição com os valores salvos.
8. Alterar novamente, cancelar, reabrir e conferir que a alteração cancelada foi descartada.
9. Fechar por Escape, conferir que não ocorreu outra gravação e que o body não ficou travado.

Teclado simulado de duas formas em cada largura:

- viewport reduzida de 740 para 380 px de altura;
- layout viewport mantida em 740 px, `visualViewport.height = 380` e `offsetTop = 24`, com eventos resize/scroll.

Busca, quantidades e ações permaneceram alcançáveis. Apenas o conteúdo central rolou; o último item foi alcançado com mais de 5000 px de scroll, enquanto o scroll da lista permaneceu em 0. As variáveis da visual viewport foram removidas ao fechar o modal.

| Medida em 320 px | Antes | Depois |
| --- | ---: | ---: |
| Área abaixo da busca, altura útil 740 px | 160 px | 536,5 px |
| Área abaixo da busca, altura útil 380 px | 0 px | 176,5 px |
| Área central, altura útil 380 px | 0 px | 233 px |
| Fim do rodapé, altura útil 380 px | 554 px | 380 px |

[Busca com teclado simulado, 320 px](qa/edicao-mobile/depois/edicao-320-380.png) · [Último resultado e quantidade, 375 px](qa/edicao-mobile/depois/ultimo-resultado-375.png) · [Visual viewport reduzida, 430 px](qa/edicao-mobile/depois/visual-viewport-430.png)

### Desktop e detalhes

Edição conferida em 1440 × 900 e 1024 × 768: lista com 416 e 284 px, respectivamente, modal dentro da viewport, rolagem até o último resultado e Cancelar sem gravação. [Captura notebook](qa/edicao-mobile/depois/edicao-desktop-1024.png).

Modal de detalhes novamente verificado nos **90 cenários** anteriores: estados atuais/legados, Admin/Vendedor/Comercial, desktop/notebook/tablet/mobile, faturamento legado e atual, ações administrativas, PDFs, confirmação de recebimento do Distribuidor e desbloqueio do body.

### Checks

- Frontend: **265 testes passaram**, zero falhas.
- ESLint: passou.
- Build: passou; permanece o aviso de chunk maior que 500 kB.
- Regressão no navegador: edição mobile/desktop e detalhes passaram.

As capturas foram inspecionadas visualmente, além das asserções de dimensões, scroll, texto, payload e funcionamento dos controles. [Métricas da edição](qa/edicao-mobile/depois/metrics.json).

## Reexecutar

Após o build, no diretório `frontend`, com Playwright disponível:

```powershell
$env:PLAYWRIGHT_MODULE = 'C:\caminho\para\playwright\index.mjs'
$env:QA_OUTPUT_DIR = 'C:\caminho\para\capturas-edicao'
$env:QA_EDIT_ONLY = '1'
node scripts/verificarLayoutModalPedidosUI.mjs
```

Para repetir a matriz de detalhes, remova `QA_EDIT_ONLY` e use outra pasta de capturas. `QA_EDIT_REPRO=1` limita a edição ao primeiro cenário; `QA_EDIT_DESKTOP_ONLY=1` executa só os dois controles de desktop.
