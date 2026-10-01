# Refinamento backend — Central Atual Pet

Rodada exclusivamente backend, 30/09/2026. Sem commit, push ou deploy. Alterações anteriores de frontend foram preservadas; nenhum arquivo frontend foi editado nesta rodada.

## Autorização e presets

Fonte de verdade: `src/utils/permissions.js`. Perfil base define o preset; `permissoes` é um objeto de overrides booleanos. Chave ausente herda o perfil, `false` revoga e `true` concede. Chaves desconhecidas ou valores não booleanos são rejeitados na administração. Admin ativo preserva acesso total; permissões operacionais continuam exigindo identidade logística e PIN, conforme regras anteriores. Vendedor nunca recebe escopo global, mesmo com override `pedidosTodos: true`.

Escopo estrutural: Admin e Comercial ativos têm visão global. Vendedor usa a relação atual `Usuario.vendedorResponsavelId`; carteira vazia gera filtro com zero resultados. Escopo global não concede automaticamente ações individuais: endpoints continuam exigindo suas permissões. Comercial com `pedidosTodos: false` continua global nas ações autorizadas pelo preset, sem virar vendedor. Reatribuição afeta imediatamente clientes e pedidos antigos; o snapshot do pedido permanece como rastreabilidade, não como autorização.

Presets finais:

- Admin: todas as chaves conhecidas.
- Vendedor: clientes, criarPedidos, editarPedidos, pedidosCarteira.
- Comercial: preset Vendedor + pedidosTodos, comercial, aprovarPedidos, excluirPedidos, treinamentos, acompanharTreinamentos.
- Marketing: conteudo, treinamentos, acompanharTreinamentos, criarTreinamentos, editarTreinamentos, excluirTreinamentos.
- Logística: logistica, producao, conferencia, faturamento.
- Cliente/Distribuidor e Groomer: treinamentos, materiais.

Novas capacidades: `acompanharTreinamentos`, `criarTreinamentos`, `editarTreinamentos`, `excluirTreinamentos`. `treinamentos` permanece leitura do conteúdo público. `conteudo` continua protegendo os outros módulos de conteúdo; treinamento agora usa capacidades específicas. Comercial não recebe `materiais` por padrão, mas override explícito continua permitido. Nenhuma conta foi modificada no banco e nenhum nome/e-mail foi hardcodado.

## Contratos HTTP

Todos os caminhos abaixo são relativos à raiz da API configurada no projeto. Autenticação: `Authorization: Bearer <token>`. Administração de usuários exige `usuarios`; IDs são ObjectId hexadecimais válidos.

| Método e caminho | Contrato |
| --- | --- |
| GET /usuarios | `{ usuarios, permissoes, perfis }`; usuários sem senha/tokenVersion, com `permissoesEfetivas` |
| GET /usuarios/presets | `{ permissoes: { chave: descrição }, perfis: { tipo: [chaves] } }` |
| GET /usuarios/vendedores | Lista de vendedores ativos: `_id`, nomeResponsavel, email, tipo, ativo |
| POST /usuarios | Criação; corpo abaixo; 201 com usuário salvo |
| PATCH /usuarios/:id | Edição do estado final, incluindo ativar/desativar via `ativo`; 200 com usuário salvo |
| GET /usuarios/:id/carteira | Lista de clientes atualmente atribuídos ao usuário |
| PATCH /usuarios/:id/vendedor | `{ vendedorResponsavelId: "ObjectId" }`; atribuir/trocar. `null` remove; retorna cliente atualizado |
| GET /carteira | Clientes permitidos pela autorização do usuário autenticado |
| GET /carteira/:id | `{ cliente, pedidos }`, com verificação de escopo por ID |
| GET /auth/me | `{ usuario }`, incluindo overrides e `permissoesEfetivas` |
| POST /auth/login | Contrato existente + `usuario.permissoesEfetivas` |

Corpo de criação/edição:

```json
{
  "nomeResponsavel": "Pessoa",
  "email": "pessoa@example.com",
  "tipo": "vendedor",
  "ativo": true,
  "permissoes": { "treinamentos": true },
  "senha": "SenhaInicialForte123!"
}
```

