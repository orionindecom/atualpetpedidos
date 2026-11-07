import crypto from "node:crypto";
import mongoose from "mongoose";
import { NATAL_2026 } from "../config/natalPremiado2026.js";
import NatalAuditoria from "../models/NatalAuditoria.js";
import NatalConta from "../models/NatalConta.js";
import NatalCupom from "../models/NatalCupom.js";
import NatalDistribuicao from "../models/NatalDistribuicao.js";
import NatalLote from "../models/NatalLote.js";
import NatalMovimentoCupom from "../models/NatalMovimentoCupom.js";
import NatalParticipacao from "../models/NatalParticipacao.js";
import { NatalCampanhaEstado } from "../models/NatalCampanhaEstado.js";
import { formatarNumeroCupom } from "../utils/natalCampanha.js";
import { gerarProtocolo, NatalError, RepetirTransacaoNatal } from "./natalBaseService.js";

// Lotes de distribuição e cupons individuais (múltiplos cupons por cadastro).
//
// Regras centrais:
// - Saldo disponível = cupons concedidos - cupons válidos - cupons aguardando validação.
//   A reserva é estrita: nenhum envio passa do disponível, nem com envios simultâneos.
// - Reserva do saldo, cadastro, lote e cupons são gravados numa única transação.
//   Qualquer falha desfaz tudo; conflitos repetem a transação do início.
// - Os números são gerados no envio, com situação "pendente" (fora do sorteio).
//   A validação da gestão os torna "valido"; rejeição devolve o saldo.
// - Uma chave de idempotência por envio faz repetições devolverem o resultado original.

const CAMPANHA = NATAL_2026.slug;

// Teto por operação: protege contra valores absurdos mesmo com saldo alto.
export const LIMITE_CUPONS_POR_LOTE = 1000;

export const multiplosCuponsAtivos = async (session) => {
  const estado = await NatalCampanhaEstado.findById(CAMPANHA).select("multiplosCupons").session(session || null).lean();
  return Boolean(estado?.multiplosCupons);
};

// Inteiro positivo estrito. Recusa vazio, zero, negativos, decimais, notação científica
// e textos com sinais ou espaços internos.
export const validarQuantidadeCupons = (valor, { maximo = LIMITE_CUPONS_POR_LOTE } = {}) => {
  const texto = typeof valor === "number" ? (Number.isInteger(valor) ? String(valor) : "") : String(valor ?? "").trim();
  if (!/^\d{1,7}$/.test(texto)) {
    return { valid: false, erro: "Informe a quantidade de cupons com um número inteiro a partir de 1." };
  }
  const quantidade = Number(texto);
  if (quantidade < 1) return { valid: false, erro: "A quantidade mínima é 1 cupom." };
  if (quantidade > LIMITE_CUPONS_POR_LOTE) {
    return { valid: false, erro: `A quantidade máxima por envio é de ${LIMITE_CUPONS_POR_LOTE} cupons.` };
  }
  if (quantidade > maximo) return { valid: false, erro: `A quantidade não pode passar do saldo disponível (${maximo}).` };
  return { valid: true, quantidade };
};

export const validarChaveIdempotencia = (valor) => (
  typeof valor === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(valor) ? valor : null
);

// ---------- Contagem (fonte da verdade para reconciliação e migração) ----------

const CONTADORES_VAZIOS = () => ({ aprovados: 0, pendentes: 0, rejeitados: 0, cancelados: 0, invalidados: 0, invalidadosRevisao: 0 });

// Conta unidades de cupom por situação. "filtro" usa clienteId ou loteId, campos
// presentes em cupons, lotes de distribuição e cadastros. Cadastros antigos sem lote
// e sem número valem 1 unidade conforme a situação do cadastro, como sempre valeram.
export const contarUnidadesCupom = async (filtro, session) => {
  const contadores = CONTADORES_VAZIOS();
  const [cupons, distribuicoes, emitidosPorDistribuicao, semLote] = await Promise.all([
    NatalCupom.aggregate([
      { $match: filtro },
      { $group: { _id: { status: "$status", revisao: { $gt: ["$revisaoId", null] } }, total: { $sum: 1 } } },
    ]).session(session || null),
    NatalDistribuicao.find(filtro).select("_id status quantidade").session(session || null).lean(),
    NatalCupom.aggregate([
      { $match: { ...filtro, distribuicaoId: { $exists: true } } },
      { $group: { _id: "$distribuicaoId", total: { $sum: 1 } } },
    ]).session(session || null),
    NatalParticipacao.find({ ...filtro, cupons: { $exists: false } }).select("_id status cupom").session(session || null).lean(),
  ]);

  for (const grupo of cupons) {
    const { status, revisao } = grupo._id;
    if (status === "valido") contadores.aprovados += grupo.total;
    else if (status === "pendente") contadores.pendentes += grupo.total;
    else if (status === "rejeitado") contadores.rejeitados += grupo.total;
    else if (status === "cancelado") contadores.cancelados += grupo.total;
    else if (status === "invalidado") contadores[revisao ? "invalidadosRevisao" : "invalidados"] += grupo.total;
  }

  // Lotes antigos ainda sem número emitido (cadastro de 1 cupom pendente ou rejeitado).
  const emitidos = new Map(emitidosPorDistribuicao.map((item) => [String(item._id), item.total]));
  for (const distribuicao of distribuicoes) {
    const faltam = Math.max(Number(distribuicao.quantidade) - (emitidos.get(String(distribuicao._id)) || 0), 0);
    if (!faltam) continue;
    if (distribuicao.status === "pendente") contadores.pendentes += faltam;
    else if (distribuicao.status === "rejeitado") contadores.rejeitados += faltam;
    else if (distribuicao.status === "cancelado") contadores.cancelados += faltam;
  }

  // Cadastros antigos sem lote nem número: 1 unidade pela situação do cadastro.
  const comLote = new Set((await NatalDistribuicao.distinct("participacaoId", {
    participacaoId: { $in: semLote.map((item) => item._id) },
  }).session(session || null)).map(String));
  for (const participacao of semLote) {
    if (participacao.cupom?.numero || comLote.has(String(participacao._id))) continue;
    if (participacao.status === "pendente") contadores.pendentes += 1;
    else if (participacao.status === "rejeitado") contadores.rejeitados += 1;
    else if (participacao.status === "cancelado") contadores.cancelados += 1;
  }
  return contadores;
};

