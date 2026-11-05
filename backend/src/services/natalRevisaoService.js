import { NATAL_2026 } from "../config/natalPremiado2026.js";
import NatalAuditoria from "../models/NatalAuditoria.js";
import NatalBonificacao from "../models/NatalBonificacao.js";
import NatalConta from "../models/NatalConta.js";
import NatalCupom from "../models/NatalCupom.js";
import NatalLote from "../models/NatalLote.js";
import NatalMovimentoCupom from "../models/NatalMovimentoCupom.js";
import NatalParticipacao from "../models/NatalParticipacao.js";
import { buildAutorNatal } from "../models/natalSchemas.js";
import { formatarNumeroCupom, isGestorCampanha } from "../utils/natalCampanha.js";
import { calcularEstadoCumulativo, paraCentavos, paraReais } from "../utils/natalCumulativo.js";
import {
  exigirCumulativoAtivo,
  executarTransacaoNatal,
  NatalError,
  obterEstadoCampanha,
  obterModoCumulativo,
} from "./natalBaseService.js";
import {
  avaliarExcesso,
  coletarCompras,
  cuponsAutomaticos,
  garantirConta,
  recalcularConta,
  somarCentavos,
} from "./natalContaService.js";

// Revisão dos benefícios do distribuidor quando uma redução ou um cancelamento atinge
// o que já foi concedido. A decisão (manter ou adequar) é sempre administrativa. Na
// edição do pedido ela é aplicada na mesma transação que grava a alteração.

export const DECISOES_REVISAO = Object.freeze(["manter", "adequar"]);
const LIMITE_PREVIA_EXCEDENTES = 100;
const CAMPANHA = NATAL_2026.slug;

export const validarDecisaoRevisao = (entrada, usuario) => {
  if (!isGestorCampanha(usuario)) {
    throw new NatalError(403, "Somente o Comercial ou o Administrador revisam os benefícios da campanha.", "sem_permissao");
  }
  const decisao = entrada?.decisao;
  const justificativa = typeof entrada?.justificativa === "string" ? entrada.justificativa.trim() : "";
  if (!DECISOES_REVISAO.includes(decisao)) {
    throw new NatalError(400, "Informe a decisão: manter os benefícios ou adequá-los ao novo valor.", "decisao_invalida");
  }
  if (justificativa.length < 10 || justificativa.length > 1000) {
    throw new NatalError(400, "Informe a justificativa administrativa (10 a 1000 caracteres).", "justificativa_invalida");
  }
  const cuponsEsperados = entrada?.cuponsEsperados;
  return {
    decisao,
    justificativa,
    cuponsEsperados: Number.isInteger(Number(cuponsEsperados)) && cuponsEsperados !== null ? Number(cuponsEsperados) : undefined,
  };
};

// No limite de um ciclo o ciclo seguinte ainda está vazio: vale a faixa do último com valor.
const descreverBeneficios = (estado, cupons) => ({ ...(estado.ciclos.at(-1)?.faixa || estado.faixaAtual), cupons });

// Participações aprovadas na ordem do cadastro original (recebimento), em todos os
// links do distribuidor; empate é resolvido pelo identificador, estável e único.
const aprovadasPorAntiguidade = (clienteId, session) => NatalParticipacao.find({ clienteId, status: "aprovado" })
  .select("_id protocolo recebidoEm cupom petshop.nomeFantasia loteId pedidoId")
  .sort({ recebidoEm: 1, _id: 1 })
  .session(session || null)
  .lean();

const limiteAdequado = (conta, estado) => {
  const automatico = Math.min(cuponsAutomaticos(conta), estado.cuponsDevidos);
  return { automatico, total: Math.max(automatico + Number(conta.cupons?.ajustes || 0), 0) };
};