Na edição, senha pode ser omitida ou vazia para preservá-la; criação exige senha forte. Nome, e-mail, tipo, ativo e permissoes compõem o estado final. Para ativar/desativar, enviar esse estado com `ativo` atualizado; não há endpoint de status separado. Salvar usuário é uma única escrita de documento, incluindo auditoria; atribuição de vendedor é outra operação explícita e atômica, com condição sobre a relação anterior para evitar sobrescrita concorrente. Não existe salvamento automático nem dependência de seleções no frontend. Essas duas operações não compõem uma transação conjunta.

Restrições mantidas: impedir perda do próprio acesso administrativo; preservar identidade de contas externas com histórico; reatribuir carteira antes de mudar para perfil incompatível; invalidar sessões antigas em edição de usuário por tokenVersion. Atribuição aceita vendedor ativo ou Comercial ativo por compatibilidade anterior; Comercial continua global mesmo quando atribuído.

## Treinamentos

| Método e caminho | Capacidade |
| --- | --- |
| GET /treinamentos; GET /treinamentos/:id; progresso pessoal existente | treinamentos |
| GET /admin/treinamentos | acompanharTreinamentos |
| GET /admin/treinamentos/:id | acompanharTreinamentos |
| GET /admin/treinamentos/:id/progresso | acompanharTreinamentos |
| GET /admin/treinamentos/:id/nao-iniciados | acompanharTreinamentos |
| POST /admin/treinamentos | criarTreinamentos |
| PUT /admin/treinamentos/:id | editarTreinamentos |
| PATCH /admin/treinamentos/:id/status | editarTreinamentos |
| DELETE /admin/treinamentos/:id | excluirTreinamentos |

Autorização de escrita executa antes do upload. Comercial pode ler conteúdo e acompanhar; não cria/edita/exclui nem altera arquivos por padrão. Permissões individuais podem conceder capacidades específicas.

`/:id/progresso` mantém o contrato anterior: `{ treinamento, resumo, usuarios, paginacao }`. Resumo contém totalIniciaram, totalConcluiram, mediaProgresso e ultimoAcessoEm. Cada progresso contém usuarioId populado com identidade, percentualAssistido, concluido e datas. Paginação usa `pagina`/`limite` conforme validação existente.

Novo `/:id/nao-iniciados` retorna o público externo elegível ativo/aprovado sem registro de início. Respeita `publicos`, audienciaTipo e distribuidoresIds; público específico vazio não amplia o acesso. Treinamento legado sem publicos usa cliente. Retorno: `{ treinamento, resumo: { totalElegiveis, totalNaoIniciaram }, usuarios, paginacao }`. Cada item tem `usuarioId` com identidade, percentualAssistido 0, concluido false e datas de início/acesso null. A consulta separada preserva o comportamento anterior do endpoint de progresso. Indicadores e lista de iniciados continuam sendo os existentes; o frontend deve consumir ambos os endpoints para exibir iniciados e não iniciados.

Materiais de marketing mantêm seus endpoints e capacidade `materiais`; Comercial recebe 403 por padrão. Admin e públicos legítimos mantêm acesso.

## Erros

Formato geral `{ message }`; validação de treinamento pode incluir `{ message, errors: { campo: descrição } }`. HTTP 400: payload/ID inválido; 401: autenticação/token inválido; 403: permissão/escopo negado ou conta bloqueada; 404: recurso inexistente; 409: e-mail duplicado, restrição administrativa ou atribuição concorrente; 500: erro interno sanitizado. Endpoint vendedor não encontrado no filtro de atualização após leitura retorna 409 e exige atualização da tela. Não confiar em controles visuais para segurança.

## Auditoria e banco

Model alterado nesta rodada: Usuario, com historicoAdministrativo (acao, autorId, em, antes, depois). Criação/edição registra campos administrativos relevantes sem senha; atribuição/troca/remoção registra a relação anterior e posterior na mesma escrita. Nenhuma coleção ou infraestrutura nova. Histórico de pedidos, criador, editor e snapshot comercial continuam preservados.

