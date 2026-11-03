import crypto from "node:crypto";
import mongoose from "mongoose";
import { NATAL_2026 } from "../config/natalPremiado2026.js";
import NatalCupom from "../models/NatalCupom.js";
import NatalLote from "../models/NatalLote.js";
import NatalParticipacao from "../models/NatalParticipacao.js";
import Pedido from "../models/Pedido.js";
import { buildAutorNatal } from "../models/natalSchemas.js";
import {
  formatarNumeroCupom,
  isDistribuidorCampanha,
  isGestorCampanha,
  situacaoCadastros,
} from "../utils/natalCampanha.js";
import {
  garantirIndicesNatal,
  gerarProtocolo,
  hashIp,
  NatalError,
  registrarAuditoriaNatal,
  verificarListaAberta,
} from "./natalBaseService.js";
import { getComprovanteStorage } from "./natalComprovanteService.js";
import { invalidarLotePedido } from "./natalLoteService.js";

const MAX_TENTATIVAS_PROTOCOLO = 5;

const isDuplicateKey = (error, field) => error?.code === 11000 &&
  Boolean(error?.keyPattern?.[field] || error?.keyValue?.[field]);

const validarMotivo = (motivo, rotulo = "o motivo") => {
  const texto = typeof motivo === "string" ? motivo.trim() : "";
  if (texto.length < 5 || texto.length > 500) {
    throw new NatalError(400, `Informe ${rotulo} (5 a 500 caracteres).`, "motivo_invalido");
  }
  return texto;
};

const motivoBloqueioLote = (lote, config, now) => {
  const situacao = situacaoCadastros(config, now);
  if (situacao === "encerrada") return "encerrada";
  if (situacao === "nao_iniciada") return "nao_iniciada";
  if (lote.status !== "ativo") return "lote_invalidado";
  if (Number(lote.cuponsConcedidos) <= 0) return "sem_beneficios";
  if (Number(lote.contadores?.aprovados || 0) >= Number(lote.cuponsConcedidos)) return "esgotado";
  const disponivel = Number(lote.cuponsConcedidos) - Number(lote.contadores?.aprovados || 0);
  if (Number(lote.contadores?.pendentes || 0) >= disponivel + config.folgaFilaPendentes) return "fila_cheia";
  return null;
};

export const MENSAGENS_BLOQUEIO = Object.freeze({
  encerrada: "O prazo para cadastros do Natal Premiado Atual Pet 2026 terminou em 10/12/2026.",
  nao_iniciada: "Os cadastros do Natal Premiado Atual Pet 2026 começam em 03/11/2026.",
  lote_invalidado: "Este link não está mais ativo. Procure o distribuidor responsável.",
  sem_beneficios: "Este link está sem cupons disponíveis no momento. Procure o distribuidor responsável.",
  esgotado: "Todos os cupons deste link já foram utilizados. Procure o distribuidor responsável.",
  fila_cheia: "Este link atingiu o limite de cadastros em análise. Aguarde a validação ou procure o distribuidor.",
});

// Pedido cancelado fora dos fluxos instrumentados ainda bloqueia o lote aqui.
const garantirPedidoValido = async (lote) => {
  const pedido = await Pedido.findById(lote.pedidoId).select("status").lean();
  if (!pedido || pedido.status === "cancelado") {
    await invalidarLotePedido({
      pedidoId: lote.pedidoId,
      motivo: pedido ? "Pedido cancelado" : "Pedido excluído",
    });
    throw new NatalError(409, MENSAGENS_BLOQUEIO.lote_invalidado, "lote_invalidado");
  }
};

export const obterLotePublico = async (codigo, { config = NATAL_2026, now = new Date() } = {}) => {
  await garantirIndicesNatal();
  if (typeof codigo !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(codigo)) return null;
  const lote = await NatalLote.findOne({ codigoPublico: codigo })
    .select("pedidoId distribuidorNome status cuponsConcedidos contadores")
    .lean();
  if (!lote) return null;
  let motivo = motivoBloqueioLote(lote, config, now);
  if (!motivo) {
    try {
      await garantirPedidoValido(lote);
    } catch (error) {
      if (!(error instanceof NatalError)) throw error;
      motivo = "lote_invalidado";
    }
  }
  return {
    distribuidorNome: lote.distribuidorNome,
    aceitandoCadastros: !motivo,
    motivo,
    mensagem: motivo ? MENSAGENS_BLOQUEIO[motivo] : null,
    campanha: {
      nome: config.nome,
      fimCadastros: config.fimCadastros.toISOString(),
      sorteio: config.sorteio.toISOString(),
      premio: config.premio,
    },
  };
};