// ---------- Numeração ----------

// N números aleatórios (fonte criptográfica) que nunca foram usados, nem por cupons
// cancelados. O índice único em "numero" barra corridas: a transação se repete.
export const emitirNumerosLivres = async (quantidade, { config = NATAL_2026, session } = {}) => {
  const { minimo, maximo, tentativas } = config.numeracao;
  const capacidade = maximo - minimo + 1;
  const usados = await NatalCupom.countDocuments({ campanha: CAMPANHA, numero: { $gte: minimo, $lte: maximo } }).session(session || null);
  const livres = capacidade - usados;
  if (livres < quantidade) {
    throw new NatalError(503, "Não há números de cupom livres suficientes. Amplie o intervalo de numeração.", "numeracao_esgotada");
  }
  // Intervalo quase cheio: sorteio exato entre os números livres, sem depender de tentativas.
  if (livres < quantidade * 20 && capacidade <= 200000) {
    const ocupados = new Set((await NatalCupom.find({ campanha: CAMPANHA, numero: { $gte: minimo, $lte: maximo } })
      .select("numero").session(session || null).lean()).map((item) => item.numero));
    const disponiveis = [];
    for (let numero = minimo; numero <= maximo; numero += 1) if (!ocupados.has(numero)) disponiveis.push(numero);
    for (let indice = disponiveis.length - 1; indice > 0; indice -= 1) {
      const troca = crypto.randomInt(0, indice + 1);
      [disponiveis[indice], disponiveis[troca]] = [disponiveis[troca], disponiveis[indice]];
    }
    return disponiveis.slice(0, quantidade);
  }
  const escolhidos = new Set();
  for (let rodada = 1; escolhidos.size < quantidade; rodada += 1) {
    if (rodada > tentativas) {
      throw new NatalError(503, "Não foi possível gerar números de cupom únicos. Amplie o intervalo de numeração.", "numeracao_esgotada");
    }
    const candidatos = new Set();
    while (candidatos.size < quantidade - escolhidos.size) {
      const numero = crypto.randomInt(minimo, maximo + 1);
      if (!escolhidos.has(numero)) candidatos.add(numero);
    }
    const repetidos = await NatalCupom.find({ campanha: CAMPANHA, numero: { $in: [...candidatos] } })
      .select("numero").session(session || null).lean();
    const ocupados = new Set(repetidos.map((item) => item.numero));
    for (const numero of candidatos) if (!ocupados.has(numero)) escolhidos.add(numero);
  }
  return [...escolhidos];
};

// ---------- Origem do saldo ----------

// Extrato da conta como segmentos de saldo em ordem de chegada. Entradas negativas
// (adequação, ajuste para menos) retiram dos segmentos mais recentes.
const segmentosDoSaldo = async (clienteId, session) => {
  const movimentos = await NatalMovimentoCupom.find({ campanha: CAMPANHA, clienteId })
    .sort({ em: 1, _id: 1 }).session(session || null).lean();
  const segmentos = [];
  for (const movimento of movimentos) {
    if (movimento.quantidade > 0) {
      segmentos.push({ movimento, restante: movimento.quantidade });
      continue;
    }
    let retirar = -movimento.quantidade;
    for (let indice = segmentos.length - 1; indice >= 0 && retirar > 0; indice -= 1) {
      const parte = Math.min(segmentos[indice].restante, retirar);
      segmentos[indice].restante -= parte;
      retirar -= parte;
    }
  }
  return segmentos.filter((segmento) => segmento.restante > 0);
};

const descreverMovimento = (movimento) => ({
  movimentoId: movimento._id,
  tipo: movimento.tipo,
  pedidoId: movimento.origem?.pedidoId,
  numeroPedido: movimento.origem?.numeroPedido,
  loteId: movimento.origem?.loteId,
  compraExternaId: movimento.origem?.compraExternaId,
  referencia: movimento.origem?.numeroPedido || movimento.origem?.referencia || movimento.motivo?.slice(0, 120),
});

