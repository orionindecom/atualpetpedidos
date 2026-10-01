# Evolução de usuários, carteiras e permissões — revisão local

Data: 30/09/2026. Nenhum commit, push, deploy ou alteração na base real foi realizado.

## Resultado

- Gestão de pessoas em `/usuarios`: nome, e-mail, senha inicial, perfil, ativo/inativo e overrides de permissões. Edição posterior invalida sessões anteriores com o `tokenVersion` já existente.
- Perfil Vendedor, carteira pesquisável em `/carteira`, dashboard de vendas em `/vendas` e seleção de cliente que abre o **mesmo** componente `Catalogo` usado pelo distribuidor.
- Atribuição/troca de vendedor na gestão de usuários e nos detalhes da administração de clientes. Usuários Comercial também podem ser responsáveis por carteiras.
- Distribuidor entra em `/conta`, com resumo, pedidos recentes, último pedido, acompanhamento, recebimento pendente e atalhos autorizados para conteúdo.
- Comercial preserva os acessos anteriores e recebe Treinamentos/Materiais por padrão, sem procurar nome ou e-mail da Letícia. Seu acesso global a pedidos continua ativo por compatibilidade; negar `pedidosTodos` limita o Comercial à carteira.

## Modelos e banco

O cliente/distribuidor já é um documento de `Usuario`; não foi criado um segundo modelo de cliente.

- `Usuario`: enum `tipo` inclui `vendedor`; `nomeResponsavel` continua representando o nome da pessoa; novos campos opcionais `permissoes` e `vendedorResponsavelId` (referência a Usuario). Índice declarado `{ vendedorResponsavelId: 1, tipo: 1 }`.
- `Pedido`: referência opcional `vendedorResponsavelId` como fotografia do responsável na criação; `criadoPor` registra usuário, nome e perfil também para pedidos do distribuidor. Históricos existentes aceitam autoria de vendedor. A propriedade `clienteId` continua sendo a identidade do distribuidor.
- Nenhum status foi criado ou removido. Separação, conferência, faturamento, recebimento, preços, PDFs e cálculo de produção reutilizam os serviços existentes.

### Fallbacks e compatibilidade

Não há migração destrutiva nem necessidade de preencher os documentos antes do primeiro login. Na ausência de `permissoes`, aplica-se o padrão do perfil legado. Um override booleano substitui apenas a permissão correspondente. Sem responsável, clientes permanecem disponíveis ao Admin/Comercial global, sem aparecer em carteiras de vendedores. Pedidos antigos continuam consultáveis sem `criadoPor` ou fotografia do vendedor.

O histórico de pedidos não foi reatribuído. A autorização consulta o **responsável atual no cliente**, não a fotografia no pedido. Isso inclui pedidos antigos e pedidos criados diretamente pelo distribuidor. O índice novo foi somente declarado no schema; não foi criado na base real. O ambiente de produção usa `MONGO_AUTO_INDEX=false`: futuramente aplicar o fluxo existente de criação de índices, após revisão local.

## Autorização

- Política central do backend em `backend/src/utils/permissions.js`, middleware `exigirPermissao` e serviço de escopo `authorizationService.js`.
- Frontend mantém sua política de apresentação em `frontend/src/utils/permissionPolicy.js`, com teste de paridade dos padrões e overrides. Os arquivos ficam dentro de cada pacote para preservar builds independentes (`render.yaml` usa `rootDir: backend`). A decisão de segurança continua exclusivamente no backend.
- Admin conserva acesso global. Vendedor permanece restrito à carteira, inclusive se um override de `pedidosTodos` for enviado.
- Consultas, catálogo em nome do cliente, criação, detalhes, PDF e edição verificam escopo no servidor. Aprovação/exclusão também verificam escopo quando o usuário não possui acesso global.
- Edição de vendedor/Comercial sem escopo global: apenas `aguardando_aprovacao`, `novo` e `em_analise`, seguida da regra existente de edição. Ao entrar na operação, retorna 409. Admin/Comercial global mantêm edição com reconciliação operacional e controle de versão já existentes.
- Conferência e produção têm verificações de permissão. Operação permanece reservada a Admin/Logística e mantém as regras de PIN, operador e transição já existentes. Permissão não ignora esses pré-requisitos nem libera etapas incompatíveis com o perfil.
- `/auth/me` atualiza a identidade/permissões usadas pelos guards. Um 403 de escopo em uma API de negócio permite exibir a recusa sem deslogar; 401 e recusa da validação de sessão encerram a sessão.