// Documento (CPF ou CNPJ) dos cadastros novos e dos primeiros, gravados só com "cnpj".
export const documentoDaParticipacao = (petshop = {}) => petshop.documento || petshop.cnpj || "";

const detectarDuplicidades = async ({ dados, sha256 }) => {
  const candidatos = await NatalParticipacao.find({
    $or: [
      { "comprovante.sha256": sha256 },
      { "petshop.documento": dados.documento, "compra.data": dados.dataCompra },
      { "petshop.cnpj": dados.documento, "compra.data": dados.dataCompra },
    ],
  }).select("_id protocolo petshop.documento petshop.cnpj compra comprovante.sha256").limit(25).lean();

  return candidatos.map((outro) => {
    let tipo = "mesmo_cnpj_data";
    if (outro.comprovante?.sha256 === sha256) tipo = "mesmo_comprovante";
    else if (documentoDaParticipacao(outro.petshop) === dados.documento && outro.compra?.data === dados.dataCompra &&
      Math.round(Number(outro.compra?.valor) * 100) === Math.round(Number(dados.valorCompra) * 100)) tipo = "mesma_compra";
    return { tipo, participacaoId: outro._id, protocolo: outro.protocolo };
  });
};

// Cadastro público do pet shop. O link (código do lote) é a única identificação;
// o cadastro sempre entra como pendente e não consome saldo.
export const registrarParticipacaoPublica = async ({
  codigo,
  dados,
  arquivo,
  ip,
  userAgent,
  config = NATAL_2026,
  now = new Date(),
}) => {
  await garantirIndicesNatal();
  const lote = await NatalLote.findOne({ codigoPublico: codigo });
  if (!lote) throw new NatalError(404, "Link de cadastro não encontrado.", "nao_encontrado");
  const bloqueio = motivoBloqueioLote(lote, config, now);
  if (bloqueio) throw new NatalError(409, MENSAGENS_BLOQUEIO[bloqueio], bloqueio);
  await garantirPedidoValido(lote);

  // Reserva atômica de uma posição na fila de análise do lote.
  const reservado = await NatalLote.findOneAndUpdate(
    {
      _id: lote._id,
      status: "ativo",
      $expr: {
        $and: [
          { $lt: ["$contadores.aprovados", "$cuponsConcedidos"] },
          {
            $lt: [
              "$contadores.pendentes",
              { $add: [{ $subtract: ["$cuponsConcedidos", "$contadores.aprovados"] }, config.folgaFilaPendentes] },
            ],
          },
        ],
      },
    },
    { $inc: { "contadores.pendentes": 1 } },
    { returnDocument: "after" }
  );
  if (!reservado) {
    const atual = await NatalLote.findById(lote._id).lean();
    const motivo = motivoBloqueioLote(atual, config, now) || "fila_cheia";
    throw new NatalError(409, MENSAGENS_BLOQUEIO[motivo], motivo);
  }

  const liberarReserva = () => NatalLote.updateOne({ _id: lote._id }, { $inc: { "contadores.pendentes": -1 } });
  const storage = getComprovanteStorage();
  let armazenado;
  try {
    armazenado = await storage.salvar(arquivo.buffer, arquivo.meta);
  } catch (error) {
    await liberarReserva();
    throw error;
  }

  try {
    const alertas = await detectarDuplicidades({ dados, sha256: arquivo.meta.sha256 });
    const autor = { usuarioTipo: "publico", usuarioNome: dados.vendedorNome };
    let participacao;
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_PROTOCOLO; tentativa += 1) {
      try {
        participacao = await NatalParticipacao.create({
          loteId: lote._id,
          pedidoId: lote.pedidoId,
          numeroPedido: lote.numeroPedido,
          clienteId: lote.clienteId,
          distribuidorNome: lote.distribuidorNome,
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
          comprovante: {
            provider: armazenado.provider,
            chave: armazenado.chave,
            resourceType: armazenado.resourceType,
            formato: armazenado.formato,
            mimetype: arquivo.meta.mimetype,
            bytes: arquivo.meta.bytes,
            sha256: arquivo.meta.sha256,
            nomeOriginal: arquivo.meta.nomeOriginal,
          },
          status: "pendente",
          recebidoEm: now,
          alertas: alertas.map((alerta) => ({ ...alerta, detectadoEm: now })),
          origem: { ipHash: hashIp(ip), userAgent: String(userAgent || "").slice(0, 200) },
          historico: [{ acao: "recebido", em: now, autor, detalhes: `Enviado por ${dados.vendedorNome}` }],
        });
        break;
      } catch (error) {
        if (!isDuplicateKey(error, "protocolo") || tentativa === MAX_TENTATIVAS_PROTOCOLO) throw error;
      }
    }

    // Referência cruzada: o cadastro anterior também passa a exibir o alerta.
    for (const alerta of alertas) {
      await NatalParticipacao.updateOne(
        { _id: alerta.participacaoId },
        { $push: { alertas: { tipo: alerta.tipo, participacaoId: participacao._id, protocolo: participacao.protocolo, detectadoEm: now } } }
      );
    }

    await registrarAuditoriaNatal({
      acao: "participacao_recebida",
      autor,
      now,
      loteId: lote._id,
      pedidoId: lote.pedidoId,
      participacaoId: participacao._id,
      detalhes: { protocolo: participacao.protocolo, alertas: alertas.length },
    });
    return participacao;
  } catch (error) {
    await liberarReserva();
    await storage.remover(armazenado).catch(() => {});
    throw error;
  }
};

