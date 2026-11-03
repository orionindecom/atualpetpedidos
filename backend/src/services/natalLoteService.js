import mongoose from "mongoose";
import { NATAL_2026 } from "../config/natalPremiado2026.js";
import NatalCupom from "../models/NatalCupom.js";
import NatalLote from "../models/NatalLote.js";
import NatalParticipacao from "../models/NatalParticipacao.js";
import Pedido from "../models/Pedido.js";
import { buildAutorNatal } from "../models/natalSchemas.js";
import {
  beneficiosDaFaixa,
  calcularFaixa,
  pedidoAprovadoParaCampanha,
  pedidoDentroDoPeriodo,
} from "../utils/natalCampanha.js";
import {
  garantirIndicesNatal,
  gerarCodigoPublico,
  natalBancoDisponivel,
  obterEstadoCampanha,
  registrarAuditoriaNatal,
} from "./natalBaseService.js";

const MAX_TENTATIVAS_CODIGO = 5;

const isDuplicateKey = (error, field) => error?.code === 11000 &&
  Boolean(error?.keyPattern?.[field] || error?.keyValue?.[field]);

const valorDoPedido = (pedido) => Math.round(Number(pedido?.valorTotal || 0) * 100) / 100;

const criarLote = async ({ pedido, faixa, usuario, origem, now }) => {
  const autor = buildAutorNatal(usuario);
  const valor = valorDoPedido(pedido);
  const beneficios = beneficiosDaFaixa(faixa);

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_CODIGO; tentativa += 1) {
    try {
      const lote = await NatalLote.create({
        pedidoId: pedido._id,
        numeroPedido: pedido.numeroPedido,
        clienteId: pedido.clienteId,
        distribuidorNome: pedido.nomeFantasiaCliente || pedido.razaoSocialCliente || pedido.nomeResponsavel,
        distribuidorRazaoSocial: pedido.razaoSocialCliente,
        codigoPublico: gerarCodigoPublico(),
        status: "ativo",
        pedidoAprovadoEm: pedido.aprovacao?.aprovadoEm || now,
        valorAprovadoInicial: valor,
        valorAtual: valor,
        faixaMaxima: beneficios,
        cuponsConcedidos: beneficios.cupons,
        criadoPor: autor,
        historicoFaixas: [{
          em: now,
          tipo: "criacao",
          origem,
          valorPedido: valor,
          nivelNovo: beneficios.nivel,
          cuponsAnterior: 0,
          cuponsNovo: beneficios.cupons,
          acrescimo: beneficios.cupons,
          autor,
        }],
      });
      await registrarAuditoriaNatal({
        acao: "lote_criado",
        autor,
        now,
        loteId: lote._id,
        pedidoId: pedido._id,
        detalhes: { numeroPedido: pedido.numeroPedido, valor, cupons: beneficios.cupons, origem },
      });
      return { lote, criado: true };
    } catch (error) {
      // Outra requisição criou o lote deste pedido ao mesmo tempo.
      if (isDuplicateKey(error, "pedidoId")) {
        return { lote: await NatalLote.findOne({ pedidoId: pedido._id }), criado: false };
      }
      if (!isDuplicateKey(error, "codigoPublico") || tentativa === MAX_TENTATIVAS_CODIGO) throw error;
    }
  }
  throw new Error("Não foi possível gerar o código do lote");
};