// Origem calculada de cada posição do saldo (posicaoInicial = primeira posição livre).
// É um retrato do momento da emissão: serve para auditoria e não muda a regra de
// cancelamento, que segue a revisão administrativa.
export const calcularOrigensSaldo = async ({ clienteId, posicaoInicial, quantidade, loteLink, now, session }) => {
  const segmentos = await segmentosDoSaldo(clienteId, session);
  const origens = [];
  let indice = 0;
  let acumulado = 0;
  for (let posicao = posicaoInicial; posicao < posicaoInicial + quantidade; posicao += 1) {
    while (indice < segmentos.length && acumulado + segmentos[indice].restante < posicao) {
      acumulado += segmentos[indice].restante;
      indice += 1;
    }
    const segmento = segmentos[indice];
    if (segmento) origens.push({ ...descreverMovimento(segmento.movimento), posicao, calculadaEm: now });
    else if (loteLink) {
      origens.push({ tipo: "lote", loteId: loteLink._id, pedidoId: loteLink.pedidoId, numeroPedido: loteLink.numeroPedido, referencia: loteLink.numeroPedido, posicao, calculadaEm: now });
    } else origens.push({ tipo: "nao_identificada", posicao, calculadaEm: now });
  }
  return origens;
};

const resumirOrigens = (origens) => {
  const mapa = new Map();
  for (const origem of origens) {
    const chave = `${origem.tipo}:${origem.movimentoId || origem.loteId || "-"}`;
    const atual = mapa.get(chave) || { tipo: origem.tipo, referencia: origem.referencia, movimentoId: origem.movimentoId, quantidade: 0 };
    atual.quantidade += 1;
    mapa.set(chave, atual);
  }
  return [...mapa.values()];
};

// ---------- Saldo ----------

// Onde o saldo deste envio é controlado: na conta (modelo ativo ou link próprio) ou
// no lote antigo (modelo legado). O outro registro acompanha os contadores.
export const fonteDeSaldo = ({ conta, lote, modo }) => {
  const naConta = Boolean(conta && (modo === "ativo" || !lote));
  return naConta
    ? { Model: NatalConta, id: conta._id, campoTotal: "cupons.total", naConta, contaId: conta._id, loteId: lote?._id }
    : { Model: NatalLote, id: lote._id, campoTotal: "cuponsConcedidos", naConta, contaId: conta?._id, loteId: lote._id };
};

const lerTotal = (doc, campoTotal) => Number(campoTotal === "cupons.total" ? doc?.cupons?.total : doc?.cuponsConcedidos) || 0;

export const lerSaldoDoc = (doc, campoTotal) => {
  const total = lerTotal(doc, campoTotal);
  const aprovados = Number(doc?.contadores?.aprovados || 0);
  const pendentes = Number(doc?.contadores?.pendentes || 0);
  return { total, aprovados, pendentes, disponivel: Math.max(total - aprovados - pendentes, 0) };
};

// Incrementos nos contadores do saldo e do registro espelho (conta ou link antigo).
const incrementarSaldo = async ({ fonte, loteIdEspelho, incrementos, condicao, session }) => {
  const inc = Object.fromEntries(Object.entries(incrementos).map(([campo, valor]) => [`contadores.${campo}`, valor]));
  const resultado = await fonte.Model.updateOne({ _id: fonte.id, ...(condicao || {}) }, { $inc: inc }, { session });
  if (condicao && !resultado.modifiedCount) throw new RepetirTransacaoNatal();
  if (fonte.naConta) {
    const loteId = loteIdEspelho;
    if (loteId) await NatalLote.updateOne({ _id: loteId }, { $inc: inc }, { session });
  } else if (fonte.contaId) {
    await NatalConta.updateOne({ _id: fonte.contaId }, { $inc: inc }, { session });
  }
};

// Reserva estrita: só grava se o saldo lido continua igual (conflito repete a transação).
export const reservarSaldo = async ({ fonte, quantidade, loteIdEspelho, session }) => {
  const atual = await fonte.Model.findById(fonte.id).session(session);
  if (!atual) throw new NatalError(404, "Saldo do distribuidor não encontrado.", "nao_encontrado");
  if (fonte.Model === NatalLote && atual.status !== "ativo") throw new NatalError(409, "Este link não está mais ativo.", "lote_invalidado");
  const saldo = lerSaldoDoc(atual, fonte.campoTotal);
  if (quantidade > saldo.disponivel) {
    const erro = new NatalError(
      409,
      saldo.disponivel > 0
        ? `Saldo insuficiente: o distribuidor tem ${saldo.disponivel} cupom(ns) disponível(is).`
        : "O distribuidor está sem cupons disponíveis no momento.",
      "saldo_insuficiente"
    );
    erro.errors = { quantidade: erro.message };
    erro.detalhes = { disponivel: saldo.disponivel };
    throw erro;
  }
  await incrementarSaldo({
    fonte,
    loteIdEspelho,
    incrementos: { pendentes: quantidade },
    condicao: { [fonte.campoTotal]: saldo.total, "contadores.aprovados": saldo.aprovados, "contadores.pendentes": saldo.pendentes },
    session,
  });
  return saldo;
};

// ---------- Cadastros antigos ----------

