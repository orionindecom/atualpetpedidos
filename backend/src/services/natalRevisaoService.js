import NatalAuditoria from "../models/NatalAuditoria.js";
import NatalCupom from "../models/NatalCupom.js";
import NatalLote from "../models/NatalLote.js";
import NatalParticipacao from "../models/NatalParticipacao.js";
import { buildAutorNatal } from "../models/natalSchemas.js";
import { beneficiosParaValor, formatarNumeroCupom, isGestorCampanha } from "../utils/natalCampanha.js";
import { NatalError, obterEstadoCampanha } from "./natalBaseService.js";

// Revisão dos benefícios quando o valor de um pedido participante diminui.
// A decisão (manter ou adequar) é obrigatória e é aplicada na mesma transação
// que grava a edição do pedido: ou tudo é salvo, ou nada é salvo.

export const DECISOES_REVISAO = Object.freeze(["manter", "adequar"]);
const LIMITE_PREVIA_EXCEDENTES = 100;

const centavos = (valor) => Math.round(Number(valor || 0) * 100);

const beneficiosDoLote = (lote) => ({
  nivel: Number(lote.faixaMaxima?.nivel || 0),
  valorMinimo: Number(lote.faixaMaxima?.valorMinimo || 0),
  cupons: Number(lote.cuponsConcedidos || 0),
  marketingPercentual: Number(lote.faixaMaxima?.marketingPercentual || 0),
  produtosPercentual: Number(lote.faixaMaxima?.produtosPercentual || 0),
});

// Lote com benefícios ativos: toda redução de valor exige decisão administrativa.
export const reducaoExigeRevisao = ({ lote, valorAnterior, valorNovo }) => Boolean(
  lote && lote.status === "ativo" && Number(lote.cuponsConcedidos) > 0 &&
  centavos(valorNovo) < centavos(valorAnterior)
);

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
    cuponsEsperados: Number.isInteger(Number(cuponsEsperados)) ? Number(cuponsEsperados) : undefined,
  };
};

// Participações aprovadas na ordem do cadastro original (recebimento);
// empate no mesmo instante é resolvido pelo identificador, estável e único.
const aprovadasPorAntiguidade = (loteId, session) => NatalParticipacao.find({ loteId, status: "aprovado" })
  .select("_id protocolo recebidoEm cupom petshop.nomeFantasia")
  .sort({ recebidoEm: 1, _id: 1 })
  .session(session || null)
  .lean();

export const previaRevisao = async ({ lote, valorAnterior, valorNovo }) => {
  const atual = beneficiosDoLote(lote);
  const doNovoValor = beneficiosParaValor(valorNovo);
  const [aprovadas, pendentes] = await Promise.all([
    aprovadasPorAntiguidade(lote._id),
    NatalParticipacao.countDocuments({ loteId: lote._id, status: "pendente" }),
  ]);
  const limiteAdequado = Math.min(doNovoValor.cupons, atual.cupons);
  const excedentes = aprovadas.slice(limiteAdequado);
  return {
    loteId: lote._id,
    numeroPedido: lote.numeroPedido,
    distribuidorNome: lote.distribuidorNome,
    valorAnterior: Number(valorAnterior),
    valorNovo: Number(valorNovo),
    beneficiosAtuais: atual,
    beneficiosDoNovoValor: doNovoValor,
    cuponsEsperados: atual.cupons,
    aprovadas: aprovadas.length,
    pendentes,
    impactoManter: { cupons: atual.cupons, saldoDisponivel: Math.max(atual.cupons - aprovadas.length, 0), invalidadas: 0 },
    impactoAdequar: {
      cupons: limiteAdequado,
      saldoDisponivel: Math.max(limiteAdequado - (aprovadas.length - excedentes.length), 0),
      invalidadas: excedentes.length,
      pendentesSemSaldo: limiteAdequado - (aprovadas.length - excedentes.length) <= 0 ? pendentes : 0,
      participacoes: excedentes.slice(0, LIMITE_PREVIA_EXCEDENTES).map((item) => ({
        protocolo: item.protocolo,
        petshop: item.petshop?.nomeFantasia,
        recebidoEm: item.recebidoEm,
        cupom: item.cupom?.codigo,
      })),
    },
  };
};

