import crypto from "node:crypto";
import { NATAL_2026 } from "../config/natalPremiado2026.js";
import NatalConta from "../models/NatalConta.js";
import NatalCupom from "../models/NatalCupom.js";
import NatalLote from "../models/NatalLote.js";
import NatalParticipacao from "../models/NatalParticipacao.js";
import { buildAutorNatal } from "../models/natalSchemas.js";
import {
  formatarNumeroCupom,
  isDistribuidorCampanha,
  isGestorCampanha,
  situacaoCadastros,
} from "../utils/natalCampanha.js";
import {
  executarTransacaoNatal,
  garantirIndicesNatal,
  gerarProtocolo,
  hashIp,
  NatalError,
  obterModoCumulativo,
  RepetirTransacaoNatal,
  registrarAuditoriaNatal,
  travarModoLegado,
  verificarListaAberta,
} from "./natalBaseService.js";
import { getComprovanteStorage } from "./natalComprovanteService.js";
import { garantirConta, incrementarContadores } from "./natalContaService.js";

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

// Camada de compatibilidade: resolve um link antigo ou próprio somente com leituras.
// Nenhum identificador público muda e o saldo vem sempre de uma única fonte.
const carregarLink = async (codigo) => {
  const lote = await NatalLote.findOne({ codigoPublico: codigo });
  const conta = lote
    ? await NatalConta.findOne({ campanha: NATAL_2026.slug, clienteId: lote.clienteId })
    : await NatalConta.findOne({ codigoPublico: codigo });
  return lote || conta ? { lote, conta } : null;
};

// Com o modelo ativo o saldo é o da conta, compartilhado por todos os links. Antes
// disso cada link antigo consome o próprio lote, como sempre consumiu.
const usaSaldoDaConta = ({ lote, conta }, modo) => Boolean(conta && (modo === "ativo" || !lote));

const lerSaldo = (link, modo) => {
  if (usaSaldoDaConta(link, modo)) {
    return {
      total: Number(link.conta.cupons?.total || 0),
      aprovados: Number(link.conta.contadores?.aprovados || 0),
      pendentes: Number(link.conta.contadores?.pendentes || 0),
    };
  }
  return {
    total: Number(link.lote.cuponsConcedidos || 0),
    aprovados: Number(link.lote.contadores?.aprovados || 0),
    pendentes: Number(link.lote.contadores?.pendentes || 0),
  };
};

const motivoBloqueioLink = (link, modo, config, now) => {
  const situacao = situacaoCadastros(config, now);
  if (situacao === "encerrada") return "encerrada";
  if (situacao === "nao_iniciada") return "nao_iniciada";
  if (modo === "migrando") return "manutencao";
  if (link.lote && link.lote.status !== "ativo") return "lote_invalidado";
  const { total, aprovados, pendentes } = lerSaldo(link, modo);
  if (total <= 0) return "sem_beneficios";
  if (aprovados >= total) return "esgotado";
  if (pendentes >= total - aprovados + config.folgaFilaPendentes) return "fila_cheia";
  return null;
};

export const MENSAGENS_BLOQUEIO = Object.freeze({
  encerrada: "O prazo para cadastros do Natal Premiado Atual Pet 2026 terminou em 10/12/2026.",
  nao_iniciada: "Os cadastros do Natal Premiado Atual Pet 2026 começam em 03/11/2026.",
  lote_invalidado: "Este link não está mais ativo. Procure o distribuidor responsável.",
  sem_beneficios: "Este link está sem cupons disponíveis no momento. Procure o distribuidor responsável.",
  esgotado: "Todos os cupons deste link já foram utilizados. Procure o distribuidor responsável.",
  fila_cheia: "Este link atingiu o limite de cadastros em análise. Aguarde a validação ou procure o distribuidor.",
  manutencao: "Os cadastros estão em uma pausa rápida para atualização. Tente novamente em alguns minutos.",
});