const CUPONS_VAZIOS = () => ({ total: 0, pendentes: 0, validos: 0, rejeitados: 0, cancelados: 0, invalidados: 0 });

const STATUS_DISTRIBUICAO_LEGADA = Object.freeze({
  pendente: "pendente",
  aprovado: "aprovado",
  rejeitado: "rejeitado",
  cancelado: "cancelado",
  invalidado_pedido: "invalidado",
  invalidado_revisao: "invalidado",
});

// Converte um cadastro anterior aos múltiplos cupons (1 cupom) para a estrutura nova,
// sem alterar número, status, datas ou comprovante: cria o lote histórico de 1 cupom
// e associa o cupom já emitido. Idempotente (chave "legado:<cadastro>").
export const garantirDistribuicaoLegada = async ({ participacao, session, now = new Date(), autor }) => {
  if (participacao.cupons) return { participacao, criada: false };
  const chave = `legado-${participacao._id}`;
  let distribuicao = await NatalDistribuicao.findOne({ campanha: CAMPANHA, clienteId: participacao.clienteId, chaveIdempotencia: chave }).session(session);
  const cupom = await NatalCupom.findOne({ participacaoId: participacao._id }).session(session).lean();
  const cupons = CUPONS_VAZIOS();
  cupons.total = 1;
  const statusCupom = cupom?.status;
  if (statusCupom === "valido") cupons.validos = 1;
  else if (statusCupom === "cancelado") cupons.cancelados = 1;
  else if (statusCupom === "invalidado") cupons.invalidados = 1;
  else if (participacao.status === "pendente") cupons.pendentes = 1;
  else if (participacao.status === "rejeitado") cupons.rejeitados = 1;
  else cupons.cancelados = 1;

  if (!distribuicao) {
    [distribuicao] = await NatalDistribuicao.create([{
      clienteId: participacao.clienteId,
      participacaoId: participacao._id,
      loteId: participacao.loteId,
      protocolo: participacao.protocolo,
      distribuidorNome: participacao.distribuidorNome,
      vendedorNome: participacao.vendedorNome,
      tipo: "legado",
      canal: "migracao",
      quantidade: 1,
      status: STATUS_DISTRIBUICAO_LEGADA[participacao.status] || "pendente",
      recebidoEm: participacao.recebidoEm,
      chaveIdempotencia: chave,
      compra: participacao.compra,
      comprovante: participacao.comprovante,
      contadores: {
        pendentes: cupons.pendentes,
        validos: cupons.validos,
        rejeitados: cupons.rejeitados,
        cancelados: cupons.cancelados,
        invalidados: cupons.invalidados,
      },
      decisao: participacao.decisao,
      criadoPor: autor || { usuarioTipo: "sistema", usuarioNome: "Migração múltiplos cupons" },
      historico: [{
        acao: "migrado",
        em: now,
        autor: autor || { usuarioTipo: "sistema", usuarioNome: "Migração múltiplos cupons" },
        detalhes: cupom ? `Cadastro de 1 cupom (${cupom.codigo}) anterior aos múltiplos cupons` : "Cadastro de 1 cupom anterior aos múltiplos cupons",
      }],
    }], { session });
  }
  if (cupom && !cupom.distribuicaoId) {
    await NatalCupom.updateOne({ _id: cupom._id }, { $set: { distribuicaoId: distribuicao._id, recebidoEm: participacao.recebidoEm } }, { session });
  }
  const atualizada = await NatalParticipacao.findOneAndUpdate(
    { _id: participacao._id, cupons: { $exists: false } },
    { $set: { cupons } },
    { returnDocument: "after", session }
  );
  return { participacao: atualizada || await NatalParticipacao.findById(participacao._id).session(session), criada: true, distribuicao };
};

// ---------- Registro de um lote ----------

const resultadoDoLote = async (distribuicao, session) => {
  const [cupons, participacao] = await Promise.all([
    NatalCupom.find({ distribuicaoId: distribuicao._id }).select("numero codigo status").sort({ numero: 1 }).session(session || null).lean(),
    NatalParticipacao.findById(distribuicao.participacaoId).select("protocolo cupons status").session(session || null).lean(),
  ]);
  return { distribuicao, cupons, participacao };
};

const dadosCadastroDivergem = (petshop, dados) => ["nomeFantasia", "razaoSocial", "responsavel", "whatsapp", "instagram"]
  .some((campo) => dados[campo] !== undefined && String(petshop?.[campo] || "").toLowerCase() !== String(dados[campo]).toLowerCase());