// Ajusta o lote ao valor atual do pedido. Só acrescenta a diferença de cupons
// quando uma faixa superior é alcançada; reduções preservam a maior faixa.
// As atualizações são condicionais, então repetir a mesma edição não concede nada.
const atualizarLote = async ({ lote, pedido, faixa, usuario, origem, now }) => {
  if (lote.status !== "ativo") return { lote, alterado: false };
  const autor = buildAutorNatal(usuario);
  const valor = valorDoPedido(pedido);

  if (faixa && faixa.cupons > Number(lote.cuponsConcedidos)) {
    const beneficios = beneficiosDaFaixa(faixa);
    const atualizado = await NatalLote.findOneAndUpdate(
      { _id: lote._id, status: "ativo", cuponsConcedidos: { $lt: beneficios.cupons } },
      {
        $set: { cuponsConcedidos: beneficios.cupons, faixaMaxima: beneficios, valorAtual: valor },
        $push: {
          historicoFaixas: {
            em: now,
            tipo: "aumento_faixa",
            origem,
            valorPedido: valor,
            valorAnterior: lote.valorAtual,
            nivelAnterior: lote.faixaMaxima?.nivel,
            nivelNovo: beneficios.nivel,
            cuponsAnterior: lote.cuponsConcedidos,
            cuponsNovo: beneficios.cupons,
            acrescimo: beneficios.cupons - Number(lote.cuponsConcedidos),
            autor,
          },
        },
      },
      { returnDocument: "after", runValidators: true }
    );
    if (atualizado) {
      await registrarAuditoriaNatal({
        acao: "lote_faixa_aumentada",
        autor,
        now,
        loteId: lote._id,
        pedidoId: lote.pedidoId,
        detalhes: {
          valor,
          cuponsAnterior: lote.cuponsConcedidos,
          cuponsNovo: beneficios.cupons,
          acrescimo: beneficios.cupons - Number(lote.cuponsConcedidos),
          origem,
        },
      });
      return { lote: atualizado, alterado: true };
    }
    return { lote: await NatalLote.findById(lote._id), alterado: false };
  }

  // Redução sem decisão administrativa: a edição instrumentada sempre grava a
  // revisão junto com o pedido; se chegar aqui, os benefícios ficam como estão
  // e o lote é sinalizado para revisão (nunca reduzidos ou mantidos em silêncio).
  if (Math.round(valor * 100) < Math.round(Number(lote.valorAtual) * 100) && Number(lote.cuponsConcedidos) > 0) {
    const sinalizado = await NatalLote.findOneAndUpdate(
      { _id: lote._id, valorAtual: lote.valorAtual },
      {
        $set: { valorAtual: valor, revisaoPendente: { detectadaEm: now, valorAnterior: lote.valorAtual, valorNovo: valor } },
        $push: {
          historicoFaixas: {
            em: now,
            tipo: "reducao_sem_revisao",
            origem,
            valorPedido: valor,
            valorAnterior: lote.valorAtual,
            nivelAnterior: lote.faixaMaxima?.nivel,
            nivelNovo: lote.faixaMaxima?.nivel,
            cuponsAnterior: lote.cuponsConcedidos,
            cuponsNovo: lote.cuponsConcedidos,
            acrescimo: 0,
            autor,
          },
        },
      },
      { returnDocument: "after", runValidators: true }
    );
    if (sinalizado) {
      await registrarAuditoriaNatal({
        acao: "lote_reducao_sem_revisao",
        autor,
        now,
        loteId: lote._id,
        pedidoId: lote.pedidoId,
        detalhes: { valorAnterior: lote.valorAtual, valor, cuponsMantidos: lote.cuponsConcedidos, origem },
      });
      return { lote: sinalizado, alterado: true };
    }
    return { lote, alterado: false };
  }

  if (Math.round(Number(lote.valorAtual) * 100) !== Math.round(valor * 100)) {
    const atualizado = await NatalLote.findOneAndUpdate(
      { _id: lote._id, valorAtual: lote.valorAtual },
      {
        $set: { valorAtual: valor },
        $push: {
          historicoFaixas: {
            em: now,
            tipo: "valor_atualizado",
            origem,
            valorPedido: valor,
            valorAnterior: lote.valorAtual,
            nivelAnterior: lote.faixaMaxima?.nivel,
            nivelNovo: lote.faixaMaxima?.nivel,
            cuponsAnterior: lote.cuponsConcedidos,
            cuponsNovo: lote.cuponsConcedidos,
            acrescimo: 0,
            autor,
          },
        },
      },
      { returnDocument: "after", runValidators: true }
    );
    if (atualizado) {
      await registrarAuditoriaNatal({
        acao: "lote_valor_atualizado",
        autor,
        now,
        loteId: lote._id,
        pedidoId: lote.pedidoId,
        detalhes: { valorAnterior: lote.valorAtual, valor, cuponsMantidos: lote.cuponsConcedidos, origem },
      });
      return { lote: atualizado, alterado: true };
    }
  }

  return { lote, alterado: false };
};

