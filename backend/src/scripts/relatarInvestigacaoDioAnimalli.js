// Somente arquivos locais. Não importa MongoDB, models nem o importador.
// Curadoria de candidatos da fotografia consultada; não é mapa de importação.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const dir = new URL("../../reports/", import.meta.url);
const originalBytes = await readFile(new URL("dio-animalli.json", dir));
const original = JSON.parse(originalBytes);
const snapshotBytes = await readFile(new URL("dio-animalli-investigacao-catalogo.json", dir));
const snapshot = JSON.parse(snapshotBytes);
const produtos = snapshot.produtos;
if (createHash("sha256").update(snapshotBytes).digest("hex") !== "5535dfb5374d331d3f7c348a31a50f1c095ba727d94c87b58642cccd63606704") throw new Error("Fotografia diferente: revisar curadoria antes de gerar");
const revisao = new Map();
const add = (linha, indice, confianca, motivo) => {
  if (!revisao.has(linha)) revisao.set(linha, []);
  const p = produtos[indice];
  revisao.get(linha).push({ id: p._id, nome: p.nome, status: p.ativo === false ? "INATIVO" : p.ativo === true ? "ATIVO" : "NÃO INFORMADO", linhaBanco: p.linha, categoria: p.categoria, descricao: p.descricao ?? "", criadoEm: p.createdAt, atualizadoEm: p.updatedAt, fotoUrl: p.fotoUrl ?? "", confianca, motivo });
};
const dil = "Marca, tipo, variante e embalagem coincidem. Diluição 1:5 do Excel ausente no cadastro/descrição; confirmar concentração.";
add(26,159,"ALTA","Tipo, marca, Jasmim c/ Amêndoas, 1:5 e 1L coincidem. Falta apenas espaço em AMENDOAS1:5. Registro ativo; há também registro inativo equivalente, apresentado abaixo.");
add(26,115,"ALTA","Nome completo, variante, 1:5 e 1L coincidem; registro INATIVO equivalente. Identidade alta não autoriza uso ou ativação; decidir ID com o registro ativo acima.");
add(32,158,"ALTA","Nome, variante, diluição e embalagem coincidem. Registro ativo; duplicata nominal inativa abaixo explica a ambiguidade inicial.");
add(32,86,"ALTA","Mesmo nome, variante, 1:5 e 5L do registro ativo; INATIVO. Não selecionar nem ativar automaticamente.");
add(68,19,"MÉDIA",dil + " Coco explícito; complemento ELIMINADOR DE ODORES ausente.");
add(68,18,"BAIXA","Mesma linha, Limpeza Profunda e 5L, mas fragrância e diluição não informadas. Candidato genérico menos específico que o cadastro Coco.");
add(69,18,"MÉDIA","The Luxe Limpeza Profunda 5L compatível, mas TALCO, ELIMINADOR DE ODORES e 1:5 não constam no cadastro. Não inferir Talco pela ausência de Coco.");
for (const [linha,indice] of [[70,20],[71,15],[72,17],[73,8],[74,16],[75,21],[77,23],[78,11],[79,24],[80,25]]) add(linha,indice,"MÉDIA",dil + ([77,78,79,80].includes(linha) ? " Marca The Luxe inferida da seção do Excel; presente no banco. Hífen não muda a variante." : ""));
add(71,4,"MÉDIA",dil + " Registro inativo; e equivale a & na fragrância. Cadastro ativo equivalente também listado.");
add(75,13,"BAIXA","Cadastro inativo chamado apenas filhote, na linha the luxe/categoria shampo. Não informa volume, diluição nem peles sensíveis/face. Evidência insuficiente.");
add(76,22,"MÉDIA","The Luxe, condicionador, Pronto Uso e 5L coincidem; NEUTRO não aparece neste cadastro. Não confundir com o condicionador Neutro sem Pronto Uso.");
add(76,25,"BAIXA","The Luxe Neutro 5L coincide parcialmente, mas não informa Pronto Uso; também é candidato da linha 80 (concentrado 1:5). Possível produto distinto.");
add(79,2,"ALTA","Registro inativo traz Melancia, The Luxe, condicionador, 1:5 e 5L explicitamente. Há candidato ativo sem diluição; decidir ID. Descrição diz Shampoo para cães e contradiz nome/categoria, devendo ser conferida.");
add(80,22,"BAIXA","Condicionador The Luxe Pronto Uso 5L: pronto uso diverge da diluição 1:5 da fonte, além de não declarar Neutro. Apenas alternativa para descarte manual; não associar.");
add(81,18,"BAIXA","Shampoo The Luxe Limpeza Profunda 5L pode lembrar a função pré-lavagem, mas não declara equivalência, variante nem 1:5. Não existe cadastro com The Luxe Pré-Lavagem; este mesmo ID é candidato provável de Talco (linha 69).");
for (const [linha,indice] of [[82,27],[83,9],[84,26],[85,28]]) add(linha,indice,"ALTA","Máscara de hidratação, fragrância e 500g coincidem. Banco acrescenta de, marca The Luxe e hífen; seção The Luxe confirma a marca da fonte.");
for (const linha of [82,83,84,85]) add(linha,42,"BAIXA","Máscara de Hidratação The Luxe 500g sem fragrância. Variante não demonstrada; não deve absorver a variante específica sem confirmação.");
for (const [linha,indice] of [[86,29],[87,30],[88,32],[89,31]]) add(linha,indice,"MÉDIA","Tipo, The Luxe, fragrância e 1kg coincidem. Banco acrescenta 60 Seg, não informado na fonte; confirmar se é a mesma versão/fórmula antes de escolher.");
for (const [linha,indice,motivo] of [
  [92,38,"Leave in versus Leave-in; mesma marca e 500ml."],
  [93,40,"Orelha versus Orelhas; mesma função, marca e 500ml."],
  [94,43,"Banco acrescenta de em Hidratante de Patinhas; mesma marca e 120ml."],
  [95,37,"Fluído versus Fluido; banco explicita The Luxe (seção da fonte), Finalizador Argan e 120ml coincidem."],
  [97,33,"Colônia, Cereja & Avelã e 500ml coincidem; banco acrescenta marca da seção The Luxe."],
  [98,10,"Colônia, Lichia e Romã e 500ml coincidem; e versus &, e marca da seção explicitada."],
  [99,34,"Colônia, Melancia e 500ml coincidem; banco explicita The Luxe."],
  [100,35,"Colônia, Neutro e 500ml coincidem; banco explicita The Luxe."],
  [101,36,"Colônia, Morango e 500ml coincidem; banco explicita The Luxe."],
]) add(linha,indice,"ALTA",motivo);
for (let linha=102; linha<=111; linha++) add(linha,44+linha-102,"ALTA","Nome da série (One a Ten), The Luxe, colônia e 500ml coincidem. Diferença somente de acento em Colônia e caixa.");
add(156,12,"MÉDIA","Shampoo Zoom Pré Lavagem 5L e descrição de pré-lavagem compatíveis. Hífen irrelevante, mas 1:4 não está declarado no cadastro/descrição; confirmar diluição.");
add(166,77,"ALTA","Shampoo Zoom PELOS ESCUROS e 750ml explícitos. EAN repetido do Excel não usado; variante distinta de Morango. Cadastro 5L rejeitado por embalagem.");
add(168,157,"ALTA","Shampoo Zoom MORANGO e 750ml explícitos. EAN repetido do Excel não usado; variante distinta de Pelos Escuros. Cadastro 5L rejeitado por embalagem.");
const buscas = {
  176: "almotolia, frasco, aplicador, dosador, bisnaga, recipiente; volume 1L/1000ml",
  177: "almotolia, frasco, aplicador, dosador, bisnaga, recipiente; volume 500ml",
  178: "amostra, sample, miniatura, brinde; volume 30ml",
  179: "avental, uniforme, vestuário, roupa, proteção, EPI",
  180: "jaleco, avental, uniforme, vestuário, roupa; tamanho P",
  181: "jaleco, avental, uniforme, vestuário, roupa; tamanho M",
  182: "jaleco, avental, uniforme, vestuário, roupa; tamanho G",
  183: "jaleco, avental, uniforme, vestuário, roupa; tamanho GG",
  184: "válvula, pump, bomba, dosador, dispenser, tampa; galão 5L",
};
const pesos = { ALTA: 3, "MÉDIA": 2, BAIXA: 1, NENHUMA: 0 };
const montar = (r) => ({ ...r, candidatosInvestigados: revisao.get(r.linha) ?? [], melhorConfianca: (revisao.get(r.linha) ?? []).reduce((nivel,c) => pesos[c.confianca] > pesos[nivel] ? c.confianca : nivel,"NENHUMA"), buscaSemResultado: buscas[r.linha] ?? null });
const pendencias = original.naoEncontrados.map(montar);
const zoom = original.fonte.registros.filter((r) => [166,168].includes(r.linha)).map(montar);
if (pendencias.length !== 53 || new Set(pendencias.map((p) => p.linha)).size !== 53 || zoom.length !== 2) throw new Error("Cobertura inválida");
const resumo = Object.fromEntries(Object.keys(pesos).map((k) => [k,pendencias.filter((p) => p.melhorConfianca === k).length]));
const resultado = { modo: "INVESTIGACAO_SEM_ASSOCIACOES_APROVADAS", consultadoEm: snapshot.consultadoEm, totalProdutos: produtos.length, hashRelatorioOriginal: createHash("sha256").update(originalBytes).digest("hex"), hashCatalogo: createHash("sha256").update(snapshotBytes).digest("hex"), resumo, pendencias, zoom };
const escape = (v) => String(v ?? "—").replaceAll("|","\\|").replace(/\r?\n/g," ");
const table = (itens) => ["| Linha Excel | Produto no Excel | Embalagem | Candidato no banco | ID | Status | Confiança | Motivo |","|---:|---|---|---|---|---|---|---|",...itens.flatMap((p) => (p.candidatosInvestigados.length ? p.candidatosInvestigados : [{ nome:"Nenhum candidato plausível", status:"—", confianca:"NENHUMA", motivo:`Busca no catálogo completo por ${p.buscaSemResultado}. Nenhum nome, descrição, linha ou categoria sugere esse acessório.` }]).map((c) => `| ${[p.linha,`${p.nome} (diluição: ${p.diluicao})`,p.embalagem,c.nome,c.id,c.status,c.confianca,c.motivo].map(escape).join(" | ")} |`))].join("\n");
const md = [
"# Dio Animalli — investigação das 53 pendências",
`Consulta somente leitura em ${snapshot.consultadoEm}. Catálogo completo: ${produtos.length} registros (${produtos.filter((p)=>p.ativo===true).length} ativos e ${produtos.filter((p)=>p.ativo===false).length} inativos). Nenhum produto, preço, EAN ou tabela foi alterado. Nenhuma associação foi aprovada ou inserida no importador. Relatórios originais preservados.`,
"## Método e limites",
"Revisão individual dos 53 itens, comparando todos os nomes, descrições, linhas e categorias, sem limitar a produtos ativos. Consideradas acentuação, caixa, espaços (inclusive AMENDOAS1:5), hífen, e/&/c/, marca na seção The Luxe, tipo, fragrância, embalagem, diluição e complementos. Produtos de fragrância/tipo/volume claramente diferentes não foram tratados como substitutos. Acessórios pesquisados também por sinônimos. Nenhum dos 161 documentos possui campo EAN/SKU/GTIN/código equivalente; portanto não foi possível confirmar os EANs do Excel no banco. Não se consultou fonte externa nem se inferiu identidade por preço ou foto.",
"ALTA: identidade fortemente compatível; MÉDIA: provável com atributo não confirmado; BAIXA: alternativa fraca, sem escolha recomendada; NENHUMA: nenhum candidato plausível. Confiança descreve identidade, não autorização para usar um ID inativo. A diluição não declarada foi conservadoramente classificada como MÉDIA. A marca dos itens 77–101 foi obtida da seção The Luxe da fonte. Candidatos genéricos já vinculados a outra linha são sinalizados.",
"## Tabela completa das 53 pendências", table(pendencias),
"## Resumo por linha (sem dupla contagem)",
`- ALTA: **${resumo.ALTA}** das 53 linhas possuem pelo menos um candidato ALTA (inclusive registros inativos identificados explicitamente).\n- MÉDIA: **${resumo["MÉDIA"]}** têm MÉDIA como melhor confiança.\n- BAIXA: **${resumo.BAIXA}** tem apenas alternativa fraca.\n- NENHUMA: **${resumo.NENHUMA}** sem qualquer candidato plausível.\n- Sem correspondência sustentada: **${resumo.BAIXA+resumo.NENHUMA}** (BAIXA + NENHUMA).\n- Total: ${Object.values(resumo).reduce((a,b)=>a+b,0)}. As duas linhas Zoom abaixo são adicionais e não entram nas 53. Há 18 linhas com algum candidato MÉDIA, mas uma delas (79) também tem ALTA no registro inativo e foi contada em ALTA.`,
"## Produtos que parecem ausentes",
"Não há evidência de cadastro dos nove acessórios: ALMOTOLIA 1L; ALMOTOLIA 500ML; AMOSTRA 30ML; AVENTAL; JALECO P; JALECO M; JALECO G; JALECO GG; VÁLVULA PUMP PARA GALÃO 5L. Cada um foi pesquisado separadamente, sem deduzir existência a partir de cosméticos com volume igual. A conclusão se limita aos campos textuais dos 161 documentos existentes.",
"The Luxe Pré-Lavagem 1:5 5L (linha 81) também não tem identidade demonstrada no banco: Limpeza Profunda é somente alternativa BAIXA, não equivalência comprovada. The Luxe Talco (linha 69) não está explicitamente cadastrado como Talco; o nome genérico Limpeza Profunda pode ser ele, mas exige confirmação.",
"## Casos que precisam de decisão manual",
"Todas as associações continuam pendentes de aprovação. Em especial:",
`- Linhas com melhor confiança MÉDIA: ${pendencias.filter((p)=>p.melhorConfianca==="MÉDIA").map((p)=>p.linha).join(", ")}. Confirmar atributos destacados na tabela, sobretudo diluição, Talco, Neutro/Pronto Uso e versão 60 Seg.`,
"- Linhas 26 e 32: escolher conscientemente entre registro ativo e histórico inativo do Jasmim; não ativar duplicatas.\n- Linha 71: shampoo Cereja & Avelã ativo e Cereja e Avelã inativo; ambos sem diluição explícita.\n- Linha 79: condicionador Melancia inativo explicita 1:5, ativo omite diluição. Descrição do inativo diz shampoo; não usar como prova da fórmula do ativo.\n- Linha 75: o genérico inativo filhote não comprova volume/fórmula e não substitui automaticamente o ativo Peles Sensíveis.\n- Linhas 68, 69 e 81 compartilham candidato genérico Limpeza Profunda; não aprovar o mesmo ID para variantes distintas.\n- Linhas 76 e 80: separar Pronto Uso de Neutro concentrado.\n- Linhas 82–85: máscara sem fragrância é apenas alternativa BAIXA e não comprova nenhuma das quatro fragrâncias.\n- Linhas 176–184: decidir se ficam fora da futura tabela ou se há outra fonte de identificação; nenhum produto será criado nesta etapa.",
"## Dream Color Jasmim c/ Amêndoas — todos os condicionadores relevantes",
...produtos.filter((p)=> /condicionador/i.test(p.nome)&&/jasmim/i.test(p.nome)).map((p)=>`- **${p._id}** — ${p.nome}; **${p.ativo ? "ATIVO":"INATIVO"}**; linha ${p.linha}; categoria ${p.categoria}; criado ${p.createdAt}; atualizado ${p.updatedAt}; descrição ${p.descricao ? JSON.stringify(p.descricao):"ausente/vazia"}; foto ${p.fotoUrl ? "presente":"ausente"}.`),
"1L: o ativo termina em AMENDOAS1:5 1L, enquanto o inativo tem espaço antes de 1:5. Esse espaço explica por que a primeira simulação encontrou somente o inativo. 5L: ativo e inativo têm nome idêntico, explicando a ambiguidade. Ambos os ativos foram criados depois dos inativos; isso sugere duplicação histórica, mas não prova qual ID deve ser usado. Há também shampoos Jasmim 1:12 (1L e 5L) e colônia Jasmim 300ml: são tipos/embalagens diferentes, excluídos como substitutos do condicionador.",
"## Zoom — EAN duplicado 7898360015566", table(zoom),
"Cada variante tem um registro ativo explícito de 750ml. O EAN não foi usado na identificação e continua sem validação no banco. Registros 5L de Pelos Escuros (6a5aab4b97e2675dd0e46f3b) e Morango (6a5aab4b97e2675dd0e46f3d) foram examinados e descartados por volume/diluição diferentes. Nenhum EAN foi alterado.",
"## Rastreabilidade",
`Fonte: dio-animalli.json original; SHA-256 ${resultado.hashRelatorioOriginal}. Fotografia somente leitura: dio-animalli-investigacao-catalogo.json; SHA-256 ${resultado.hashCatalogo}. Dados estruturados deste relatório: dio-animalli-investigacao.json.`,
"Gerador local: `node src/scripts/relatarInvestigacaoDioAnimalli.js` (a partir de backend). Ele lê somente os arquivos, não conecta ao banco e não altera o importador. A curadoria se refere à fotografia consultada e deve ser revista se o catálogo mudar. Nenhum --apply, commit, push ou deploy executado.",
].join("\n\n")+"\n";
await writeFile(new URL("dio-animalli-investigacao.json",dir),JSON.stringify(resultado,null,2)+"\n");
await writeFile(new URL("dio-animalli-investigacao.md",dir),md);
console.log(JSON.stringify({resumo,linhas:pendencias.length,zoom:zoom.length,candidatos:pendencias.reduce((n,p)=>n+p.candidatosInvestigados.length,0)},null,2));
