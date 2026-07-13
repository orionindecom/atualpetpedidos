# Checklist de producao AtualPet

## Render

- Root directory: `backend`.
- Build command: `npm ci --omit=dev`.
- Start command: `npm start`.
- Health check: `/health/ready`.
- Confirmar Node compativel com `package.json` e todas as variaveis de
  `backend/.env.example` marcadas como segredo quando aplicavel.
- Validar alertas de reinicio, latencia p95, erros 5xx e consumo de memoria.

## MongoDB Atlas

- Executar `npm run audit:db` somente como leitura antes de criar indices.
- Conferir no Performance Advisor os indices sugeridos apos trafego real.
- Confirmar indices compostos de catalogo, clientes e pedidos declarados nos
  models; criar em janela controlada no PowerShell com
  `$env:CONFIRM_INDEX_CREATION="true"; npm run db:create-indexes`.
- Verificar duplicidades em `precoprodutos` antes de tornar o par
  `tabelaPrecoId + produtoId` unico.
- Ajustar `MONGO_MAX_POOL_SIZE` considerando o limite do tier multiplicado pelo
  numero maximo de instancias do Render.
- Manter usuario da aplicacao com permissoes minimas e lista de rede restrita.

## Vercel

- Selecionar Node.js 22 nas configuracoes de build da Vercel.
- Definir `VITE_API_URL` com a URL HTTPS do backend terminando em `/api` para
  Production e Preview.
- Confirmar que a origem exata de Production/Preview esta na allowlist do CORS.
- Manter a rewrite SPA de `frontend/vercel.json` e validar acesso direto as
  rotas protegidas.

## Testes seguros

- Usar banco separado de `test`/`staging` em qualquer teste que crie pedidos,
  usuarios ou altere senhas. Nunca apontar testes mutaveis para o Atlas atual.
- Os scripts mutaveis recusam execucao fora de `NODE_ENV=test/staging`, salvo
  confirmacao explicita. A confirmacao nao substitui backup nem isolamento.
- Executar k6 primeiro localmente e depois em staging com autorizacao.
- Nao executar carga em producao sem aprovacao especifica do comando, host,
  carga e duracao.

## Liberacao

- Rodar lint, build, testes unitarios e smoke tests de seguranca.
- Publicar primeiro o backend compativel: catalogo sem `pagina`/`limite` ainda
  retorna array para o frontend antigo.
- Publicar depois o frontend paginado, que sempre envia `pagina` e `limite` e
  tambem interpreta a resposta legada em array.
- Remover a resposta legada somente em uma liberacao futura coordenada.
- Validar login admin/cliente, catalogo paginado, filtros, pedido, PDF, tabelas,
  precos, clientes e dashboard apos o deploy de staging.