## Endpoints

Todos os endpoints abaixo ficam sob `/api`.

| Endpoint | Resultado |
| --- | --- |
| `GET /auth/me` | Identidade atual e permissões; sem tokenVersion na resposta |
| `GET /usuarios` | Usuários sem senha, catálogo de permissões e padrões dos perfis |
| `POST /usuarios` | Criação validada, senha com bcrypt |
| `PATCH /usuarios/:id` | Edição, status e permissões; invalidação de sessão |
| `GET /usuarios/:id/carteira` | Clientes atribuídos ao responsável |
| `PATCH /usuarios/:id/vendedor` | Atribuição, troca ou remoção do vendedor do distribuidor |
| `GET /carteira` | Clientes permitidos para o usuário |
| `GET /carteira/:id` | Dados básicos e pedidos; 403 fora da carteira |
| `GET /pedidos/comercial/distribuidores` | Seleção de compradores elegíveis, com escopo |
| `GET /pedidos/comercial/distribuidores/:id/catalogo` | Catálogo existente, com validação do comprador |
| `POST /pedidos/comercial` | Criação por vendedor/Comercial/Admin com autorização |
| `POST /pedidos` | Fluxo atual do distribuidor, acrescido de autoria |
| `GET /pedidos` | Lista global ou filtrada pelos clientes da carteira |
| `GET /pedidos/:id`, `GET /pedidos/:id/aprovacao`, `GET /pedidos/:id/pdf` | Consulta e documento com escopo |
| `PUT /pedidos/:id` | Permissão, carteira, status, versão e histórico existentes |
| `PATCH /pedidos/:id/aprovar`, `DELETE /pedidos/:id` | Permissão específica e validação de escopo |
| `GET /produtos` | Consulta auxiliar da tela de pedidos também disponível ao vendedor; mutações continuam Admin |
| `/treinamentos`, `/materiais-marketing` | Acesso por permissão; conteúdo publicado acessível a contas internas autorizadas |
| `GET /logistica/necessidade-producao`, `PATCH /logistica/pedidos/:id` | Verificações adicionais de produção/conferência/faturamento, preservando fluxo atual |

Dashboard do distribuidor reutiliza `GET /pedidos/meus`; não foi duplicada a API de pedidos nem o catálogo.

## Testes e verificação

| Verificação | Resultado |
| --- | --- |
| Backend: `node --test` dentro de backend | **382 passaram, 0 falhas** |
| Frontend: `node --test` dentro de frontend | **180 passaram, 0 falhas** |
| Frontend: `node node_modules/eslint/bin/eslint.js .` | **Passou, sem erros ou avisos** |
| Backend: `node --check` para todos os arquivos JS de src | **Passou** |
| Frontend: `node node_modules/vite/bin/vite.js build` | **Passou** |
| TypeScript/typecheck | Projeto JS/JSX, sem tsconfig ou script typecheck; não foi executado um typecheck TypeScript |

O npm global desta máquina aponta para um `npm-cli.js` ausente. As verificações foram executadas diretamente com Node, usando as mesmas ferramentas locais dos scripts existentes, sem instalar dependências.

Testes adicionados em `backend/test/novosPedidosApi.test.js` cobrem os 17 cenários solicitados em conjunto com os testes existentes: criação própria do distribuidor, recusa de acesso cruzado, carteira própria/alheia, criação por vendedor, leitura de pedido criado pelo cliente, edição permitida/bloqueada, Comercial com/sem escopo global, conteúdo por permissão, gestão de usuário, atribuição/troca de responsável, sessão legada e regressão operacional.

Dois testes HTTP percorrem todo o fluxo para pedidos criados por **distribuidor e vendedor**: pedido → aprovação → demanda de produção → separação → conferência → fechamento por operador Logística identificado → faturamento → envio → confirmação de recebimento. Usam Express, JWT, controllers e modelos reais, com operações de banco simuladas em memória.

`frontend/test/permissions.test.js` cobre permissões/rotas, overrides, perfis legados, isolamento e paridade de política. Testes existentes que fixavam nomes de middlewares, enum exato ou redirecionamento antigo foram atualizados para os contratos novos; todos foram executados.

