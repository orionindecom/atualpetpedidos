# Testes de carga AtualPet

Os testes usam k6. A configuracao padrao executa login, catalogo e filtros com
carga baixa; a criacao de pedidos permanece desativada.

## Politica de seguranca

- `localhost`, `127.0.0.1` e `::1` sao permitidos normalmente.
- Todo hostname remoto e bloqueado por padrao.
- Staging exige o hostname exato em `LOAD_TEST_ALLOWED_HOSTS` e
  `TARGET_ENV=staging`.
- Producao exige allowlist, `TARGET_ENV=production` e duas confirmacoes
  explicitas. Nunca execute em producao sem autorizacao formal.
- Fluxos com pedidos exigem um banco separado de teste/staging. Eles recusam a
  execucao fora de `NODE_ENV=test/staging`, salvo `CONFIRM_MUTATING_TESTS=true`.

Dominio personalizado segue as mesmas regras; nao ha deteccao por sufixo.

## Exemplos

Execucao local sem mutacao:

```powershell
k6 run -e BASE_URL=http://localhost:5000 -e CLIENT_EMAIL=<email> -e CLIENT_PASSWORD=<senha> load-tests/atualpet.k6.js
```

Staging autorizado:

```powershell
k6 run -e BASE_URL=https://api-staging.example.com -e TARGET_ENV=staging -e LOAD_TEST_ALLOWED_HOSTS=api-staging.example.com -e CLIENT_EMAIL=<email> -e CLIENT_PASSWORD=<senha> load-tests/atualpet.k6.js
```

Para incluir criacao de pedidos somente em banco descartavel de teste/staging:

```powershell
k6 run -e BASE_URL=http://localhost:5000 -e NODE_ENV=test -e RUN_ORDER_LOAD=true -e PRODUCT_ID=<id> -e CLIENT_EMAIL=<email> -e CLIENT_PASSWORD=<senha> load-tests/atualpet.k6.js
```

Uma execucao remota de producao ainda requer, alem da allowlist:

```text
TARGET_ENV=production
ALLOW_PRODUCTION_LOAD_TEST=true
CONFIRM_PRODUCTION_LOAD_TEST=I_UNDERSTAND_THIS_HITS_PRODUCTION
```

Apresente o comando, host, carga e duracao para aprovacao antes de executar.
Ajuste carga somente por `DURATION`, `CATALOG_VUS`, `FILTER_VUS`,
`LOGIN_ITERATIONS` e `ORDER_ITERATIONS`.
