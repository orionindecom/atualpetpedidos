"""Auditoria independente, somente arquivos: XML original x nova fotografia do banco."""
import hashlib
import json
import posixpath
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
from zipfile import ZipFile
import xml.etree.ElementTree as ET

reports = Path(__file__).resolve().parents[2] / "reports"
read = lambda name: json.loads((reports / name).read_text(encoding="utf-8"))
executado = read("dio-animalli-execucao-final.json")
simulacao = read("dio-animalli-simulacao-final.json")
reexecucao = read("dio-animalli-pos-importacao.json")
antes = read("dio-animalli-execucao-final.json.antes.json")
depois = read("dio-animalli-conferencia-banco.json")
excel = Path(executado["fonte"]["arquivo"])
assert hashlib.sha256(excel.read_bytes()).hexdigest() == executado["fonte"]["sha256"]
ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
with ZipFile(excel) as z:
    workbook = ET.fromstring(z.read("xl/workbook.xml"))
    sheet = next(s for s in workbook.findall("m:sheets/m:sheet", ns) if s.attrib["name"] == "especializado nova ")
    rid = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    target = next(r.attrib["Target"] for r in rels if r.attrib["Id"] == rid)
    path = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
    root = ET.fromstring(z.read(path))
    cells = {c.attrib["r"]: c.find("m:v", ns).text for c in root.findall(".//m:c", ns) if c.find("m:v", ns) is not None}

tables = [t for t in depois["tabelas"] if " ".join(t["nome"].lower().split()) == "dio animalli"]
assert len(tables) == 1
tabela = tables[0]
precos = [p for p in depois["precos"] if p["tabelaPrecoId"] == tabela["_id"]]
assert len(precos) == 151 and len({p["produtoId"] for p in precos}) == 151
por_produto = {p["produtoId"]: p for p in precos}
produtos = {p["_id"]: p for p in depois["produtos"]}
assert set(por_produto) == {p["produtoId"] for p in executado["plano"]}
assert all(produtos[i]["ativo"] is True for i in por_produto)
verificados = []
for p in executado["plano"]:
    assert p["celula"] == "H" + str(p["linha"])
    valor = Decimal(cells[p["celula"]]).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    gravado = Decimal(str(por_produto[p["produtoId"]]["valor"]))
    assert valor == gravado, (p["linha"], valor, gravado)
    verificados.append({"linha": p["linha"], "celula": p["celula"], "produtoId": p["produtoId"], "produto": produtos[p["produtoId"]]["nome"], "excel": str(valor), "banco": str(gravado)})
anteriores = {p["_id"]: p for p in antes["produtos"]}
assert all(produtos[i] == p for i, p in anteriores.items())
novos = [p for i, p in produtos.items() if i not in anteriores]
assert len(novos) == 1 and novos[0]["nome"] == "Shampoo The Luxe Pré-Lavagem 1:5 5L"
assert novos[0]["_id"] == executado["produtoNovo"]["_id"]
assert novos[0]["linha"] == "The Luxe" and novos[0]["categoria"] == "Shampoo"
assert not any(novos[0].get(k) for k in ["descricao", "fotoUrl", "ean"])
for collection, field in [("tabelas", "_id"), ("precos", "tabelaPrecoId")]:
    filtrados = lambda s: {p["_id"]: p for p in s[collection] if p[field] != tabela["_id"]}
    assert filtrados(antes) == filtrados(depois)
assert {e["linha"] for e in executado["excluidos"]} == set(range(176, 185))
assert {v["linha"] for v in verificados}.isdisjoint(range(176, 185))
assert reexecucao["previstos"] == {"criar": 0, "atualizar": 0, "inalterado": 151}
assert reexecucao["produtosNovosPlanejados"] == 0 and not reexecucao["bloqueios"]
for a, b in [(69, 81), (76, 80), (166, 168)]:
    ids = {v["produtoId"] for v in verificados if v["linha"] in [a, b]}
    assert len(ids) == 2