const carregarParticipacaoAutorizada = async (id, usuario) => {
  const participacao = await NatalParticipacao.findById(id);
  if (!participacao) throw new NatalError(404, "Participação não encontrada.", "nao_encontrado");
  const dono = isDistribuidorCampanha(usuario) && String(participacao.clienteId) === String(usuario._id);
  if (!isGestorCampanha(usuario) && !dono) {
    throw new NatalError(403, "Você não tem permissão para esta participação.", "sem_permissao");
  }
  return participacao;
};

export const obterParticipacaoAutorizada = carregarParticipacaoAutorizada;

const gerarNumeroCupom = (config) => crypto.randomInt(config.numeracao.minimo, config.numeracao.maximo + 1);

const MAX_TENTATIVAS_APROVACAO = 8;

const erroTransitorio = (error) => Boolean(
  error?.hasErrorLabel?.("TransientTransactionError") ||
  error?.errorLabels?.includes?.("TransientTransactionError") ||
  error?.code === 112 ||
  error?.codeName === "WriteConflict"
);

class RepetirAprovacao extends Error {}

// Número aleatório ainda não usado (inclusive por cupons cancelados ou invalidados).
const sortearNumeroLivre = async (config, session) => {
  for (let tentativa = 1; tentativa <= config.numeracao.tentativas; tentativa += 1) {
    const numero = gerarNumeroCupom(config);
    if (!(await NatalCupom.exists({ campanha: "natal-2026", numero }).session(session))) return numero;
  }
  throw new NatalError(503, "Não foi possível gerar um número de cupom único. Amplie o intervalo de numeração.", "numeracao_esgotada");
};