export const recalcularContadoresLote = async (loteId) => {
  const id = new mongoose.Types.ObjectId(String(loteId));
  const grupos = await NatalParticipacao.aggregate([
    { $match: { loteId: id } },
    { $group: { _id: "$status", total: { $sum: 1 } } },
  ]);
  const porStatus = Object.fromEntries(grupos.map((grupo) => [grupo._id, grupo.total]));
  const contadores = {
    aprovados: porStatus.aprovado || 0,
    pendentes: porStatus.pendente || 0,
    rejeitados: porStatus.rejeitado || 0,
    cancelados: porStatus.cancelado || 0,
    invalidados: porStatus.invalidado_pedido || 0,
    invalidadosRevisao: porStatus.invalidado_revisao || 0,
  };
  await NatalLote.updateOne({ _id: id }, { $set: { contadores } });
  return contadores;
};

// Cancelamento do pedido: lote e participações deixam de valer, mas tudo
// permanece gravado. Pode ser repetido com segurança (idempotente).
export const invalidarLotePedido = async ({ pedidoId, usuario, motivo = "Pedido cancelado", now = new Date() }) => {
  if (!natalBancoDisponivel()) return { skipped: true };
  await garantirIndicesNatal();
  const autor = buildAutorNatal(usuario);
  const lote = await NatalLote.findOne({ pedidoId });
  if (!lote) return { lote: null, invalidado: false };

  const invalidadoAgora = lote.status === "ativo" && Boolean(await NatalLote.findOneAndUpdate(
    { _id: lote._id, status: "ativo" },
    {
      $set: { status: "invalidado", invalidacao: { em: now, motivo, autor } },
      $push: {
        historicoFaixas: {
          em: now,
          tipo: "invalidacao",
          origem: "cancelamento",
          valorPedido: lote.valorAtual,
          nivelAnterior: lote.faixaMaxima?.nivel,
          cuponsAnterior: lote.cuponsConcedidos,
          cuponsNovo: lote.cuponsConcedidos,
          acrescimo: 0,
          autor,
        },
      },
    },
    { returnDocument: "after" }
  ));

  let participacoesInvalidadas = 0;
  for (const statusAnterior of ["pendente", "aprovado"]) {
    const result = await NatalParticipacao.updateMany(
      { loteId: lote._id, status: statusAnterior },
      {
        $set: { status: "invalidado_pedido", invalidacao: { em: now, motivo, statusAnterior } },
        $push: { historico: { acao: "invalidado_pedido", em: now, autor, motivo } },
      }
    );
    participacoesInvalidadas += result.modifiedCount || 0;
  }

  const cupons = await NatalCupom.updateMany(
    { loteId: lote._id, status: "valido" },
    { $set: { status: "invalidado", encerradoEm: now, motivoEncerramento: motivo } }
  );
  const contadores = await recalcularContadoresLote(lote._id);

  if (invalidadoAgora || participacoesInvalidadas > 0 || cupons.modifiedCount > 0) {
    const estado = await obterEstadoCampanha();
    await registrarAuditoriaNatal({
      acao: "lote_invalidado",
      autor,
      now,
      loteId: lote._id,
      pedidoId,
      aposFechamento: Boolean(estado.listaFechada),
      detalhes: {
        motivo,
        participacoesInvalidadas,
        cuponsInvalidados: cupons.modifiedCount || 0,
        contadores,
      },
    });
  }

  return { lote: await NatalLote.findById(lote._id), invalidado: invalidadoAgora };
};