// Somente leitura: abrir o link nunca cria conta nem altera saldo.
export const obterLotePublico = async (codigo, { config = NATAL_2026, now = new Date() } = {}) => {
  if (typeof codigo !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(codigo)) return null;
  const link = await carregarLink(codigo);
  if (!link) return null;
  const motivo = motivoBloqueioLink(link, await obterModoCumulativo(), config, now);
  return {
    distribuidorNome: link.lote?.distribuidorNome || link.conta.distribuidorNome,
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
  const link = await carregarLink(codigo);
  if (!link) throw new NatalError(404, "Link de cadastro não encontrado.", "nao_encontrado");
  const modo = await obterModoCumulativo();
  if (modo === "ativo" && !link.conta) link.conta = await garantirConta({ clienteId: link.lote.clienteId });
  const { lote, conta } = link;
  const clienteId = lote?.clienteId || conta.clienteId;
  const bloqueio = motivoBloqueioLink(link, modo, config, now);
  if (bloqueio) throw new NatalError(modo === "migrando" ? 503 : 409, MENSAGENS_BLOQUEIO[bloqueio], bloqueio);

  // Reserva atômica de uma posição na fila de análise do saldo em uso.
  const naConta = usaSaldoDaConta(link, modo);
  const totalCampo = naConta ? "$cupons.total" : "$cuponsConcedidos";
  const reservado = await (naConta ? NatalConta : NatalLote).findOneAndUpdate(
    {
      _id: naConta ? conta._id : lote._id,
      ...(naConta ? {} : { status: "ativo" }),
      $expr: {
        $and: [
          { $lt: ["$contadores.aprovados", totalCampo] },
          {
            $lt: [
              "$contadores.pendentes",
              { $add: [{ $subtract: [totalCampo, "$contadores.aprovados"] }, config.folgaFilaPendentes] },
            ],
          },
        ],
      },
    },
    { $inc: { "contadores.pendentes": 1 } },
    { returnDocument: "after" }
  );
  if (!reservado) {
    const atual = await carregarLink(codigo);
    const motivo = motivoBloqueioLink(atual, modo, config, now) || "fila_cheia";
    throw new NatalError(409, MENSAGENS_BLOQUEIO[motivo], motivo);
  }
  // O outro registro acompanha o contador, para o saldo seguir certo em qualquer modo.
  if (naConta && lote) await NatalLote.updateOne({ _id: lote._id }, { $inc: { "contadores.pendentes": 1 } });
  if (!naConta && conta) await NatalConta.updateOne({ _id: conta._id }, { $inc: { "contadores.pendentes": 1 } });

  const liberarReserva = () => incrementarContadores({ clienteId, loteId: lote?._id, incrementos: { pendentes: -1 } });
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
          loteId: lote?._id,
          pedidoId: lote?.pedidoId,
          numeroPedido: lote?.numeroPedido,
          clienteId,
          distribuidorNome: lote?.distribuidorNome || conta.distribuidorNome,
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
      clienteId,
      loteId: lote?._id,
      pedidoId: lote?.pedidoId,
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

// Número aleatório ainda não usado (inclusive por cupons cancelados ou invalidados).
const sortearNumeroLivre = async (config, session) => {
  for (let tentativa = 1; tentativa <= config.numeracao.tentativas; tentativa += 1) {
    const numero = gerarNumeroCupom(config);
    if (!(await NatalCupom.exists({ campanha: "natal-2026", numero }).session(session))) return numero;
  }
  throw new NatalError(503, "Não foi possível gerar um número de cupom único. Amplie o intervalo de numeração.", "numeracao_esgotada");
};

// Aprovação em uma única transação: reserva da vaga no saldo do distribuidor (nunca
// ultrapassa o concedido), mudança de status e emissão do número aleatório único.
// Conflitos com outras aprovações ou com uma revisão repetem a operação inteira.
export const aprovarParticipacao = async ({ id, usuario, justificativa, config = NATAL_2026, now = new Date() }) => {
  if (!isGestorCampanha(usuario)) throw new NatalError(403, "Somente o Comercial ou o Administrador aprovam participações.", "sem_permissao");
  await garantirIndicesNatal();
  const fechamento = await verificarListaAberta(usuario, justificativa);
  const participacao = await carregarParticipacaoAutorizada(id, usuario);
  if (participacao.status !== "pendente") {
    throw new NatalError(409, "Somente cadastros pendentes podem ser aprovados.", "status_invalido");
  }
  const modo = await obterModoCumulativo();
  if (modo === "migrando") throw new NatalError(503, "Aprovações em pausa rápida para atualização. Tente novamente em alguns minutos.", "manutencao");
  const clienteId = participacao.clienteId;
  const { loteId } = participacao;
  const loteAtual = loteId ? await NatalLote.findById(loteId).lean() : null;
  if (loteId && (!loteAtual || loteAtual.status !== "ativo")) throw new NatalError(409, "O lote desta participação não está ativo.", "lote_invalidado");
  const contaAtual = modo === "ativo"
    ? await garantirConta({ clienteId })
    : await NatalConta.findOne({ campanha: NATAL_2026.slug, clienteId }).lean();
  const naConta = usaSaldoDaConta({ lote: loteAtual, conta: contaAtual }, modo);
  const saldoAtual = lerSaldo({ lote: loteAtual, conta: contaAtual }, modo);

  // Ordem de recebimento: com vagas escassas, cadastros anteriores têm prioridade.
  const anterioresPendentes = await NatalParticipacao.countDocuments({
    ...(naConta ? { clienteId } : { loteId }),
    status: "pendente",
    recebidoEm: { $lt: participacao.recebidoEm },
  });
  const disponivelAgora = saldoAtual.total - saldoAtual.aprovados;
  if (disponivelAgora <= 0) throw new NatalError(409, "Não há saldo disponível para este distribuidor.", "sem_saldo");
  if (disponivelAgora <= anterioresPendentes) {
    throw new NatalError(
      409,
      `Há ${anterioresPendentes} cadastro(s) anterior(es) pendente(s) e apenas ${disponivelAgora} vaga(s). Analise primeiro os cadastros mais antigos.`,
      "ordem_recebimento"
    );
  }

  const autor = buildAutorNatal(usuario);
  const resultado = await executarTransacaoNatal(async (session) => {
    if (modo !== "ativo") await travarModoLegado(session);
    const Saldo = naConta ? NatalConta : NatalLote;
    const atual = await Saldo.findById(naConta ? contaAtual._id : loteId).session(session);
    const { aprovados, total } = lerSaldo(naConta ? { conta: atual } : { lote: atual }, naConta ? "ativo" : modo);
    if (aprovados >= total) throw new NatalError(409, "Não há saldo disponível para este distribuidor.", "sem_saldo");

    const reserva = await Saldo.updateOne(
      { _id: atual._id, [naConta ? "cupons.total" : "cuponsConcedidos"]: total, "contadores.aprovados": aprovados },
      { $inc: { "contadores.aprovados": 1, "contadores.pendentes": -1 } },
      { session }
    );
    if (!reserva.modifiedCount) throw new RepetirTransacaoNatal();
    const espelho = { $inc: { "contadores.aprovados": 1, "contadores.pendentes": -1 } };
    if (naConta && loteId) await NatalLote.updateOne({ _id: loteId }, espelho, { session });
    if (!naConta && contaAtual) await NatalConta.updateOne({ _id: contaAtual._id }, espelho, { session });

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
      loteId,
      pedidoId: participacao.pedidoId,
      clienteId,
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
    return { final, numero, codigo };
  });

  await registrarAuditoriaNatal({
    acao: "participacao_aprovada",
    autor,
    now,
    clienteId,
    loteId: participacao.loteId,
    pedidoId: participacao.pedidoId,
    participacaoId: participacao._id,
    cupomNumero: resultado.numero,
    aposFechamento: fechamento.aposFechamento,
    detalhes: { protocolo: participacao.protocolo, cupom: resultado.codigo, justificativa: fechamento.justificativa },
  });
  return resultado.final;
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

  await incrementarContadores({ clienteId: rejeitada.clienteId, loteId: rejeitada.loteId, incrementos: { pendentes: -1, rejeitados: 1 } });
  await registrarAuditoriaNatal({
    acao: "participacao_rejeitada",
    autor,
    now,
    clienteId: rejeitada.clienteId,
    loteId: rejeitada.loteId,
    pedidoId: rejeitada.pedidoId,
    participacaoId: rejeitada._id,
    aposFechamento: fechamento.aposFechamento,
    detalhes: { protocolo: rejeitada.protocolo, motivo: texto, justificativa: fechamento.justificativa },
  });
  return rejeitada;
};

// Cancelamento pelo distribuidor dono ou pela gestão. A vaga volta ao
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

  await incrementarContadores({
    clienteId: cancelada.clienteId,
    loteId: cancelada.loteId,
    incrementos: statusAnterior === "aprovado" ? { aprovados: -1, cancelados: 1 } : { pendentes: -1, cancelados: 1 },
  });

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
    clienteId: cancelada.clienteId,
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
