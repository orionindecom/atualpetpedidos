# Importação Dio Animalli — decisões finais

Usa os models existentes TabelaPreco e PrecoProduto. A única criação autorizada em Produto é Shampoo The Luxe Pré-Lavagem 1:5 5L. Não modifica produtos existentes, inativos, EANs ou outras tabelas/preços.

## Fonte e aprovação

O leitor lerDioAnimalli.py requer Python 3 com openpyxl. Usa somente a aba `especializado nova `, coluna H (Valor Unitário), valores salvos no Excel e ROUND_HALF_UP para centavos. Não executa fórmulas/macros.

`data/dioAnimalliAprovado.json` fixa os 150 IDs existentes aprovados, identidades esperadas, linhas da fonte, nove exclusões, SHA-256 do Excel e ID reservado ao único novo produto. A CLI confere fonte, status ativo e identidade de cada ID. Não usa fuzzy matching ou EAN para decidir associações.

O Pré-Lavagem tem ID fixo para proteger reexecuções. Cadastro ativo com identidade completa igual pode ser reutilizado. Cadastro semelhante, inativo, ambíguo ou ID ocupado por outra identidade bloqueia criação. Talco, Pré-Lavagem, Pronto Uso, Neutro e variantes Zoom têm IDs distintos.

## Executar

Requer dependências Node do backend, .env com MONGO_URI e Python com openpyxl. A partir de backend:

```powershell
node src/scripts/importarDioAnimalli.js --file 'C:\Users\Administrador\Downloads\Eans e tabela de preço - Dio animalli.xlsx' --python 'C:\Users\Administrador\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
```

Sem --apply, apenas simula. O nome padrão do relatório tem timestamp. --report define outro arquivo, que não pode existir: relatórios anteriores nunca são sobrescritos pelo importador. Acrescentar --apply para gravar após conferir o plano. Fora de development/test/staging também exige --permitir-producao. NODE_ENV não comprova que o banco está isolado de produção.

É obrigatório obter 160 linhas, 151 IDs distintos e nove exclusões aprovadas. Mudanças na fonte/identidade/status, produtos duplicados, preços extras na Dio Animalli ou bloqueios impedem gravação. O EAN duplicado conhecido é apenas relatado; prevalecem os IDs aprovados.

## Transação e auditoria

Exige transações e os índices únicos existentes, sem criar índices. Guarda os documentos anteriores em `<relatório>.antes.json`, refaz o plano dentro da transação e valida preços e documentos protegidos antes do commit. Falhas nessa etapa revertem a transação.

Após commit, consulta novamente as coleções e compara todos os preços, produtos anteriores e demais tabelas/preços, inclusive timestamps. Se falhar após commit, mantém modo APLICADO e registra o erro; não afirma rollback de transação confirmada. Reexecução esperada: 151 preços inalterados, zero produtos novos e zero alterações de preço. O novo produto não recebe descrição, foto ou EAN inventado.

## Evidências

Relatório humano: `reports/dio-animalli-final.md`. Simulação, execução, estado anterior, consulta independente e reexecução estão separados em reports. Relatórios originais/investigativos preservados.

`verificarDioAnimalliFinal.py` compara arquivos locais: fotografia pós-importação versus estado anterior e XML do Excel. Gera validação independente dos 151 preços e relatório final. Não conecta ao banco.

```powershell
node --test test/importarDioAnimalli.test.js
```

Nove testes cobrem decisões finais, IDs ativos, exclusões, fonte alterada, criação única, variantes distintas, duplicidades, idempotência e alterações indevidas.