const resumirBonificacoes = async (clienteId, estado, session) => {
  const docs = await NatalBonificacao.find({ campanha: CAMPANHA, clienteId }).select("tipo valorConcedido valorEntregue").session(session || null).lean();
  const somar = (tipo, campo) => docs.filter((doc) => doc.tipo === tipo).reduce((soma, doc) => soma + paraCentavos(doc[campo]), 0);
  const montar = (tipo, devido) => ({
    concedido: paraReais(somar(tipo, "valorConcedido")),
    entregue: paraReais(somar(tipo, "valorEntregue")),
    devidoDepois: paraReais(devido),
  });
  return { produtos: montar("produtos", estado.produtosDevidoCentavos), marketing: montar("marketing", estado.marketingDevidoCentavos) };
};

// Fotografia do impacto das duas decisões. Compartilhada pela edição do pedido
// (resposta 409) e pela revisão pendente aberta na gestão.
const montarPrevia = async ({ conta, estadoAntes, estadoDepois, valorAnterior, valorNovo, numeroPedido, session }) => {
  const clienteId = conta.clienteId;
  const [aprovadas, pendentes, bonificacoes] = await Promise.all([
    aprovadasPorAntiguidade(clienteId, session),
    NatalParticipacao.countDocuments({ clienteId, status: "pendente" }).session(session || null),
    resumirBonificacoes(clienteId, estadoDepois, session),
  ]);
  const totalAtual = Number(conta.cupons.total);
  const limite = limiteAdequado(conta, estadoDepois);
  const excedentes = aprovadas.slice(limite.total);
  const restantes = aprovadas.length - excedentes.length;
  return {
    clienteId,
    numeroPedido,
    distribuidorNome: conta.distribuidorNome,
    valorAnterior: Number(valorAnterior),
    valorNovo: Number(valorNovo),
    beneficiosAtuais: descreverBeneficios(estadoAntes, totalAtual),
    beneficiosDoNovoValor: descreverBeneficios(estadoDepois, Math.max(estadoDepois.cuponsDevidos + Number(conta.cupons.ajustes || 0), 0)),
    bonificacoes,
    cuponsEsperados: totalAtual,
    aprovadas: aprovadas.length,
    pendentes,
    impactoManter: { cupons: totalAtual, saldoDisponivel: Math.max(totalAtual - aprovadas.length, 0), invalidadas: 0 },
    impactoAdequar: {
      cupons: limite.total,
      saldoDisponivel: Math.max(limite.total - restantes, 0),
      invalidadas: excedentes.length,
      pendentesSemSaldo: limite.total - restantes <= 0 ? pendentes : 0,
      participacoes: excedentes.slice(0, LIMITE_PREVIA_EXCEDENTES).map((item) => ({
        protocolo: item.protocolo,
        petshop: item.petshop?.nomeFantasia,
        recebidoEm: item.recebidoEm,
        cupom: item.cupom?.codigo,
      })),
    },
  };
};

// Diz se reduzir este pedido atinge benefícios concedidos. Pedidos que não contam
// para o acumulado reduzem livremente, sem revisão.
export const avaliarReducaoPedido = async ({ pedido, valorNovo }) => {
  const reducao = paraCentavos(pedido.valorTotal) - paraCentavos(valorNovo);
  if (reducao <= 0) return { exige: false };
  if (await obterModoCumulativo() !== "ativo") return { exige: false };
  const clienteId = pedido.clienteId;
  const possuiCadastro = await NatalConta.exists({ campanha: CAMPANHA, clienteId }) || await NatalLote.exists({ pedidoId: pedido._id });
  if (!possuiCadastro) return { exige: false };

  const conta = await garantirConta({ clienteId });
  const compras = await coletarCompras(clienteId);
  if (!compras.some((compra) => compra.id === String(pedido._id))) return { exige: false };

  const totalCompras = somarCentavos(compras);
  const estadoDepois = calcularEstadoCumulativo(totalCompras - reducao);

  const { exigeDecisao } = await avaliarExcesso({ conta, clienteId, estado: estadoDepois });
  if (!exigeDecisao) return { exige: false };

  return {
    exige: true,
    previa: await montarPrevia({
      conta,
      estadoAntes: calcularEstadoCumulativo(totalCompras),
      estadoDepois,
      valorAnterior: pedido.valorTotal,
      valorNovo,
      numeroPedido: pedido.numeroPedido,
    }),
  };
};