// Ponto único chamado após aprovar, editar ou mudar o status de um pedido.
export const sincronizarPedidoNatal = async ({ pedido, usuario, origem = "sincronizacao", now = new Date() }) => {
  if (!pedido || !natalBancoDisponivel()) return { skipped: true };
  await garantirIndicesNatal();

  if (pedido.status === "cancelado") {
    return invalidarLotePedido({ pedidoId: pedido._id, usuario, now });
  }

  const existente = await NatalLote.findOne({ pedidoId: pedido._id });
  if (!pedidoAprovadoParaCampanha(pedido)) return { lote: existente, elegivel: false };

  const faixa = calcularFaixa(pedido.valorTotal);
  if (!existente) {
    if (!faixa || !pedidoDentroDoPeriodo(pedido)) return { lote: null, elegivel: false };
    return criarLote({ pedido, faixa, usuario, origem, now });
  }
  return atualizarLote({ lote: existente, pedido, faixa, usuario, origem, now });
};

// Falhas na campanha nunca interrompem o fluxo do pedido; a reconciliação
// automática dos painéis reprocessa o que não tiver sido sincronizado.
export const sincronizarPedidoNatalSeguro = async (args) => {
  try {
    return await sincronizarPedidoNatal(args);
  } catch (error) {
    console.error("[natal-2026] Falha ao sincronizar pedido", {
      name: error?.name,
      code: error?.code,
      pedidoId: args?.pedido?._id ? String(args.pedido._id) : undefined,
    });
    return { error: true };
  }
};

const ultimaReconciliacao = new Map();
const INTERVALO_RECONCILIACAO_MS = 30 * 1000;

// Cobre pedidos aprovados/editados/cancelados cuja sincronização não ocorreu
// (falha momentânea, caminho operacional não instrumentado, pedido excluído).
export const reconciliarLotes = async ({ clienteId, force = false, now = new Date() } = {}) => {
  if (!natalBancoDisponivel()) return;
  const chave = clienteId ? String(clienteId) : "*";
  const anterior = ultimaReconciliacao.get(chave) || 0;
  if (!force && now.getTime() - anterior < INTERVALO_RECONCILIACAO_MS) return;
  ultimaReconciliacao.set(chave, now.getTime());
  await garantirIndicesNatal();

  const escopo = clienteId ? { clienteId } : {};
  const lotes = await NatalLote.find(escopo).select("pedidoId status valorAtual cuponsConcedidos").lean();
  const lotesPorPedido = new Map(lotes.map((lote) => [String(lote.pedidoId), lote]));
  const minimo = NATAL_2026.faixas[0].valorMinimo;

  const candidatos = await Pedido.find({
    ...escopo,
    status: { $nin: ["aguardando_aprovacao", "cancelado"] },
    valorTotal: { $gte: minimo },
    createdAt: { $gte: NATAL_2026.inicio, $lte: NATAL_2026.fimCadastros },
  }).select("_id").lean().maxTimeMS(5000);
  const idsParaVerificar = new Set([
    ...candidatos.map((pedido) => String(pedido._id)),
    ...lotes.filter((lote) => lote.status === "ativo").map((lote) => String(lote.pedidoId)),
  ]);
  if (idsParaVerificar.size === 0) return;

  const pedidos = await Pedido.find({ _id: { $in: [...idsParaVerificar] } })
    .select("_id numeroPedido clienteId nomeFantasiaCliente razaoSocialCliente nomeResponsavel valorTotal status aprovacao createdAt dataPedido")
    .lean()
    .maxTimeMS(5000);
  const pedidosPorId = new Map(pedidos.map((pedido) => [String(pedido._id), pedido]));

  for (const id of idsParaVerificar) {
    const pedido = pedidosPorId.get(id);
    const lote = lotesPorPedido.get(id);
    try {
      if (!pedido) {
        if (lote?.status === "ativo") {
          await invalidarLotePedido({ pedidoId: lote.pedidoId, motivo: "Pedido excluído", now });
        }
        continue;
      }
      const precisa = !lote || pedido.status === "cancelado" ||
        Math.round(Number(lote.valorAtual) * 100) !== Math.round(Number(pedido.valorTotal) * 100);
      if (precisa) await sincronizarPedidoNatal({ pedido, usuario: null, origem: "reconciliacao", now });
    } catch (error) {
      console.error("[natal-2026] Falha na reconciliação de lote", { name: error?.name, pedidoId: id });
    }
  }
};

export const resetReconciliacaoParaTestes = () => ultimaReconciliacao.clear();