Inspeção manual no navegador, com API sintética local e build real: login do distribuidor, dashboard e indicadores, abertura de pedido recente, login de vendedor, carteira, dados/pedidos do cliente, seleção direta que abre o catálogo reutilizado, login Admin e formulário de gestão/permissões. Um problema de sobreposição com o menu lateral foi identificado e corrigido. Não houve erros de console nas telas verificadas.

## Pontos para atenção na revisão

- Nenhum teste foi conectado a MongoDB real e nenhuma conta real da Letícia foi acessada. Validar a atualização em uma base de homologação antes de publicar. O perfil Comercial recebe Treinamentos por padrão; um override explícito existente negando essa permissão continuará prevalecendo.
- O Comercial mantém acesso global por compatibilidade. Para um Comercial operar somente sua carteira, negar `pedidosTodos` na gestão de permissões.
- A operação conserva as limitações anteriores do perfil e do PIN. As permissões não transformam um vendedor em operador logístico nem mudam quem pode faturar segundo as regras existentes.
- O build avisa que o bundle JS supera 500 kB (aproximadamente 563 kB, 159 kB gzip). Não impede o build; divisão de bundle fica fora desta evolução.
- Não foram alterados os cálculos de produção, serviços de PDF ou status. As regressões automatizadas passaram; a inspeção visual de documentos reais e o uso em uma base de homologação permanecem para a revisão posterior.

## Arquivos alterados e criados

A lista abaixo inclui código, testes e este relatório; artefatos temporários de validação foram removidos.

- `backend/src/controllers/authController.js`
- `backend/src/controllers/logisticaController.js`
- `backend/src/controllers/pedidoComercialController.js`
- `backend/src/controllers/pedidoController.js`
- `backend/src/middlewares/adminMiddleware.js`
- `backend/src/middlewares/authMiddleware.js`
- `backend/src/middlewares/permissionMiddleware.js`
- `backend/src/models/Pedido.js`
- `backend/src/models/Usuario.js`
- `backend/src/routes/authRoutes.js`
- `backend/src/routes/carteiraRoutes.js`
- `backend/src/routes/logisticaRoutes.js`
- `backend/src/routes/materialMarketingRoutes.js`
- `backend/src/routes/pedidoRoutes.js`
- `backend/src/routes/produtoRoutes.js`
- `backend/src/routes/treinamentoRoutes.js`
- `backend/src/routes/usuarioRoutes.js`
- `backend/src/server.js`
- `backend/src/services/authorizationService.js`
- `backend/src/services/clientePedidoService.js`
- `backend/src/utils/contentAudience.js`
- `backend/src/utils/permissions.js`
- `backend/test/comercial.test.js`
- `backend/test/groomer.test.js`
- `backend/test/logistica.test.js`
- `backend/test/marketing.test.js`
- `backend/test/materialMarketing.test.js`
- `backend/test/novosPedidosApi.test.js`
- `backend/test/treinamentos.test.js`
- `frontend/src/api/axios.js`
- `frontend/src/App.jsx`
- `frontend/src/components/ClientDetails/ClientDetailModal.jsx`
- `frontend/src/components/ClientDetails/SellerAssignment.jsx`
- `frontend/src/components/Navbar/Navbar.jsx`
- `frontend/src/components/RouteGuards/RouteGuards.jsx`
- `frontend/src/pages/AdminPedidos/AdminPedidos.jsx`
- `frontend/src/pages/AdminUsuarios/AdminUsuarios.jsx`
- `frontend/src/pages/Carteira/Carteira.jsx`
- `frontend/src/pages/ContaDashboard/ContaDashboard.css`
- `frontend/src/pages/ContaDashboard/ContaDashboard.jsx`
- `frontend/src/pages/Login/Login.jsx`
- `frontend/src/pages/MeusPedidos/MeusPedidos.jsx`
- `frontend/src/pages/NovoPedidoComercial/NovoPedidoComercial.jsx`
- `frontend/src/utils/permissionPolicy.js`
- `frontend/src/utils/permissions.js`
- `frontend/test/comercial.test.js`
- `frontend/test/logistica.test.js`
- `frontend/test/marketing.test.js`
- `frontend/test/permissions.test.js`
- `VALIDACAO_USUARIOS_PERMISSOES.md`