`new: true` foi substituído por `returnDocument: 'after'` somente nos findOneAndUpdate de pedidos, progresso, atribuição e importação. As duas opções de findByIdAndUpdate de operadores foram mantidas, conforme limite solicitado. Testes verificam opção e documento atualizado na atribuição e progresso. Dois usos de validateSync em testes de subdocumentos foram migrados para validate assíncrono para eliminar o outro warning detectado.

## Arquivos desta rodada

- src/utils/permissions.js: presets, capacidades, escopo e permissões efetivas.
- src/routes/usuarioRoutes.js: presets/vendedores, resposta efetiva, auditoria e atribuição com controle de concorrência.
- src/models/Usuario.js: histórico administrativo.
- src/routes/authRoutes.js; src/controllers/authController.js: permissões efetivas.
- src/routes/adminTreinamentoRoutes.js: autorização por operação e consulta de não iniciados.
- src/controllers/treinamentoController.js: público não iniciado e opção Mongoose.
- src/controllers/pedidoController.js; src/scripts/importarDistribuidorEspecializado.js: opção Mongoose.
- test/novosPedidosApi.test.js: dez testes novos e ajuste da regra Comercial.
- test/imageUpload.test.js; test/treinamentos.test.js: contratos de middleware e opção Mongoose.
- test/logistica.test.js: validação assíncrona sem warning.

Middleware exigirPermissao existente foi reutilizado; nenhuma nova família de middleware. authorizationService existente consome a regra central de escopo atualizada.

## Validação e limites

- `node --test`: **392 testes passaram**, zero falhas, zero pulados; baseline de 382 preservada e dez testes acrescentados.
- Sintaxe de todos os arquivos JavaScript em src validada por `node --check`.
- Regressão HTTP existente de Distribuidor/Vendedor/Comercial → pedido → produção → separação → conferência → faturamento → recebimento passou. Cálculo necessidade = pedida - separada preservado.
- Novos testes: presets/efetivas, quatro negativas de escrita Comercial, acompanhamento, marketing/overrides, troca/remoção com escopo atualizado, não iniciados e conflito concorrente.
- Cobertura anterior mantida: carteira vazia, IDs de cliente/pedido alheios, criação dentro/fora da carteira, Admin global e edição por status.
- Execução final sem warnings Mongoose. Log: backend-tests-refinamento.log na raiz do workspace.
- Backend não possui script/configuração de lint; não foi inventado um resultado de lint. Projeto JS sem typecheck configurado.
- Testes HTTP usam Express/JWT reais com persistência em memória/mocks dos models. Nenhuma conexão real MongoDB, migração ou escrita em ambiente externo foi feita. Retorno atualizado foi verificado no contrato/mocks, não em instância real do banco.
- Pendência para o agente frontend: consumir permissões/presets da API e atualizar a cópia local antiga da policy; nesta rodada ela foi intencionalmente preservada. Nenhuma validação visual ou teste frontend integra esta rodada.

## Última rodada backend — contratos finais para homologação

Esta seção atualiza os contratos anteriores somente nas três pendências solicitadas. Nenhum model, permissão geral, escopo comercial ou fluxo operacional foi alterado nesta última rodada.

### Atribuição de responsável com comparação atômica

Endpoint mantido: `PATCH /usuarios/:id/vendedor`, autenticado e protegido por `usuarios`. Agora **vendedorResponsavelEsperadoId é obrigatório**. O frontend deve enviar a relação observada quando iniciou a edição, sem substituí-la automaticamente pela relação mais recente antes do PATCH.

```json
{
  "vendedorResponsavelId": "000000000000000000000002",
  "vendedorResponsavelEsperadoId": "000000000000000000000007"
}
```

Primeira atribuição: esperado `null`, novo ID válido. Remoção: esperado ID atual, novo `null`. Troca: ambos IDs válidos. Campo ausente, string vazia ou tipo inválido recebe HTTP 400:

```json
{
  "code": "SELLER_ASSIGNMENT_EXPECTED_REQUIRED",
  "message": "Informe o vendedor responsável esperado (ID válido ou null)."
}
```

IDs novos continuam sendo validados como Vendedor ou Comercial ativo. Atualização ocorre em um único `findOneAndUpdate` cujo filtro contém `_id`, `tipo: cliente` e `vendedorResponsavelId: vendedorResponsavelEsperadoId`. `null` corresponde também ao campo ausente em clientes legados. O estado esperado vem do cliente; não é obtido por leitura prévia no backend. `$set` e `$push` de auditoria integram a mesma escrita. Retorno usa `returnDocument: 'after'`.

Sucesso: HTTP 200, documento atualizado do cliente, sem senha/tokenVersion, com permissoesEfetivas, como no contrato anterior. Em conflito a escrita não altera a relação nem adiciona auditoria. Depois da tentativa sem correspondência, uma leitura serve exclusivamente para construir a resposta; não autoriza uma segunda escrita.

HTTP 409 estável:

```json
{
  "code": "SELLER_ASSIGNMENT_CONFLICT",
  "message": "O vendedor responsável foi alterado por outro usuário.",
  "currentSellerId": "000000000000000000000002",
  "currentSellerName": "Pessoa comercial"
}
```

Sem responsável, ambos os campos currentSeller podem ser `null`; se o ID ainda existir na relação mas a conta não for localizada, somente currentSellerName é `null`. Esses dados representam a leitura após o conflito e podem mudar novamente; o frontend precisa obter nova confirmação antes de repetir. Cliente inexistente ou de outro tipo recebe 404, preservando o contrato. Não são expostos hashes, tokens, motivos internos ou dados extras no conflito.

Auditoria de sucesso mantém acao `vendedor`, autorId, em, antes.vendedorResponsavelId e depois.vendedorResponsavelId. Duas alterações distintas partindo do mesmo estado esperado resultam em uma escrita vencedora; a outra recebe 409. Nenhuma auditoria falsa é adicionada por conflito. Vendedor continua restrito à carteira; Comercial continua global, inclusive quando responsável por cliente.

**Compatibilidade:** o caminho e a resposta de sucesso não mudam, mas o payload antigo sem estado esperado deixa de ser aceito. Essa quebra explícita é necessária para impedir sobrescrita baseada em tela desatualizada. Não existe fallback inseguro.

### Responsáveis disponíveis

Novo endpoint: `GET /usuarios/responsaveis`, com autenticação e permissão `usuarios`, como a administração já existente. Retorna **Vendedor ativo e Comercial ativo**, ordenados por nome e ID. Exclui contas inativas, Admin, Cliente/Distribuidor, Groomer, Marketing e Logística. Somente estes campos são retornados:

```json
[
  { "_id": "000000000000000000000007", "nomeResponsavel": "Pessoa vendedor", "tipo": "vendedor" },
  { "_id": "000000000000000000000002", "nomeResponsavel": "Pessoa comercial", "tipo": "comercial" }
]
```

`GET /usuarios/vendedores` permanece exatamente com sua semântica anterior, apenas vendedores ativos. Não foi renomeado silenciosamente. O novo endpoint não amplia permissões; Comercial sem `usuarios` continua recebendo 403 nessa administração. Responsável inativo não é uma opção elegível; se uma relação antiga ainda referenciar tal conta, seu nome pode ser informado pelo conflito, mas ela não pode ser selecionada para nova atribuição.

### Login e status de aprovação

`POST /auth/login`: consulta de conta e comparação bcrypt continuam antes da resposta de status. E-mail inexistente, e-mail inválido e senha incorreta preservam HTTP 401 e `{ "message": "E-mail ou senha inválidos" }`, sem code/status de aprovação. A mudança não cria nova distinção entre respostas de conta inexistente e senha incorreta; não houve refatoração da política anterior de timing.

Credenciais corretas de Cliente ou Groomer pendente: HTTP 403:

```json
{ "code": "REGISTRATION_PENDING", "status": "pendente", "message": "Cadastro ainda não aprovado." }
```

Credenciais corretas de Cliente ou Groomer reprovado: HTTP 403:

```json
{ "code": "REGISTRATION_REJECTED", "status": "reprovado", "message": "Cadastro não aprovado." }
```

Conta desativada (`ativo: false`): preserva HTTP 403 e `{ "message": "Usuário desativado" }`, sem novo código/status; esse bloqueio precede o de aprovação. Outros estados externos já bloqueados, incluindo `inativo` com ativo true, preservam o bloqueio genérico anterior. Nenhum enum novo. Conta aprovada continua autenticando com token e dados de sessão existentes. Motivo interno de reprovação não é retornado.

### ALTERAÇÕES NECESSÁRIAS NO FRONTEND

1. `saveSellerAssignment` em `frontend/src/utils/sellerAssignment.js`, consumido por SellerAssignment, deve incluir `vendedorResponsavelEsperadoId: expectedSellerId || null`. A leitura prévia pode ser usada para aviso, mas não substitui a comparação no PATCH.
2. `applyPortfolioChanges`, consumido pela administração da carteira, deve incluir `vendedorResponsavelEsperadoId: client.vendedorResponsavelId || null` em cada PATCH individual, preservando o estado original de cada cliente. Não foi criado batch ou transação de carteira.
3. Em HTTP 409 com code SELLER_ASSIGNMENT_CONFLICT, consumir currentSellerId/currentSellerName e atualizar a relação exibida. Não repetir automaticamente usando o ID novo; pedir nova confirmação para uma intenção revisada. Manter tratamento de erros administrativos 409 distintos.
4. Usar `/usuarios/responsaveis` para seleção de responsáveis Vendedor + Comercial. Não consultar toda a lista de usuários apenas para descobrir Comerciais ativos. `/usuarios/vendedores` continua disponível para telas que realmente listem apenas vendedores.
5. Login deve distinguir REGISTRATION_PENDING/status pendente de REGISTRATION_REJECTED/status reprovado, mantendo o tratamento anterior de conta desativada e credenciais inválidas. Não inferir status pela mensagem nem mostrar motivo interno.

Consumidores verificados: SellerAssignment e funções de aplicação individual de carteira no módulo sellerAssignment.js. Nenhum arquivo frontend foi editado nesta última rodada; adaptação fica para o próximo agente.

### Arquivos e validação desta última rodada

Arquivos alterados: `src/routes/usuarioRoutes.js`, `src/controllers/authController.js`, `test/novosPedidosApi.test.js`, este documento. Novo arquivo: `test/loginStatus.test.js`. Models e middlewares permanecem inalterados nesta última rodada.

Foram acrescentados **24 testes**: 14 de atribuição/contrato de responsáveis (casos de sucesso, primeira atribuição desatualizada, troca desatualizada, remoção desatualizada, Comercial/Vendedor, concorrência, auditoria, cinco payloads esperados inválidos e responsáveis elegíveis/campos mínimos), e dez de login (Cliente/Groomer pendente/reprovado, três status com senha incorreta, conta inexistente, desativada e autenticação aprovada). Testes anteriores de atribuição foram adaptados ao novo campo obrigatório, sem remover casos.

Suíte completa: **416 testes passando**, zero falhas/pulados; baseline 392 preservada. A regressão operacional existente para Distribuidor/Vendedor/Comercial até confirmação de recebimento passou na mesma execução. Nenhuma alteração no cálculo necessidade = quantidade pedida - quantidade separada. Execução final sem warnings Mongoose. Sintaxe JavaScript validada; backend continua sem lint configurado.

Validação usa Express/JWT/bcrypt e mocks de persistência com aplicação conjunta do filtro/mutação. Nenhum MongoDB de homologação foi identificado de forma claramente isolada e segura; não houve conexão/escrita em dados reais. **Validação em Mongo real permanece pendente**, especialmente a confirmação do compare-and-swap em homologação antes do deploy. Sem commit, push ou deploy.