// Grava um lote de N cupons numa transação já aberta. Quem chama resolve o link,
// o modo e o arquivo (já armazenado). Devolve { repetida, distribuicao }.
export const registrarLoteNaSessao = async ({
  session,
  clienteId,
  fonte,
  loteLink,
  quantidade,
  dados,
  comprovante,
  chave,
  canal,
  participacaoAlvoId,
  vincularPorDocumento,
  autor,
  distribuidorNome,
  origemRequisicao,
  alertas = [],
  config = NATAL_2026,
  now,
}) => {
  if (chave) {
    const existente = await NatalDistribuicao.findOne({ campanha: CAMPANHA, clienteId, chaveIdempotencia: chave }).session(session);
    if (existente) return { repetida: true, distribuicao: existente };
  }

  // 1. Cadastro: o indicado (painel), o ativo do mesmo documento (link público) ou um novo.
  let participacao = null;
  if (participacaoAlvoId) {
    participacao = await NatalParticipacao.findOne({ _id: participacaoAlvoId, clienteId }).session(session);
    if (!participacao) throw new NatalError(404, "Cadastro não encontrado.", "nao_encontrado");
  } else if (vincularPorDocumento) {
    participacao = await NatalParticipacao.findOne({ campanha: CAMPANHA, clienteId, chaveCadastro: dados.documento }).session(session);
  }
  if (participacao && !["pendente", "aprovado"].includes(participacao.status)) {
    throw new NatalError(409, "Este cadastro não aceita novos cupons (rejeitado, cancelado ou invalidado).", "cadastro_inativo");
  }
  if (participacao) ({ participacao } = await garantirDistribuicaoLegada({ participacao, session, now }));

  // 2. Reserva estrita do saldo.
  const saldo = await reservarSaldo({ fonte, quantidade, loteIdEspelho: loteLink?._id, session });

  const tipo = participacao ? "adicional" : "cadastro_inicial";
  if (!participacao) {
    [participacao] = await NatalParticipacao.create([{
      loteId: loteLink?._id,
      pedidoId: loteLink?.pedidoId,
      numeroPedido: loteLink?.numeroPedido,
      clienteId,
      distribuidorNome,
      protocolo: gerarProtocolo(),
      vendedorNome: dados.vendedorNome,
      petshop: {
        nomeFantasia: dados.nomeFantasia,
        razaoSocial: dados.razaoSocial,
        documento: dados.documento,
        tipoDocumento: dados.tipoDocumento,
        responsavel: dados.responsavel,
        whatsapp: dados.whatsapp,
        instagram: dados.instagram,
      },
      compra: { data: dados.dataCompra, valor: dados.valorCompra },
      comprovante,
      status: "pendente",
      ...(vincularPorDocumento ? { chaveCadastro: dados.documento } : {}),
      cupons: CUPONS_VAZIOS(),
      recebidoEm: now,
      origem: origemRequisicao,
      historico: [{ acao: "recebido", em: now, autor, detalhes: `Enviado por ${dados.vendedorNome}` }],
    }], { session });
  }

  // 3. Lote.
  const origens = await calcularOrigensSaldo({
    clienteId,
    posicaoInicial: saldo.aprovados + saldo.pendentes + 1,
    quantidade,
    loteLink: fonte.naConta ? null : loteLink,
    now,
    session,
  });
  const divergente = tipo === "adicional" && dados.nomeFantasia !== undefined && dadosCadastroDivergem(participacao.petshop, dados);
  const [distribuicao] = await NatalDistribuicao.create([{
    clienteId,
    participacaoId: participacao._id,
    loteId: loteLink?._id,
    protocolo: tipo === "cadastro_inicial" ? participacao.protocolo : gerarProtocolo(),
    distribuidorNome,
    vendedorNome: dados.vendedorNome,
    tipo,
    canal,
    quantidade,
    status: "pendente",
    recebidoEm: now,
    ...(chave ? { chaveIdempotencia: chave } : {}),
    compra: dados.dataCompra ? { data: dados.dataCompra, valor: dados.valorCompra } : undefined,
    comprovante,
    ...(tipo === "adicional" && dados.nomeFantasia !== undefined ? {
      dadosInformados: {
        nomeFantasia: dados.nomeFantasia,
        razaoSocial: dados.razaoSocial,
        responsavel: dados.responsavel,
        whatsapp: dados.whatsapp,
        instagram: dados.instagram,
        divergente,
      },
    } : {}),
    origensSaldo: resumirOrigens(origens),
    contadores: { pendentes: quantidade },
    origem: origemRequisicao,
    criadoPor: autor,
    historico: [{ acao: "recebido", em: now, autor, detalhes: `${quantidade} cupom(ns) enviado(s) por ${dados.vendedorNome}` }],
  }], { session });

  // 4. Cupons individuais, um por chance no sorteio.
  const numeros = await emitirNumerosLivres(quantidade, { config, session });
  await NatalCupom.insertMany(numeros.map((numero, indice) => ({
    campanha: CAMPANHA,
    numero,
    codigo: formatarNumeroCupom(numero, config.numeracao.digitos),
    participacaoId: participacao._id,
    distribuicaoId: distribuicao._id,
    loteId: loteLink?._id,
    pedidoId: loteLink?.pedidoId,
    clienteId,
    status: "pendente",
    emitidoEm: now,
    emitidoPor: autor,
    recebidoEm: now,
    origemSaldo: origens[indice],
  })), { session, ordered: true });

  // 5. Totais do cadastro e alertas.
  await NatalParticipacao.updateOne(
    { _id: participacao._id },
    {
      $inc: { "cupons.total": quantidade, "cupons.pendentes": quantidade },
      ...(tipo === "adicional" ? {
        $push: {
          historico: { acao: "lote_recebido", em: now, autor, detalhes: `Lote ${distribuicao.protocolo}: ${quantidade} cupom(ns)${divergente ? " — dados informados diferentes do cadastro" : ""}` },
        },
      } : {}),
    },
    { session }
  );
  // Alertas contra lotes anteriores do próprio cadastro ficam só nele (mesma compra
  // enviada duas vezes, por exemplo); os demais são registrados nos dois cadastros.
  const alertasProprios = alertas;
  const deOutros = alertas.filter((alerta) => String(alerta.participacaoId) !== String(participacao._id));
  if (alertasProprios.length > 0) {
    await NatalParticipacao.updateOne(
      { _id: participacao._id },
      { $push: { alertas: { $each: alertasProprios.map((alerta) => ({ ...alerta, distribuicaoId: distribuicao._id, detectadoEm: now })) } } },
      { session }
    );
    for (const alerta of deOutros) {
      await NatalParticipacao.updateOne(
        { _id: alerta.participacaoId },
        { $push: { alertas: { tipo: alerta.tipo, participacaoId: participacao._id, distribuicaoId: distribuicao._id, protocolo: participacao.protocolo, detectadoEm: now } } },
        { session }
      );
    }
  }

  await NatalAuditoria.create([{
    acao: tipo === "cadastro_inicial" ? "participacao_recebida" : "distribuicao_recebida",
    em: now,
    autor,
    clienteId,
    loteId: loteLink?._id,
    pedidoId: loteLink?.pedidoId,
    participacaoId: participacao._id,
    detalhes: {
      protocolo: participacao.protocolo,
      distribuicao: distribuicao.protocolo,
      distribuicaoId: distribuicao._id,
      quantidade,
      canal,
      saldoAntes: saldo.disponivel,
      saldoDepois: saldo.disponivel - quantidade,
      alertas: alertasProprios.length,
      dadosDivergentes: divergente || undefined,
    },
  }], { session });

  return { repetida: false, distribuicao };
};