auditoria = {"resultado": "APROVADO", "consultadoEm": depois["consultadoEm"], "tabelaId": tabela["_id"], "novoProdutoId": novos[0]["_id"], "precosConferidosNoXml": len(verificados), "divergencias": 0, "produtosExistentesIntactos": True, "outrasTabelasEPrecosIntactos": True, "verificacao": verificados}
(reports / "dio-animalli-validacao-independente.json").write_text(json.dumps(auditoria, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
amostras = [v for v in verificados if v["linha"] in [11, 26, 32, 68, 69, 76, 79, 80, 81, 82, 86, 102, 114, 156, 166, 168]]
dinheiro = lambda v: "R$ " + format(Decimal(v), ".2f").replace(".", ",")
comando_base = "node src/scripts/importarDioAnimalli.js --file 'C:\\Users\\Administrador\\Downloads\\Eans e tabela de preço - Dio animalli.xlsx' --python 'C:\\Users\\Administrador\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe'"
md = [
    "# Dio Animalli — importação final concluída",
    f"Tabela **Dio Animalli** criada e conferida. ID: `{tabela['_id']}`. Execução com commit em {executado['commitEm']}. Consulta independente posterior: {depois['consultadoEm']}.",
    "## Resultado",
    "| Verificação | Resultado |\n|---|---:|\n| Linhas válidas no Excel | 160 |\n| Produtos existentes utilizados | 150 |\n| Produtos novos criados | 1 |\n| Itens/preços reais na Dio Animalli | 151 |\n| Preços criados | 151 |\n| Preços atualizados | 0 |\n| Exclusões deliberadas | 9 |\n| Produtos inativos utilizados | 0 |\n| Divergências entre preços e coluna H | 0 |\n| Duplicidades de tabela/produto/preço criadas | 0 |\n| Produtos existentes alterados | 0 |\n| Outras tabelas ou seus preços alterados | 0 |",
    f"Único produto criado: **{novos[0]['nome']}**, ID `{novos[0]['_id']}`, linha **The Luxe**, categoria **Shampoo**, ativo. Nenhuma descrição, foto ou EAN inventado. Preço de H81: **{dinheiro(cells['H81'])}**.",
    "## Simulação e execução",
    "A simulação final, antes de qualquer escrita, apresentou 160 linhas, 151 IDs distintos, 150 produtos existentes, um novo autorizado, nove exclusões e zero bloqueios/inativos. Todos os 151 preços foram conferidos contra o XML da coluna H antes da gravação. A importação ocorreu em transação MongoDB, com validação dentro da transação e nova leitura após o commit.",
    "Os IDs das 150 correspondências existentes estão fixados em `src/scripts/data/dioAnimalliAprovado.json`, com linha/célula e identidade esperada de cada registro. A criação autorizada também tem ID reservado, permitindo repetição segura. O importador não usa fuzzy matching durante a gravação. Divergência da fonte, identidade ou status ativo bloqueia a operação.",
    "## Conferência independente após importação",
    "Uma nova consulta carregou produtos, tabelas e preços diretamente das coleções. A auditoria Python leu o XML da aba `especializado nova ` e comparou cada uma das 151 células H com o preço real do respectivo ID: **151 conferidos, zero divergências**, com arredondamento decimal ROUND_HALF_UP para centavos. A aba antiga não foi utilizada.",
    f"O catálogo passou de {len(antes['produtos'])} para {len(depois['produtos'])} produtos; as tabelas, de {len(antes['tabelas'])} para {len(depois['tabelas'])}; os preços totais, de {len(antes['precos'])} para {len(depois['precos'])}. Todos os documentos dos produtos anteriores e todas as outras tabelas/preços foram comparados integralmente, inclusive timestamps: permanecem idênticos.",
    "A nova execução SEM --apply apresentou **151 preços inalterados, zero criações/atualizações de preço e zero produtos novos planejados**. Nenhuma segunda gravação foi necessária para testar idempotência.",
    "## Amostras individuais — Excel versus banco (16 produtos)",
    "| Célula | Produto no banco | Excel arredondado | Banco | Resultado |\n|---|---|---:|---:|---|\n" + "\n".join(f"| {v['celula']} | {v['produto']} | {dinheiro(v['excel'])} | {dinheiro(v['banco'])} | Confere |" for v in amostras),
    "Talco e Pré-Lavagem têm IDs distintos. Pronto Uso e Neutro concentrado têm IDs distintos. Os dois Jasmim c/ Amêndoas utilizam somente os IDs ativos aprovados. Máscaras específicas e versões 60 Seg foram vinculadas conforme decisão final.",
    "## Exclusões deliberadamente aprovadas",
    "| Linha | Produto | Embalagem | Motivo |\n|---:|---|---|---|\n" + "\n".join(f"| {e['linha']} | {e['nome']} | {e['embalagem']} | não importado — produto não cadastrado / exclusão deliberadamente aprovada |" for e in executado['excluidos']),
    "Os nove itens não foram criados e não têm preço na Dio Animalli. As demais 104 linhas vazias, títulos, cabeçalhos e metadados da planilha continuam fora das 160 linhas válidas, conforme relatório de leitura.",
    "## EAN repetido na fonte",
    "O EAN **7898360015566** continua repetido nas linhas 166 e 168 do Excel. Isso não gerou duplicidade no banco: Pelos Escuros 750ml usa `6a5aab4b97e2675dd0e46f42`; Morango 750ml usa `6a5aab4b97e2675dd0e46f44`. O EAN não decidiu essas associações e não foi alterado.",
    "## Comandos executados (a partir de backend)",
    "Simulação final:\n\n```powershell\n" + comando_base + " --report reports/dio-animalli-simulacao-final.json\n```",
    "Importação real:\n\n```powershell\n" + comando_base + " --report reports/dio-animalli-execucao-final.json --apply\n```",
    "Nova simulação pós-importação:\n\n```powershell\n" + comando_base + " --report reports/dio-animalli-pos-importacao.json\n```",
    "## Arquivos e validações",
    "- Importador atualizado: `src/scripts/importarDioAnimalli.js`.\n- Mapa explícito: `src/scripts/data/dioAnimalliAprovado.json`.\n- Simulação: `reports/dio-animalli-simulacao-final.json`.\n- Execução e auditorias: `reports/dio-animalli-execucao-final.json`.\n- Estado anterior: `reports/dio-animalli-execucao-final.json.antes.json`.\n- Nova consulta do banco: `reports/dio-animalli-conferencia-banco.json`.\n- Conferência independente dos 151 preços: `reports/dio-animalli-validacao-independente.json`.\n- Idempotência: `reports/dio-animalli-pos-importacao.json`.\n- Nove testes de correspondência, bloqueios, idempotência e preservação passaram (`node --test test/importarDioAnimalli.test.js`).",
    "Os relatórios anteriores foram preservados. Não houve commit, push ou deploy.",
]
(reports / "dio-animalli-final.md").write_text("\n\n".join(md)+"\n", encoding="utf-8")
print(json.dumps({k: v for k, v in auditoria.items() if k != "verificacao"}, ensure_ascii=True))