// Aprovação em uma única transação: reserva da vaga no lote (nunca ultrapassa o
// concedido), mudança de status e emissão do número aleatório único. Conflitos com
// outras aprovações ou com uma revisão de faixa simultânea repetem a operação inteira.
export const aprovarParticipacao = async ({ id, usuario, justificativa, config = NATAL_2026, now = new Date() }) => {
  if (!isGestorCampanha(usuario)) throw new NatalError(403, "Somente o Comercial ou o Administrador aprovam participações.", "sem_permissao");
  await garantirIndicesNatal();
  const fechamento = await verificarListaAberta(usuario, justificativa);
  const participacao = await carregarParticipacaoAutorizada(id, usuario);
  if (participacao.status !== "pendente") {
    throw new NatalError(409, "Somente cadastros pendentes podem ser aprovados.", "status_invalido");
  }
  const loteAtual = await NatalLote.findById(participacao.loteId);
  if (!loteAtual || loteAtual.status !== "ativo") throw new NatalError(409, "O lote desta participação não está ativo.", "lote_invalidado");
  await garantirPedidoValido(loteAtual);

  // Ordem de recebimento: com vagas escassas, cadastros anteriores têm prioridade.
  const anterioresPendentes = await NatalParticipacao.countDocuments({
    loteId: loteAtual._id,
    status: "pendente",
    recebidoEm: { $lt: participacao.recebidoEm },
  });
  const disponivelAgora = Number(loteAtual.cuponsConcedidos) - Number(loteAtual.contadores?.aprovados || 0);
  if (disponivelAgora <= 0) throw new NatalError(409, "Não há saldo disponível neste lote.", "sem_saldo");
  if (disponivelAgora <= anterioresPendentes) {
    throw new NatalError(
      409,
      `Há ${anterioresPendentes} cadastro(s) anterior(es) pendente(s) e apenas ${disponivelAgora} vaga(s). Analise primeiro os cadastros mais antigos.`,
      "ordem_recebimento"
    );
  }

  const autor = buildAutorNatal(usuario);
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_APROVACAO; tentativa += 1) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const lote = await NatalLote.findOne({ _id: participacao.loteId, status: "ativo" }).session(session);
      if (!lote) throw new NatalError(409, "O lote desta participação não está ativo.", "lote_invalidado");
      const aprovadosLote = Number(lote.contadores?.aprovados || 0);
      if (aprovadosLote >= Number(lote.cuponsConcedidos)) throw new NatalError(409, "Não há saldo disponível neste lote.", "sem_saldo");

      const reserva = await NatalLote.updateOne(
        { _id: lote._id, status: "ativo", cuponsConcedidos: lote.cuponsConcedidos, "contadores.aprovados": aprovadosLote },
        { $inc: { "contadores.aprovados": 1, "contadores.pendentes": -1 } },
        { session }
      );
      if (!reserva.modifiedCount) throw new RepetirAprovacao();

      const aprovada = await NatalParticipacao.findOneAndUpdate(
        { _id: participacao._id, status: "pendente" },
        { $set: { status: "aprovado", decisao: { em: now, autor, motivo: fechamento.justificativa } } },
        { returnDocument: "after", session }
      );
      if (!aprovada) throw new NatalError(409, "Esta participação foi analisada por outra pessoa. Atualize a lista.", "concorrencia");

      const numero = await sortearNumeroLivre(config, session);
      const codigo = formatarNumeroCupom(numero, config.numeracao.digitos);
      await NatalCupom.create([{
        numero,
        codigo,
        participacaoId: aprovada._id,
        loteId: lote._id,
        pedidoId: lote.pedidoId,
        clienteId: lote.clienteId,
        status: "valido",
        emitidoEm: now,
        emitidoPor: autor,
      }], { session });

      const final = await NatalParticipacao.findOneAndUpdate(
        { _id: aprovada._id },
        {
          $set: { cupom: { numero, codigo, emitidoEm: now } },
          $push: {
            historico: {
              acao: "aprovado",
              em: now,
              autor,
              detalhes: `Cupom ${codigo} emitido`,
              ...(fechamento.aposFechamento ? { motivo: fechamento.justificativa } : {}),
            },
          },
        },
        { returnDocument: "after", session }
      );
      await session.commitTransaction();

      await registrarAuditoriaNatal({
        acao: "participacao_aprovada",
        autor,
        now,
        loteId: lote._id,
        pedidoId: lote.pedidoId,
        participacaoId: aprovada._id,
        cupomNumero: numero,
        aposFechamento: fechamento.aposFechamento,
        detalhes: { protocolo: aprovada.protocolo, cupom: codigo, justificativa: fechamento.justificativa },
      });
      return final;
    } catch (error) {
      await session.abortTransaction().catch(() => {});
      const repetir = error instanceof RepetirAprovacao || erroTransitorio(error) || isDuplicateKey(error, "numero");
      if (!repetir) throw error;
      if (tentativa === MAX_TENTATIVAS_APROVACAO) {
        throw new NatalError(409, "O lote está sendo alterado por outra operação. Tente aprovar novamente.", "concorrencia");
      }
      await new Promise((resolve) => { setTimeout(resolve, 10 + Math.floor(Math.random() * 30) * tentativa); });
    } finally {
      await session.endSession();
    }
  }
  throw new NatalError(409, "Não foi possível aprovar agora. Tente novamente.", "concorrencia");
};