export const montarResultadoLote = resultadoDoLote;

// ---------- Validação, rejeição e cancelamento de lotes ----------

const aplicarContadoresCadastro = (incrementos) => Object.fromEntries(
  Object.entries(incrementos).filter(([, valor]) => valor).map(([campo, valor]) => [`cupons.${campo}`, valor])
);

// Torna válidos os cupons de lotes pendentes. Emite os números que faltam nos lotes
// antigos (1 cupom aprovado só agora). Converte reserva em uso: pendentes -> aprovados.
export const aprovarLotesNaSessao = async ({ distribuicoes, participacao, fonte, autor, motivo, config = NATAL_2026, now, session }) => {
  if (distribuicoes.length === 0) return { unidades: 0, numerosEmitidos: [] };
  const unidades = distribuicoes.reduce((soma, item) => soma + Number(item.quantidade), 0);
  const atual = await fonte.Model.findById(fonte.id).session(session);
  const saldo = lerSaldoDoc(atual, fonte.campoTotal);
  if (saldo.aprovados + unidades > saldo.total) {
    throw new NatalError(409, "Não há saldo disponível para validar estes cupons. Verifique a revisão de benefícios do distribuidor.", "sem_saldo");
  }
  const numerosEmitidos = [];
  for (const distribuicao of distribuicoes) {
    const aprovada = await NatalDistribuicao.findOneAndUpdate(
      { _id: distribuicao._id, status: "pendente" },
      {
        $set: { status: "aprovado", decisao: { em: now, autor, motivo }, "contadores.pendentes": 0, "contadores.validos": distribuicao.quantidade },
        $push: { historico: { acao: "aprovado", em: now, autor, motivo } },
      },
      { returnDocument: "after", session }
    );
    if (!aprovada) throw new NatalError(409, "Este lote foi analisado por outra pessoa. Atualize a lista.", "concorrencia");
    const pendentes = await NatalCupom.updateMany(
      { distribuicaoId: distribuicao._id, status: "pendente" },
      { $set: { status: "valido", validadoEm: now, validadoPor: autor } },
      { session }
    );
    const emitidos = await NatalCupom.countDocuments({ distribuicaoId: distribuicao._id }).session(session);
    const faltam = Number(distribuicao.quantidade) - emitidos;
    if (pendentes.modifiedCount + Math.max(faltam, 0) !== Number(distribuicao.quantidade)) {
      throw new NatalError(409, "Os cupons deste lote mudaram durante a validação. Atualize e tente novamente.", "concorrencia");
    }
    if (faltam > 0) {
      const numeros = await emitirNumerosLivres(faltam, { config, session });
      const origens = await calcularOrigensSaldo({
        clienteId: participacao.clienteId, posicaoInicial: saldo.aprovados + 1, quantidade: faltam, now, session,
      });
      await NatalCupom.insertMany(numeros.map((numero, indice) => ({
        campanha: CAMPANHA,
        numero,
        codigo: formatarNumeroCupom(numero, config.numeracao.digitos),
        participacaoId: participacao._id,
        distribuicaoId: distribuicao._id,
        loteId: distribuicao.loteId,
        pedidoId: participacao.pedidoId,
        clienteId: participacao.clienteId,
        status: "valido",
        emitidoEm: now,
        emitidoPor: autor,
        recebidoEm: distribuicao.recebidoEm,
        validadoEm: now,
        validadoPor: autor,
        origemSaldo: origens[indice],
      })), { session, ordered: true });
      numerosEmitidos.push(...numeros);
    }
  }
  await incrementarSaldo({
    fonte,
    loteIdEspelho: undefined,
    incrementos: { aprovados: unidades, pendentes: -unidades },
    condicao: { [fonte.campoTotal]: saldo.total, "contadores.aprovados": saldo.aprovados },
    session,
  });
  // Cada link antigo acompanha os cupons enviados por ele.
  if (fonte.naConta) {
    for (const distribuicao of distribuicoes) {
      const loteId = distribuicao.loteId;
      if (!loteId) continue;
      await NatalLote.updateOne({ _id: loteId }, { $inc: { "contadores.aprovados": distribuicao.quantidade, "contadores.pendentes": -distribuicao.quantidade } }, { session });
    }
  }
  await NatalParticipacao.updateOne(
    { _id: participacao._id },
    { $inc: aplicarContadoresCadastro({ pendentes: -unidades, validos: unidades }) },
    { session }
  );
  return { unidades, numerosEmitidos };
};