// Aplica a decisão dentro da transação informada. Atualizações condicionais e
// contadores por diferença impedem invalidação repetida e saldo inconsistente.
export const aplicarRevisaoBeneficios = async ({
  lote,
  valorAnterior,
  valorNovo,
  decisao,
  justificativa,
  cuponsEsperados,
  usuario,
  pedidoStatus,
  session,
  now = new Date(),
}) => {
  const autor = buildAutorNatal(usuario);
  const atual = beneficiosDoLote(lote);
  if (cuponsEsperados !== undefined && cuponsEsperados !== atual.cupons) {
    throw new NatalError(409, "Os benefícios deste pedido mudaram durante a edição. Reabra o pedido e revise novamente.", "revisao_desatualizada");
  }
  const doNovoValor = beneficiosParaValor(valorNovo);
  // Adequar nunca aumenta benefícios: aumentos são tratados automaticamente.
  const resultante = decisao === "adequar" && doNovoValor.cupons < atual.cupons ? doNovoValor : atual;
  const pendentes = await NatalParticipacao.countDocuments({ loteId: lote._id, status: "pendente" }).session(session);
  const aprovadas = await aprovadasPorAntiguidade(lote._id, session);
  const excedentes = decisao === "adequar" ? aprovadas.slice(resultante.cupons) : [];
  const revisaoId = new NatalLote.base.Types.ObjectId();
  const motivo = `Revisão de faixa do pedido ${lote.numeroPedido}: limite reduzido de ${atual.cupons} para ${resultante.cupons} cupons`;

  if (excedentes.length > 0) {
    const ids = excedentes.map((item) => item._id);
    const participacoes = await NatalParticipacao.updateMany(
      { _id: { $in: ids }, loteId: lote._id, status: "aprovado" },
      {
        $set: {
          status: "invalidado_revisao",
          invalidacao: { em: now, motivo, statusAnterior: "aprovado", tipo: "revisao_faixa", revisaoId },
        },
        $push: { historico: { acao: "invalidado_revisao", em: now, autor, motivo: justificativa, detalhes: motivo } },
      },
      { session }
    );
    if (participacoes.modifiedCount !== ids.length) {
      throw new NatalError(409, "As participações deste pedido mudaram durante a revisão. Tente novamente.", "concorrencia");
    }
    await NatalCupom.updateMany(
      { participacaoId: { $in: ids }, status: "valido" },
      { $set: { status: "invalidado", encerradoEm: now, motivoEncerramento: motivo, revisaoId } },
      { session }
    );
  }

  const percentuaisMudaram = resultante.marketingPercentual !== atual.marketingPercentual ||
    resultante.produtosPercentual !== atual.produtosPercentual;
  const revisao = {
    _id: revisaoId,
    em: now,
    autor,
    decisao,
    justificativa,
    valorAnterior: Number(valorAnterior),
    valorNovo: Number(valorNovo),
    faixaAnterior: atual,
    faixaDoNovoValor: doNovoValor,
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
    ajusteBonificacaoPendente: percentuaisMudaram && !["aguardando_aprovacao", "aprovado", "novo", "em_analise"].includes(pedidoStatus),
  };

  // Condicional aos benefícios lidos: duas revisões simultâneas não se sobrepõem.
  const atualizado = await NatalLote.findOneAndUpdate(
    { _id: lote._id, status: "ativo", cuponsConcedidos: atual.cupons },
    {
      $set: {
        valorAtual: Number(valorNovo),
        cuponsConcedidos: resultante.cupons,
        faixaMaxima: resultante,
      },
      $unset: { revisaoPendente: 1 },
      $inc: { "contadores.aprovados": -excedentes.length, "contadores.invalidadosRevisao": excedentes.length },
      $push: {
        revisoes: revisao,
        historicoFaixas: {
          em: now,
          tipo: decisao === "manter" ? "revisao_mantida" : "revisao_adequada",
          origem: "revisao",
          valorPedido: Number(valorNovo),
          valorAnterior: Number(valorAnterior),
          nivelAnterior: atual.nivel,
          nivelNovo: resultante.nivel,
          cuponsAnterior: atual.cupons,
          cuponsNovo: resultante.cupons,
          acrescimo: resultante.cupons - atual.cupons,
          autor,
        },
      },
    },
    { returnDocument: "after", runValidators: true, session }
  );
  if (!atualizado) {
    throw new NatalError(409, "Os benefícios deste pedido foram alterados por outra pessoa. Reabra o pedido e revise novamente.", "revisao_desatualizada");
  }

  const estado = await obterEstadoCampanha();
  const auditorias = [{
    acao: "beneficios_revisados",
    em: now,
    autor,
    loteId: lote._id,
    pedidoId: lote.pedidoId,
    aposFechamento: Boolean(estado.listaFechada),
    detalhes: {
      revisaoId,
      numeroPedido: lote.numeroPedido,
      distribuidor: lote.distribuidorNome,
      decisao,
      justificativa,
      valorAnterior: Number(valorAnterior),
      valorNovo: Number(valorNovo),
      faixaAnterior: atual,
      faixaDoNovoValor: doNovoValor,
      faixaResultante: resultante,
      participacoesInvalidadas: revisao.participacoesInvalidadas.map((item) => item.protocolo),
      cuponsInvalidados: revisao.participacoesInvalidadas.map((item) => item.cupomCodigo),
      ajusteBonificacaoPendente: revisao.ajusteBonificacaoPendente,
    },
  }, ...revisao.participacoesInvalidadas.map((item) => ({
    acao: "participacao_invalidada_revisao",
    em: now,
    autor,
    loteId: lote._id,
    pedidoId: lote.pedidoId,
    participacaoId: item.participacaoId,
    cupomNumero: item.cupomNumero,
    aposFechamento: Boolean(estado.listaFechada),
    detalhes: { revisaoId, protocolo: item.protocolo, motivo },
  }))];
  await NatalAuditoria.insertMany(auditorias, { session });

  return { lote: atualizado, revisao, invalidadas: excedentes.length };
};