export const rejeitarParticipacao = async ({ id, usuario, motivo, justificativa, now = new Date() }) => {
  if (!isGestorCampanha(usuario)) throw new NatalError(403, "Somente o Comercial ou o Administrador rejeitam participações.", "sem_permissao");
  await garantirIndicesNatal();
  const texto = validarMotivo(motivo, "o motivo da rejeição");
  const fechamento = await verificarListaAberta(usuario, justificativa);
  const participacao = await carregarParticipacaoAutorizada(id, usuario);
  const autor = buildAutorNatal(usuario);

  const rejeitada = await NatalParticipacao.findOneAndUpdate(
    { _id: participacao._id, status: "pendente" },
    {
      $set: { status: "rejeitado", decisao: { em: now, autor, motivo: texto } },
      $push: { historico: { acao: "rejeitado", em: now, autor, motivo: texto } },
    },
    { returnDocument: "after" }
  );
  if (!rejeitada) throw new NatalError(409, "Somente cadastros pendentes podem ser rejeitados.", "status_invalido");

  await NatalLote.updateOne(
    { _id: rejeitada.loteId },
    { $inc: { "contadores.pendentes": -1, "contadores.rejeitados": 1 } }
  );
  await registrarAuditoriaNatal({
    acao: "participacao_rejeitada",
    autor,
    now,
    loteId: rejeitada.loteId,
    pedidoId: rejeitada.pedidoId,
    participacaoId: rejeitada._id,
    aposFechamento: fechamento.aposFechamento,
    detalhes: { protocolo: rejeitada.protocolo, motivo: texto, justificativa: fechamento.justificativa },
  });
  return rejeitada;
};

// Cancelamento pelo distribuidor dono do lote ou pela gestão. A vaga volta ao
// saldo só se a participação estava aprovada; o número do cupom nunca é reutilizado.
export const cancelarParticipacao = async ({ id, usuario, motivo, justificativa, now = new Date() }) => {
  await garantirIndicesNatal();
  const texto = validarMotivo(motivo, "o motivo do cancelamento");
  const participacao = await carregarParticipacaoAutorizada(id, usuario);
  const fechamento = await verificarListaAberta(usuario, justificativa);
  const autor = buildAutorNatal(usuario);
  const filtroDono = isGestorCampanha(usuario) ? {} : { clienteId: usuario._id };

  let cancelada = null;
  let statusAnterior = null;
  for (const status of ["aprovado", "pendente"]) {
    cancelada = await NatalParticipacao.findOneAndUpdate(
      { _id: participacao._id, status, ...filtroDono },
      {
        $set: { status: "cancelado", cancelamento: { em: now, motivo: texto, autor, statusAnterior: status } },
        $push: { historico: { acao: "cancelado", em: now, autor, motivo: texto } },
      },
      { returnDocument: "after" }
    );
    if (cancelada) {
      statusAnterior = status;
      break;
    }
  }
  if (!cancelada) {
    throw new NatalError(409, "Esta participação já foi cancelada ou não pode mais ser cancelada.", "status_invalido");
  }

  await NatalLote.updateOne(
    { _id: cancelada.loteId },
    {
      $inc: statusAnterior === "aprovado"
        ? { "contadores.aprovados": -1, "contadores.cancelados": 1 }
        : { "contadores.pendentes": -1, "contadores.cancelados": 1 },
    }
  );

  let cupomCancelado = null;
  if (statusAnterior === "aprovado") {
    cupomCancelado = await NatalCupom.findOneAndUpdate(
      { participacaoId: cancelada._id, status: "valido" },
      { $set: { status: "cancelado", encerradoEm: now, motivoEncerramento: texto } },
      { returnDocument: "after" }
    );
  }

  await registrarAuditoriaNatal({
    acao: "participacao_cancelada",
    autor,
    now,
    loteId: cancelada.loteId,
    pedidoId: cancelada.pedidoId,
    participacaoId: cancelada._id,
    cupomNumero: cupomCancelado?.numero,
    aposFechamento: fechamento.aposFechamento,
    detalhes: {
      protocolo: cancelada.protocolo,
      motivo: texto,
      statusAnterior,
      cupom: cupomCancelado?.codigo,
      justificativa: fechamento.justificativa,
    },
  });
  return cancelada;
};