// Encerra lotes (rejeição ou cancelamento). Cupons pendentes ou válidos deixam de
// valer e o saldo correspondente volta ao distribuidor. Invalidados por revisão não
// voltam: já saíram do saldo na adequação. Condicional ao status: nunca devolve duas vezes.
export const encerrarLotesNaSessao = async ({ distribuicoes, participacao, fonte, statusFinal, motivo, autor, now, session }) => {
  const statusCupom = statusFinal === "rejeitado" ? "rejeitado" : "cancelado";
  const totais = { pendentes: 0, validos: 0 };
  const espelhos = new Map();
  for (const distribuicao of distribuicoes) {
    const statusAnterior = distribuicao.status;
    const [pendentesCupons, validosCupons] = await Promise.all([
      NatalCupom.countDocuments({ distribuicaoId: distribuicao._id, status: "pendente" }).session(session),
      NatalCupom.countDocuments({ distribuicaoId: distribuicao._id, status: "valido" }).session(session),
    ]);
    const emitidos = await NatalCupom.countDocuments({ distribuicaoId: distribuicao._id }).session(session);
    // Lote antigo pendente ainda sem número: a reserva de 1 unidade também volta.
    const semNumero = statusAnterior === "pendente" ? Math.max(Number(distribuicao.quantidade) - emitidos, 0) : 0;
    const pendentes = pendentesCupons + semNumero;
    const encerrada = await NatalDistribuicao.findOneAndUpdate(
      { _id: distribuicao._id, status: statusAnterior },
      {
        $set: {
          status: statusFinal,
          "contadores.pendentes": 0,
          "contadores.validos": 0,
          ...(statusFinal === "rejeitado"
            ? { decisao: { em: now, autor, motivo }, "contadores.rejeitados": Number(distribuicao.contadores?.rejeitados || 0) + pendentes + validosCupons }
            : {
              cancelamento: { em: now, motivo, autor, statusAnterior, cuponsDevolvidos: pendentes + validosCupons },
              "contadores.cancelados": Number(distribuicao.contadores?.cancelados || 0) + pendentes + validosCupons,
            }),
        },
        $push: { historico: { acao: statusFinal === "rejeitado" ? "rejeitado" : "cancelado", em: now, autor, motivo } },
      },
      { returnDocument: "after", session }
    );
    if (!encerrada) throw new NatalError(409, "Este lote foi alterado por outra pessoa. Atualize a lista.", "concorrencia");
    const cupons = await NatalCupom.updateMany(
      { distribuicaoId: distribuicao._id, status: { $in: ["pendente", "valido"] } },
      { $set: { status: statusCupom, encerradoEm: now, motivoEncerramento: motivo, encerradoPor: autor } },
      { session }
    );
    if (cupons.modifiedCount !== pendentesCupons + validosCupons) {
      throw new NatalError(409, "Os cupons deste lote mudaram durante a operação. Tente novamente.", "concorrencia");
    }
    totais.pendentes += pendentes;
    totais.validos += validosCupons;
    const loteId = String(distribuicao.loteId || "");
    if (loteId) {
      const atual = espelhos.get(loteId) || { pendentes: 0, validos: 0 };
      atual.pendentes += pendentes;
      atual.validos += validosCupons;
      espelhos.set(loteId, atual);
    }
  }
  const devolvidos = totais.pendentes + totais.validos;
  const campoEncerrado = statusCupom === "rejeitado" ? "rejeitados" : "cancelados";
  if (devolvidos > 0) {
    const inc = { "contadores.pendentes": -totais.pendentes, "contadores.aprovados": -totais.validos, [`contadores.${campoEncerrado}`]: devolvidos };
    await fonte.Model.updateOne({ _id: fonte.id }, { $inc: inc }, { session });
    if (fonte.naConta) {
      for (const [loteId, parcial] of espelhos) {
        await NatalLote.updateOne({ _id: loteId }, {
          $inc: { "contadores.pendentes": -parcial.pendentes, "contadores.aprovados": -parcial.validos, [`contadores.${campoEncerrado}`]: parcial.pendentes + parcial.validos },
        }, { session });
      }
    } else if (fonte.contaId) {
      await NatalConta.updateOne({ _id: fonte.contaId }, { $inc: inc }, { session });
    }
  }
  await NatalParticipacao.updateOne(
    { _id: participacao._id },
    { $inc: aplicarContadoresCadastro({ pendentes: -totais.pendentes, validos: -totais.validos, [campoEncerrado]: devolvidos }) },
    { session }
  );
  return { devolvidos, pendentes: totais.pendentes, validos: totais.validos };
};