export const previaRevisaoPendente = async ({ clienteId }) => {
  const conta = await NatalConta.findOne({ campanha: CAMPANHA, clienteId });
  if (!conta?.revisaoPendente) throw new NatalError(404, "Este distribuidor não possui revisão pendente.", "sem_revisao_pendente");
  const estadoDepois = calcularEstadoCumulativo(somarCentavos(await coletarCompras(clienteId)));
  return montarPrevia({
    conta,
    estadoAntes: calcularEstadoCumulativo(paraCentavos(conta.revisaoPendente.valorAnterior)),
    estadoDepois,
    valorAnterior: conta.revisaoPendente.valorAnterior,
    valorNovo: conta.revisaoPendente.valorNovo,
    numeroPedido: conta.revisaoPendente.numeroPedido,
  });
};

const adequarBonificacoes = async ({ clienteId, estado, autor, justificativa, now, session }) => {
  const docs = await NatalBonificacao.find({ campanha: CAMPANHA, clienteId }).session(session);
  const ciclos = new Map(estado.ciclos.map((ciclo) => [ciclo.numero, ciclo]));
  let entregueAcimaDoDevido = false;
  for (const doc of docs) {
    const devido = ciclos.get(doc.ciclo)?.[doc.tipo].devidoCentavos || 0;
    const concedido = paraCentavos(doc.valorConcedido);
    const entregue = paraCentavos(doc.valorEntregue);
    if (entregue > devido) entregueAcimaDoDevido = true;
    if (concedido <= devido) continue;
    doc.valorDevido = paraReais(devido);
    doc.valorConcedido = paraReais(devido);
    doc.saldoPendente = paraReais(devido - entregue);
    doc.historico.push({
      em: now,
      tipo: "adequacao",
      valorDevido: paraReais(devido),
      valorAnterior: paraReais(concedido),
      complemento: paraReais(devido - concedido),
      valorEntregue: paraReais(entregue),
      observacao: justificativa.slice(0, 500),
      autor,
    });
    await doc.save({ session });
  }
  return entregueAcimaDoDevido;
};

