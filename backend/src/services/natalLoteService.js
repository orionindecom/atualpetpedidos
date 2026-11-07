import mongoose from "mongoose";
import { NATAL_2026 } from "../config/natalPremiado2026.js";
import NatalConta from "../models/NatalConta.js";
import NatalLote from "../models/NatalLote.js";
import Pedido from "../models/Pedido.js";
import { buildAutorNatal } from "../models/natalSchemas.js";
import {
  pedidoAprovadoParaCampanha,
  pedidoDentroDoPeriodo,
  STATUS_FORA_DA_CAMPANHA,
} from "../utils/natalCampanha.js";
import { paraCentavos, paraReais } from "../utils/natalCumulativo.js";
import {
  garantirIndicesNatal,
  natalBancoDisponivel,
  obterModoCumulativo,
  registrarAuditoriaNatal,
} from "./natalBaseService.js";
import { recalcularConta } from "./natalContaService.js";
import { contarUnidadesCupom } from "./natalDistribuicaoService.js";

// Pedidos são a origem dos valores; o saldo fica na conta do distribuidor. Lotes são
// os links antigos: continuam válidos e só acompanham o valor do pedido que os gerou.

const origemDoPedido = (pedido, tipo) => ({ tipo, pedidoId: pedido._id, numeroPedido: pedido.numeroPedido });

// Antes da ativação não há revisão por conta: a redução fica sinalizada no lote e
// aparece no relatório da migração. Benefícios nunca mudam por este caminho.
const acompanharValorDoLote = async ({ lote, pedido, usuario, origem, now, modo }) => {
  if (!lote || lote.status !== "ativo") return lote;
  const valor = paraReais(paraCentavos(pedido.valorTotal));
  if (paraCentavos(lote.valorAtual) === paraCentavos(valor)) return lote;
  const autor = buildAutorNatal(usuario);
  const reducaoSemRevisao = modo !== "ativo" && Number(lote.cuponsConcedidos) > 0 && paraCentavos(valor) < paraCentavos(lote.valorAtual);
  const atualizado = await NatalLote.findOneAndUpdate(
    { _id: lote._id, valorAtual: lote.valorAtual },
    {
      $set: {
        valorAtual: valor,
        ...(reducaoSemRevisao ? { revisaoPendente: { detectadaEm: now, valorAnterior: lote.valorAtual, valorNovo: valor } } : {}),
      },
      $push: {
        historicoFaixas: {
          em: now,
          tipo: reducaoSemRevisao ? "reducao_sem_revisao" : "valor_atualizado",
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
  if (!atualizado) return lote;
  await registrarAuditoriaNatal({
    acao: "lote_valor_atualizado",
    autor,
    now,
    loteId: lote._id,
    pedidoId: lote.pedidoId,
    detalhes: { valorAnterior: lote.valorAtual, valor, cuponsMantidos: lote.cuponsConcedidos, origem },
  });
  return atualizado;
};

// Contadores do link antigo em unidades de cupom (cupons enviados por ele).
export const recalcularContadoresLote = async (loteId) => {
  const id = new mongoose.Types.ObjectId(String(loteId));
  const contadores = await contarUnidadesCupom({ loteId: id });
  await NatalLote.updateOne({ _id: id }, { $set: { contadores } });
  return contadores;
};

// Ponto único chamado após aprovar, editar ou cancelar um pedido.
export const sincronizarPedidoNatal = async ({ pedido, usuario, origem = "sincronizacao", now = new Date() }) => {
  if (!pedido || !natalBancoDisponivel()) return { skipped: true };
  await garantirIndicesNatal();

  const modo = await obterModoCumulativo();
  const lote = await NatalLote.findOne({ pedidoId: pedido._id });
  const elegivel = pedidoAprovadoParaCampanha(pedido) && pedidoDentroDoPeriodo(pedido);
  const loteAtual = await acompanharValorDoLote({ lote, pedido, usuario, origem, now, modo });
  // Antes da ativação nada é concedido: a compra entra no processamento autorizado.
  if (modo !== "ativo") return { lote: loteAtual, elegivel, ignorado: true };
  const contaExiste = lote || await NatalConta.exists({ campanha: NATAL_2026.slug, clienteId: pedido.clienteId });
  if (!elegivel && !contaExiste) return { lote: null, elegivel: false };

  const resultado = await recalcularConta({
    clienteId: pedido.clienteId,
    usuario,
    origem: origemDoPedido(pedido, origem),
    now,
  });
  return { lote: loteAtual, elegivel, ...resultado };
};

// Falhas na campanha nunca interrompem o fluxo do pedido; a reconciliação
// administrativa reprocessa o que não tiver sido sincronizado.
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

// Execução explícita da gestão. Cobre pedidos aprovados, editados, cancelados ou excluídos
// cuja sincronização não ocorreu. Consultas e painéis nunca chamam esta rotina.
export const reconciliarLotes = async ({ clienteId, now = new Date() } = {}) => {
  if (!natalBancoDisponivel()) return { falhas: [] };
  const modo = await obterModoCumulativo();
  await garantirIndicesNatal();

  const escopo = clienteId ? { clienteId } : {};
  const [lotes, contas, pedidos] = await Promise.all([
    NatalLote.find(escopo).select("pedidoId clienteId status valorAtual cuponsConcedidos faixaMaxima").lean(),
    NatalConta.find({ campanha: NATAL_2026.slug, ...escopo }).select("clienteId").lean(),
    Pedido.find({
      ...escopo,
      status: { $nin: STATUS_FORA_DA_CAMPANHA },
      createdAt: { $gte: NATAL_2026.inicio, $lte: NATAL_2026.fimCadastros },
    }).select("clienteId").lean().maxTimeMS(5000),
  ]);

  const pedidosDosLotes = await Pedido.find({ _id: { $in: lotes.map((lote) => lote.pedidoId) } })
    .select("_id valorTotal").lean().maxTimeMS(5000);
  const valorPorPedido = new Map(pedidosDosLotes.map((pedido) => [String(pedido._id), pedido]));
  for (const lote of lotes) {
    const pedido = valorPorPedido.get(String(lote.pedidoId));
    if (!pedido) continue;
    await acompanharValorDoLote({ lote, pedido, usuario: null, origem: "reconciliacao", now, modo })
      .catch((error) => console.error("[natal-2026] Falha ao atualizar valor do lote", { name: error?.name }));
  }
  if (modo !== "ativo") return { falhas: [] };

  const clientes = new Set([...lotes, ...contas, ...pedidos].map((item) => String(item.clienteId)));
  const falhas = [];
  for (const id of clientes) {
    try {
      await recalcularConta({ clienteId: id, now });
    } catch (error) {
      falhas.push(id);
      console.error("[natal-2026] Falha na reconciliação da conta", { name: error?.name, clienteId: id });
    }
  }
  return { falhas };
};