// ---------- Leitura ----------

export const serializarDistribuicao = (distribuicao, { gestor = false, cupons } = {}) => ({
  _id: distribuicao._id,
  protocolo: distribuicao.protocolo,
  participacaoId: distribuicao.participacaoId,
  tipo: distribuicao.tipo,
  canal: distribuicao.canal,
  quantidade: distribuicao.quantidade,
  status: distribuicao.status,
  vendedorNome: distribuicao.vendedorNome,
  recebidoEm: distribuicao.recebidoEm,
  compra: distribuicao.compra,
  possuiComprovante: Boolean(distribuicao.comprovante),
  contadores: distribuicao.contadores,
  origensSaldo: (distribuicao.origensSaldo || []).map((item) => ({ tipo: item.tipo, referencia: item.referencia, quantidade: item.quantidade })),
  decisao: distribuicao.decisao ? { em: distribuicao.decisao.em, motivo: distribuicao.decisao.motivo, autorNome: distribuicao.decisao.autor?.usuarioNome } : undefined,
  cancelamento: distribuicao.cancelamento ? {
    em: distribuicao.cancelamento.em,
    motivo: distribuicao.cancelamento.motivo,
    statusAnterior: distribuicao.cancelamento.statusAnterior,
    cuponsDevolvidos: distribuicao.cancelamento.cuponsDevolvidos,
    autorNome: distribuicao.cancelamento.autor?.usuarioNome,
  } : undefined,
  ...(gestor ? { dadosInformados: distribuicao.dadosInformados } : {}),
  historico: (distribuicao.historico || []).map((evento) => ({
    acao: evento.acao, em: evento.em, motivo: evento.motivo, detalhes: evento.detalhes, autorNome: evento.autor?.usuarioNome,
  })),
  ...(cupons ? {
    cupons: cupons.map((cupom) => ({
      numero: cupom.numero,
      codigo: cupom.codigo,
      status: cupom.status,
      emitidoEm: cupom.emitidoEm,
      validadoEm: cupom.validadoEm,
      encerradoEm: cupom.encerradoEm,
      motivoEncerramento: gestor ? cupom.motivoEncerramento : undefined,
      origem: cupom.origemSaldo ? { tipo: cupom.origemSaldo.tipo, referencia: cupom.origemSaldo.referencia } : undefined,
    })),
  } : {}),
});

// Lotes e cupons de um cadastro. Cadastros antigos sem lote aparecem com o lote
// histórico virtual de 1 cupom (nada é gravado numa consulta).
export const listarLotesDoCadastro = async (participacao, { gestor = false } = {}) => {
  const [distribuicoes, cupons] = await Promise.all([
    NatalDistribuicao.find({ participacaoId: participacao._id }).sort({ recebidoEm: 1, _id: 1 }).lean(),
    NatalCupom.find({ participacaoId: participacao._id }).sort({ numero: 1 }).lean(),
  ]);
  const porLote = new Map();
  const semLote = [];
  for (const cupom of cupons) {
    if (cupom.distribuicaoId) {
      const lista = porLote.get(String(cupom.distribuicaoId)) || [];
      lista.push(cupom);
      porLote.set(String(cupom.distribuicaoId), lista);
    } else semLote.push(cupom);
  }
  const lotes = distribuicoes.map((item) => serializarDistribuicao(item, { gestor, cupons: porLote.get(String(item._id)) || [] }));
  if (distribuicoes.length === 0) {
    lotes.push(serializarDistribuicao({
      _id: null,
      protocolo: participacao.protocolo,
      participacaoId: participacao._id,
      tipo: "legado",
      canal: "migracao",
      quantidade: 1,
      status: STATUS_DISTRIBUICAO_LEGADA[participacao.status] || "pendente",
      vendedorNome: participacao.vendedorNome,
      recebidoEm: participacao.recebidoEm,
      compra: participacao.compra,
      comprovante: participacao.comprovante,
      decisao: participacao.decisao,
    }, { gestor, cupons: semLote }));
  }
  return lotes;
};

// Resumo de cupons de um cadastro (antigos sem contadores: deduzido do cupom único).
export const resumoCuponsCadastro = (participacao) => {
  if (participacao.cupons) return { ...CUPONS_VAZIOS(), ...participacao.cupons };
  const resumo = CUPONS_VAZIOS();
  resumo.total = 1;
  if (participacao.status === "aprovado") resumo.validos = 1;
  else if (participacao.status === "pendente") resumo.pendentes = 1;
  else if (participacao.status === "rejeitado") resumo.rejeitados = 1;
  else if (participacao.status === "cancelado") resumo.cancelados = 1;
  else resumo.invalidados = 1;
  return resumo;
};

export const objectId = (valor) => new mongoose.Types.ObjectId(String(valor));