// Aplica a decisão dentro da transação informada. As compras já refletem o pedido
// gravado na mesma transação; atualizações condicionais impedem decisão repetida.
export const aplicarRevisaoBeneficios = async ({
  clienteId,
  pedidoRef,
  valorAnterior,
  valorNovo,
  decisao,
  justificativa,
  cuponsEsperados,
  usuario,
  session,
  now = new Date(),
}) => {
  const autor = buildAutorNatal(usuario);
  const conta = await NatalConta.findOne({ campanha: CAMPANHA, clienteId }).session(session);
  if (!conta) throw new NatalError(404, "Distribuidor sem conta na campanha.", "nao_encontrado");
  const totalAtual = Number(conta.cupons.total);
  if (cuponsEsperados !== undefined && cuponsEsperados !== totalAtual) {
    throw new NatalError(409, "Os benefícios deste distribuidor mudaram durante a edição. Reabra e revise novamente.", "revisao_desatualizada");
  }

  const totalCompras = somarCentavos(await coletarCompras(clienteId, { session }));
  const estado = calcularEstadoCumulativo(totalCompras);
  const automatico = cuponsAutomaticos(conta);
  const limite = limiteAdequado(conta, estado);
  const adequar = decisao === "adequar";
  const reducao = adequar ? automatico - limite.automatico : 0;
  const totalResultante = totalAtual - reducao;

  const beneficioAtual = descreverBeneficios(calcularEstadoCumulativo(paraCentavos(valorAnterior)), totalAtual);
  const beneficioNovo = descreverBeneficios(estado, Math.max(estado.cuponsDevidos + Number(conta.cupons.ajustes || 0), 0));
  const resultante = adequar ? beneficioNovo : beneficioAtual;
  resultante.cupons = Math.max(totalResultante, 0);

  const pendentes = await NatalParticipacao.countDocuments({ clienteId, status: "pendente" }).session(session);
  const aprovadas = await aprovadasPorAntiguidade(clienteId, session);
  const excedentes = adequar ? aprovadas.slice(Math.max(totalResultante, 0)) : [];
  const revisaoId = new NatalConta.base.Types.ObjectId();
  const motivo = `Revisão de benefícios de ${conta.distribuidorNome || "distribuidor"}: limite reduzido de ${totalAtual} para ${totalResultante} cupons`;

  if (excedentes.length > 0) {
    const ids = excedentes.map((item) => item._id);
    const participacoes = await NatalParticipacao.updateMany(
      { _id: { $in: ids }, clienteId, status: "aprovado" },
      {
        $set: {
          status: "invalidado_revisao",
          invalidacao: { em: now, motivo: motivo.slice(0, 300), statusAnterior: "aprovado", tipo: "revisao_faixa", revisaoId },
        },
        $push: { historico: { acao: "invalidado_revisao", em: now, autor, motivo: justificativa.slice(0, 500), detalhes: motivo.slice(0, 500) } },
      },
      { session }
    );
    if (participacoes.modifiedCount !== ids.length) {
      throw new NatalError(409, "As participações deste distribuidor mudaram durante a revisão. Tente novamente.", "concorrencia");
    }
    await NatalCupom.updateMany(
      { participacaoId: { $in: ids }, status: "valido" },
      { $set: { status: "invalidado", encerradoEm: now, motivoEncerramento: motivo.slice(0, 500), revisaoId } },
      { session }
    );
    const porLote = new Map();
    for (const item of excedentes) {
      if (item.loteId) porLote.set(String(item.loteId), (porLote.get(String(item.loteId)) || 0) + 1);
    }
    for (const [loteId, quantidade] of porLote) {
      await NatalLote.updateOne(
        { _id: loteId },
        { $inc: { "contadores.aprovados": -quantidade, "contadores.invalidadosRevisao": quantidade } },
        { session }
      );
    }
  }

  const entregueAcimaDoDevido = adequar
    ? await adequarBonificacoes({ clienteId, estado, autor, justificativa, now, session })
    : false;

  const revisao = {
    _id: revisaoId,
    em: now,
    autor,
    decisao,
    justificativa,
    valorAnterior: Number(valorAnterior),
    valorNovo: Number(valorNovo),
    faixaAnterior: beneficioAtual,
    faixaDoNovoValor: beneficioNovo,
    faixaResultante: resultante,
    aprovadasAntes: aprovadas.length,
    pendentesNoMomento: pendentes,
    participacoesInvalidadas: excedentes.map((item) => ({
      participacaoId: item._id,
      protocolo: item.protocolo,
      cupomNumero: item.cupom?.numero,
      cupomCodigo: item.cupom?.codigo || (item.cupom?.numero ? formatarNumeroCupom(item.cupom.numero) : undefined),
      recebidoEm: item.recebidoEm,
    })),
    ajusteBonificacaoPendente: entregueAcimaDoDevido,
    pedidoId: pedidoRef?.pedidoId,
    numeroPedido: pedidoRef?.numeroPedido,
  };

  // Condicional ao saldo lido: duas revisões simultâneas não se sobrepõem.
  const atualizada = await NatalConta.findOneAndUpdate(
    { _id: conta._id, "cupons.total": totalAtual },
    {
      $set: adequar ? {} : { revisaoReferenciaCentavos: totalCompras },
      $unset: { revisaoPendente: 1, ...(adequar ? { revisaoReferenciaCentavos: 1 } : {}) },
      $inc: {
        "cupons.reduzidos": reducao,
        "cupons.total": -reducao,
        "contadores.aprovados": -excedentes.length,
        "contadores.invalidadosRevisao": excedentes.length,
        ...(adequar ? { geracao: 1 } : {}),
      },
      $push: { revisoes: revisao },
    },
    { returnDocument: "after", session, runValidators: true }
  );
  if (!atualizada) {
    throw new NatalError(409, "Os benefícios deste distribuidor foram alterados por outra pessoa. Reabra e revise novamente.", "revisao_desatualizada");
  }

  if (reducao > 0) {
    await NatalMovimentoCupom.create([{
      clienteId,
      chave: `revisao:${revisaoId}`,
      tipo: "revisao_adequacao",
      quantidade: -reducao,
      saldoTotalApos: totalResultante,
      motivo: justificativa.slice(0, 500),
      origem: { tipo: "revisao", pedidoId: pedidoRef?.pedidoId, numeroPedido: pedidoRef?.numeroPedido },
      em: now,
      autor,
    }], { session });
  }

  if (pedidoRef?.pedidoId) {
    await NatalLote.updateOne(
      { pedidoId: pedidoRef.pedidoId },
      {
        $set: { valorAtual: Number(valorNovo) },
        $push: {
          historicoFaixas: {
            em: now,
            tipo: decisao === "manter" ? "revisao_mantida" : "revisao_adequada",
            origem: "revisao",
            valorPedido: Number(valorNovo),
            valorAnterior: Number(valorAnterior),
            cuponsAnterior: totalAtual,
            cuponsNovo: totalResultante,
            acrescimo: totalResultante - totalAtual,
            autor,
          },
        },
      },
      { session }
    );
  }

  const estadoCampanha = await obterEstadoCampanha();
  const aposFechamento = Boolean(estadoCampanha.listaFechada);
  await NatalAuditoria.insertMany([{
    acao: "beneficios_revisados",
    em: now,
    autor,
    clienteId,
    pedidoId: pedidoRef?.pedidoId,
    aposFechamento,
    detalhes: {
      revisaoId,
      numeroPedido: pedidoRef?.numeroPedido,
      distribuidor: conta.distribuidorNome,
      decisao,
      justificativa,
      valorAnterior: Number(valorAnterior),
      valorNovo: Number(valorNovo),
      faixaAnterior: beneficioAtual,
      faixaDoNovoValor: beneficioNovo,
      faixaResultante: resultante,
      participacoesInvalidadas: revisao.participacoesInvalidadas.map((item) => item.protocolo),
      cuponsInvalidados: revisao.participacoesInvalidadas.map((item) => item.cupomCodigo),
      ajusteBonificacaoPendente: revisao.ajusteBonificacaoPendente,
    },
  }, ...excedentes.map((item) => ({
    acao: "participacao_invalidada_revisao",
    em: now,
    autor,
    clienteId,
    loteId: item.loteId,
    pedidoId: item.pedidoId,
    participacaoId: item._id,
    cupomNumero: item.cupom?.numero,
    aposFechamento,
    detalhes: { revisaoId, protocolo: item.protocolo, motivo },
  }))], { session });

  const recalculo = await recalcularConta({
    clienteId,
    usuario,
    origem: { tipo: "revisao", pedidoId: pedidoRef?.pedidoId, numeroPedido: pedidoRef?.numeroPedido },
    now,
    session,
  });

  return { conta: recalculo.conta, revisao, invalidadas: excedentes.length };
};

// Decisão sobre uma redução detectada fora da edição do pedido (cancelamento,
// exclusão, compra externa desfeita). A pendência fica aberta até esta decisão.
export const resolverRevisaoPendente = async ({ clienteId, entrada, usuario, now = new Date() }) => {
  const decisao = validarDecisaoRevisao(entrada, usuario);
  await exigirCumulativoAtivo();
  return executarTransacaoNatal(async (session) => {
    const conta = await NatalConta.findOne({ campanha: CAMPANHA, clienteId }).session(session);
    if (!conta?.revisaoPendente) throw new NatalError(409, "Este distribuidor não possui revisão pendente.", "sem_revisao_pendente");
    return aplicarRevisaoBeneficios({
      clienteId,
      pedidoRef: conta.revisaoPendente.numeroPedido ? { numeroPedido: conta.revisaoPendente.numeroPedido } : undefined,
      valorAnterior: conta.revisaoPendente.valorAnterior,
      valorNovo: conta.revisaoPendente.valorNovo,
      ...decisao,
      usuario,
      session,
      now,
    });
  });
};
