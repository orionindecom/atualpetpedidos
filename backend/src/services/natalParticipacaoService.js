import { NATAL_2026 } from "../config/natalPremiado2026.js";
import NatalConta from "../models/NatalConta.js";
import NatalCupom from "../models/NatalCupom.js";
import NatalDistribuicao from "../models/NatalDistribuicao.js";
import NatalLote from "../models/NatalLote.js";
import NatalParticipacao from "../models/NatalParticipacao.js";
import { buildAutorNatal } from "../models/natalSchemas.js";
import {
  isDistribuidorCampanha,
  isGestorCampanha,
  situacaoCadastros,
} from "../utils/natalCampanha.js";
import {
  executarTransacaoNatal,
  garantirIndicesNatal,
  hashIp,
  NatalError,
  obterModoCumulativo,
  registrarAuditoriaNatal,
  travarModoLegado,
  verificarListaAberta,
} from "./natalBaseService.js";
import { getComprovanteStorage } from "./natalComprovanteService.js";
import { garantirConta } from "./natalContaService.js";
import {
  aprovarLotesNaSessao,
  encerrarLotesNaSessao,
  fonteDeSaldo,
  garantirDistribuicaoLegada,
  LIMITE_CUPONS_POR_LOTE,
  lerSaldoDoc,
  montarResultadoLote,
  multiplosCuponsAtivos,
  registrarLoteNaSessao,
  validarChaveIdempotencia,
  validarQuantidadeCupons,
} from "./natalDistribuicaoService.js";

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
const lerSaldo = (link, modo) => {
  const fonte = fonteDeSaldo({ conta: link.conta, lote: link.lote, modo });
  return lerSaldoDoc(fonte.naConta ? link.conta : link.lote, fonte.campoTotal);
};

// Reserva estrita: cupons aguardando validação ocupam saldo. Nenhum envio passa do disponível.
const motivoBloqueioLink = (link, modo, config, now) => {
  const situacao = situacaoCadastros(config, now);
  if (situacao === "encerrada") return "encerrada";
  if (situacao === "nao_iniciada") return "nao_iniciada";
  if (modo === "migrando") return "manutencao";
  if (link.lote && link.lote.status !== "ativo") return "lote_invalidado";
  const { total, aprovados, pendentes } = lerSaldo(link, modo);
  if (total <= 0) return "sem_beneficios";
  if (aprovados >= total) return "esgotado";
  if (aprovados + pendentes >= total) return "fila_cheia";
  return null;
};

export const MENSAGENS_BLOQUEIO = Object.freeze({
  encerrada: "O prazo para cadastros do Natal Premiado Atual Pet 2026 terminou em 10/12/2026.",
  nao_iniciada: "Os cadastros do Natal Premiado Atual Pet 2026 começam em 03/11/2026.",
  lote_invalidado: "Este link não está mais ativo. Procure o distribuidor responsável.",
  sem_beneficios: "Este link está sem cupons disponíveis no momento. Procure o distribuidor responsável.",
  esgotado: "Todos os cupons deste link já foram utilizados. Procure o distribuidor responsável.",
  fila_cheia: "Todos os cupons disponíveis já estão reservados em cadastros aguardando validação. Aguarde a validação ou procure o distribuidor.",
  manutencao: "Os cadastros estão em uma pausa rápida para atualização. Tente novamente em alguns minutos.",
});

const resumoSaldoPublico = (saldo) => ({
  disponiveis: saldo.disponivel,
  distribuidos: saldo.aprovados + saldo.pendentes,
  validados: saldo.aprovados,
  aguardandoValidacao: saldo.pendentes,
});

// Somente leitura: abrir o link nunca cria conta nem altera saldo. Mostra o saldo do
// distribuidor dono do link, nunca dados de pet shops.
export const obterLotePublico = async (codigo, { config = NATAL_2026, now = new Date() } = {}) => {
  if (typeof codigo !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(codigo)) return null;
  const link = await carregarLink(codigo);
  if (!link) return null;
  const modo = await obterModoCumulativo();
  const motivo = motivoBloqueioLink(link, modo, config, now);
  const saldo = (link.conta || link.lote) ? lerSaldo(link, modo) : null;
  const multiplos = modo === "ativo" && await multiplosCuponsAtivos();
  return {
    distribuidorNome: link.lote?.distribuidorNome || link.conta.distribuidorNome,
    aceitandoCadastros: !motivo,
    motivo,
    mensagem: motivo ? MENSAGENS_BLOQUEIO[motivo] : null,
    saldo: saldo ? resumoSaldoPublico(saldo) : null,
    multiplosCupons: multiplos,
    maximoPorEnvio: multiplos ? Math.min(saldo?.disponivel || 0, LIMITE_CUPONS_POR_LOTE) : Math.min(saldo?.disponivel || 0, 1),
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

const centavos = (valor) => Math.round(Number(valor) * 100);

// Sinais de duplicidade para a análise da gestão (nunca bloqueiam o envio): mesmo
// comprovante, mesma compra (documento + data + valor) ou mesmo documento na mesma data,
// em qualquer cadastro ou lote, inclusive lotes anteriores do próprio cadastro.
const detectarDuplicidades = async ({ dados, sha256 }) => {
  const filtros = [{ "comprovante.sha256": sha256 }];
  if (dados.documento && dados.dataCompra) {
    filtros.push(
      { "petshop.documento": dados.documento, "compra.data": dados.dataCompra },
      { "petshop.cnpj": dados.documento, "compra.data": dados.dataCompra }
    );
  }
  const cadastrosDoDocumento = dados.documento
    ? await NatalParticipacao.find({ $or: [{ "petshop.documento": dados.documento }, { "petshop.cnpj": dados.documento }] }).select("_id protocolo").limit(50).lean()
    : [];
  const [candidatos, lotes] = await Promise.all([
    NatalParticipacao.find({ $or: filtros })
      .select("_id protocolo petshop.documento petshop.cnpj compra comprovante.sha256").limit(25).lean(),
    NatalDistribuicao.find({
      tipo: { $ne: "legado" },
      $or: [
        { "comprovante.sha256": sha256 },
        ...(dados.dataCompra ? [{ participacaoId: { $in: cadastrosDoDocumento.map((item) => item._id) }, "compra.data": dados.dataCompra }] : []),
      ],
    }).select("participacaoId protocolo compra comprovante.sha256").limit(25).lean(),
  ]);

  const tipoPara = (registro) => {
    if (registro.comprovante?.sha256 === sha256) return "mesmo_comprovante";
    if (registro.compra?.data === dados.dataCompra && centavos(registro.compra?.valor) === centavos(dados.valorCompra)) return "mesma_compra";
    return "mesmo_cnpj_data";
  };
  const alertas = candidatos.map((outro) => ({
    tipo: outro.comprovante?.sha256 === sha256 ? "mesmo_comprovante" : (documentoDaParticipacao(outro.petshop) === dados.documento ? tipoPara(outro) : "mesmo_cnpj_data"),
    participacaoId: outro._id,
    protocolo: outro.protocolo,
  }));
  const vistos = new Set(alertas.map((alerta) => String(alerta.participacaoId)));
  for (const lote of lotes) {
    if (vistos.has(String(lote.participacaoId))) continue;
    vistos.add(String(lote.participacaoId));
    alertas.push({ tipo: tipoPara(lote), participacaoId: lote.participacaoId, protocolo: lote.protocolo });
  }
  return alertas;
};

const dadosComprovante = (armazenado, meta) => ({
  provider: armazenado.provider,
  chave: armazenado.chave,
  resourceType: armazenado.resourceType,
  formato: armazenado.formato,
  mimetype: meta.mimetype,
  bytes: meta.bytes,
  sha256: meta.sha256,
  nomeOriginal: meta.nomeOriginal,
});

const erroQuantidade = (mensagem, codigo = "quantidade_invalida", status = 400) => {
  const erro = new NatalError(status, mensagem, codigo);
  erro.errors = { quantidade: mensagem };
  return erro;
};

// Armazena o comprovante, grava tudo numa transação e remove o arquivo se nada foi
// gravado (falha ou repetição da mesma operação).
const gravarComArquivo = async ({ arquivo, operacao }) => {
  const storage = getComprovanteStorage();
  const armazenado = await storage.salvar(arquivo.buffer, arquivo.meta);
  let resultado;
  try {
    resultado = await executarTransacaoNatal((session) => operacao(session, dadosComprovante(armazenado, arquivo.meta)));
  } catch (error) {
    await storage.remover(armazenado).catch(() => {});
    throw error;
  }
  if (resultado.repetida) await storage.remover(armazenado).catch(() => {});
  return resultado;
};

// Envio público: cadastro novo com N cupons ou, para um documento já cadastrado neste
// distribuidor, novo lote no mesmo cadastro. A resposta é igual nos dois casos, para o
// link não revelar se um CPF/CNPJ já participa.
export const registrarEnvioPublico = async ({
  codigo,
  dados,
  arquivo,
  quantidade: quantidadeInformada = 1,
  chaveIdempotencia,
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

  const chave = chaveIdempotencia === undefined || chaveIdempotencia === null || chaveIdempotencia === ""
    ? null
    : validarChaveIdempotencia(chaveIdempotencia);
  if (chaveIdempotencia && !chave) throw new NatalError(400, "Identificador do envio inválido. Atualize a página.", "chave_invalida");
  if (chave) {
    const existente = await NatalDistribuicao.findOne({ campanha: NATAL_2026.slug, clienteId, chaveIdempotencia: chave });
    if (existente) return { repetida: true, ...await montarResultadoLote(existente) };
  }

  const bloqueio = motivoBloqueioLink(link, modo, config, now);
  if (bloqueio) throw new NatalError(modo === "migrando" ? 503 : 409, MENSAGENS_BLOQUEIO[bloqueio], bloqueio);

  const multiplos = modo === "ativo" && await multiplosCuponsAtivos();
  const saldo = lerSaldo(link, modo);
  const validacao = validarQuantidadeCupons(quantidadeInformada);
  if (!validacao.valid) throw erroQuantidade(validacao.erro);
  const { quantidade } = validacao;
  if (!multiplos && quantidade !== 1) {
    throw erroQuantidade("Envio de vários cupons por cadastro ainda não está disponível. Informe 1 cupom.", "multiplos_indisponivel", 409);
  }
  if (quantidade > saldo.disponivel) {
    throw erroQuantidade(`Saldo insuficiente: o distribuidor tem ${saldo.disponivel} cupom(ns) disponível(is).`, "saldo_insuficiente", 409);
  }

  const alertas = await detectarDuplicidades({ dados, sha256: arquivo.meta.sha256 });
  const autor = { usuarioTipo: "publico", usuarioNome: dados.vendedorNome };
  const fonte = fonteDeSaldo({ conta, lote, modo });

  const resultado = await gravarComArquivo({
    arquivo,
    operacao: async (session, comprovante) => {
      if (modo !== "ativo") await travarModoLegado(session);
      return registrarLoteNaSessao({
        session,
        clienteId,
        fonte,
        loteLink: lote,
        quantidade,
        dados,
        comprovante,
        chave,
        canal: "link_publico",
        vincularPorDocumento: multiplos,
        autor,
        distribuidorNome: lote?.distribuidorNome || conta.distribuidorNome,
        origemRequisicao: { ipHash: hashIp(ip), userAgent: String(userAgent || "").slice(0, 200) },
        alertas,
        config,
        now,
      });
    },
  });
  return { repetida: resultado.repetida, ...await montarResultadoLote(resultado.distribuicao) };
};

// Compatibilidade: devolve o cadastro, como antes dos múltiplos cupons.
export const registrarParticipacaoPublica = async (args) => {
  const resultado = await registrarEnvioPublico(args);
  return NatalParticipacao.findById(resultado.distribuicao.participacaoId);
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

export const carregarDistribuicaoAutorizada = async (id, usuario) => {
  const distribuicao = await NatalDistribuicao.findById(id);
  if (!distribuicao) throw new NatalError(404, "Lote de cupons não encontrado.", "nao_encontrado");
  const dono = isDistribuidorCampanha(usuario) && String(distribuicao.clienteId) === String(usuario._id);
  if (!isGestorCampanha(usuario) && !dono) throw new NatalError(403, "Você não tem permissão para este lote.", "sem_permissao");
  return distribuicao;
};

// Saldo usado por um cadastro: conta no modelo ativo, lote antigo no legado.
const fonteDoCadastro = async ({ participacao, modo }) => {
  const loteAtual = participacao.loteId ? await NatalLote.findById(participacao.loteId).lean() : null;
  const contaAtual = modo === "ativo"
    ? await garantirConta({ clienteId: participacao.clienteId })
    : await NatalConta.findOne({ campanha: NATAL_2026.slug, clienteId: participacao.clienteId }).lean();
  if (!contaAtual && !loteAtual) throw new NatalError(409, "Saldo do distribuidor não encontrado.", "nao_encontrado");
  return { loteAtual, contaAtual, fonte: fonteDeSaldo({ conta: contaAtual, lote: loteAtual, modo }) };
};

// Aprovação do cadastro pela gestão: valida o pet shop e todos os lotes ainda pendentes
// dele, numa única transação. Os cupons passam a valer no sorteio; o saldo reservado
// vira saldo utilizado. Cadastros antigos recebem o número na aprovação, como antes.
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
  if (participacao.loteId) {
    const loteLink = await NatalLote.findById(participacao.loteId).select("status").lean();
    if (!loteLink || loteLink.status !== "ativo") throw new NatalError(409, "O lote desta participação não está ativo.", "lote_invalidado");
  }
  const { contaAtual, loteAtual, fonte } = await fonteDoCadastro({ participacao, modo });
  const saldoAtual = lerSaldoDoc(fonte.naConta ? contaAtual : loteAtual, fonte.campoTotal);
  if (saldoAtual.total - saldoAtual.aprovados <= 0) throw new NatalError(409, "Não há saldo disponível para este distribuidor.", "sem_saldo");

  // Saldo comprometido além do concedido (redução depois dos envios): cadastros
  // anteriores têm prioridade, como na fila antiga.
  if (saldoAtual.aprovados + saldoAtual.pendentes > saldoAtual.total) {
    const anterioresPendentes = await NatalParticipacao.countDocuments({
      ...(fonte.naConta ? { clienteId: participacao.clienteId } : { loteId: participacao.loteId }),
      status: "pendente",
      recebidoEm: { $lt: participacao.recebidoEm },
    });
    const vagas = saldoAtual.total - saldoAtual.aprovados;
    if (vagas <= anterioresPendentes) {
      throw new NatalError(
        409,
        `Há ${anterioresPendentes} cadastro(s) anterior(es) pendente(s) e apenas ${vagas} vaga(s). Analise primeiro os cadastros mais antigos.`,
        "ordem_recebimento"
      );
    }
  }

  const autor = buildAutorNatal(usuario);
  const resultado = await executarTransacaoNatal(async (session) => {
    if (modo !== "ativo") await travarModoLegado(session);
    let atual = await NatalParticipacao.findOne({ _id: participacao._id, status: "pendente" }).session(session);
    if (!atual) throw new NatalError(409, "Esta participação foi analisada por outra pessoa. Atualize a lista.", "concorrencia");
    ({ participacao: atual } = await garantirDistribuicaoLegada({ participacao: atual, session, now, autor }));
    const distribuicoes = await NatalDistribuicao.find({ participacaoId: atual._id, status: "pendente" }).sort({ recebidoEm: 1, _id: 1 }).session(session);
    if (distribuicoes.length === 0) throw new NatalError(409, "Este cadastro não tem cupons aguardando validação.", "sem_cupons");

    const { unidades, numerosEmitidos } = await aprovarLotesNaSessao({
      distribuicoes, participacao: atual, fonte, autor, motivo: fechamento.justificativa, config, now, session,
    });
    // Compatibilidade: cadastro de 1 cupom continua expondo "cupom", como antes dos lotes.
    const cuponsDoCadastro = await NatalCupom.find({ participacaoId: atual._id }).select("numero codigo emitidoEm status").limit(2).session(session).lean();
    const unico = cuponsDoCadastro.length === 1 && cuponsDoCadastro[0].status === "valido" ? cuponsDoCadastro[0] : null;
    const final = await NatalParticipacao.findOneAndUpdate(
      { _id: atual._id, status: "pendente" },
      {
        $set: {
          status: "aprovado",
          decisao: { em: now, autor, motivo: fechamento.justificativa },
          ...(unico && !atual.cupom ? { cupom: { numero: unico.numero, codigo: unico.codigo, emitidoEm: unico.emitidoEm } } : {}),
        },
        $push: {
          historico: {
            acao: "aprovado",
            em: now,
            autor,
            detalhes: `${unidades} cupom(ns) validado(s)`,
            ...(fechamento.aposFechamento ? { motivo: fechamento.justificativa } : {}),
          },
        },
      },
      { returnDocument: "after", session }
    );
    if (!final) throw new NatalError(409, "Esta participação foi analisada por outra pessoa. Atualize a lista.", "concorrencia");
    return { final, unidades, numerosEmitidos, lotes: distribuicoes.map((item) => item.protocolo) };
  });

  await registrarAuditoriaNatal({
    acao: "participacao_aprovada",
    autor,
    now,
    clienteId: participacao.clienteId,
    loteId: participacao.loteId,
    pedidoId: participacao.pedidoId,
    participacaoId: participacao._id,
    cupomNumero: resultado.numerosEmitidos.length === 1 ? resultado.numerosEmitidos[0] : undefined,
    aposFechamento: fechamento.aposFechamento,
    detalhes: {
      protocolo: participacao.protocolo,
      cuponsValidados: resultado.unidades,
      lotes: resultado.lotes,
      justificativa: fechamento.justificativa,
    },
  });
  return resultado.final;
};

// Rejeição do cadastro: todos os lotes pendentes são rejeitados e o saldo reservado volta.
// A chave de documento é liberada: um novo envio do mesmo CPF/CNPJ abre outro cadastro.
export const rejeitarParticipacao = async ({ id, usuario, motivo, justificativa, now = new Date() }) => {
  if (!isGestorCampanha(usuario)) throw new NatalError(403, "Somente o Comercial ou o Administrador rejeitam participações.", "sem_permissao");
  await garantirIndicesNatal();
  const texto = validarMotivo(motivo, "o motivo da rejeição");
  const fechamento = await verificarListaAberta(usuario, justificativa);
  const participacao = await carregarParticipacaoAutorizada(id, usuario);
  if (participacao.status !== "pendente") throw new NatalError(409, "Somente cadastros pendentes podem ser rejeitados.", "status_invalido");
  const modo = await obterModoCumulativo();
  const { fonte } = await fonteDoCadastro({ participacao, modo });
  const autor = buildAutorNatal(usuario);

  const resultado = await executarTransacaoNatal(async (session) => {
    let atual = await NatalParticipacao.findOne({ _id: participacao._id, status: "pendente" }).session(session);
    if (!atual) throw new NatalError(409, "Somente cadastros pendentes podem ser rejeitados.", "status_invalido");
    ({ participacao: atual } = await garantirDistribuicaoLegada({ participacao: atual, session, now, autor }));
    const distribuicoes = await NatalDistribuicao.find({ participacaoId: atual._id, status: "pendente" }).session(session);
    const { devolvidos } = await encerrarLotesNaSessao({ distribuicoes, participacao: atual, fonte, statusFinal: "rejeitado", motivo: texto, autor, now, session });
    const rejeitada = await NatalParticipacao.findOneAndUpdate(
      { _id: atual._id, status: "pendente" },
      {
        $set: { status: "rejeitado", decisao: { em: now, autor, motivo: texto } },
        $unset: { chaveCadastro: 1 },
        $push: { historico: { acao: "rejeitado", em: now, autor, motivo: texto } },
      },
      { returnDocument: "after", session }
    );
    if (!rejeitada) throw new NatalError(409, "Somente cadastros pendentes podem ser rejeitados.", "status_invalido");
    return { rejeitada, devolvidos };
  });

  await registrarAuditoriaNatal({
    acao: "participacao_rejeitada",
    autor,
    now,
    clienteId: participacao.clienteId,
    loteId: participacao.loteId,
    pedidoId: participacao.pedidoId,
    participacaoId: participacao._id,
    aposFechamento: fechamento.aposFechamento,
    detalhes: { protocolo: participacao.protocolo, motivo: texto, cuponsDevolvidos: resultado.devolvidos, justificativa: fechamento.justificativa },
  });
  return resultado.rejeitada;
};

// Cancelamento do cadastro pelo distribuidor dono ou pela gestão. Todos os cupons
// pendentes ou válidos são cancelados e voltam ao saldo; os números nunca são
// reutilizados. Cupons já invalidados por revisão continuam fora do saldo.
export const cancelarParticipacao = async ({ id, usuario, motivo, justificativa, now = new Date() }) => {
  await garantirIndicesNatal();
  const texto = validarMotivo(motivo, "o motivo do cancelamento");
  const participacao = await carregarParticipacaoAutorizada(id, usuario);
  const fechamento = await verificarListaAberta(usuario, justificativa);
  const autor = buildAutorNatal(usuario);
  const filtroDono = isGestorCampanha(usuario) ? {} : { clienteId: usuario._id };
  if (!["aprovado", "pendente"].includes(participacao.status)) {
    throw new NatalError(409, "Esta participação já foi cancelada ou não pode mais ser cancelada.", "status_invalido");
  }
  const modo = await obterModoCumulativo();
  const { fonte } = await fonteDoCadastro({ participacao, modo });

  const resultado = await executarTransacaoNatal(async (session) => {
    let atual = await NatalParticipacao.findOne({ _id: participacao._id, status: { $in: ["aprovado", "pendente"] }, ...filtroDono }).session(session);
    if (!atual) throw new NatalError(409, "Esta participação já foi cancelada ou não pode mais ser cancelada.", "status_invalido");
    const statusAnterior = atual.status;
    ({ participacao: atual } = await garantirDistribuicaoLegada({ participacao: atual, session, now, autor }));
    const distribuicoes = await NatalDistribuicao.find({ participacaoId: atual._id, status: { $in: ["pendente", "aprovado"] } }).session(session);
    const encerramento = await encerrarLotesNaSessao({ distribuicoes, participacao: atual, fonte, statusFinal: "cancelado", motivo: texto, autor, now, session });
    const cancelada = await NatalParticipacao.findOneAndUpdate(
      { _id: atual._id, status: statusAnterior },
      {
        $set: { status: "cancelado", cancelamento: { em: now, motivo: texto, autor, statusAnterior } },
        $unset: { chaveCadastro: 1 },
        $push: { historico: { acao: "cancelado", em: now, autor, motivo: texto, detalhes: `${encerramento.devolvidos} cupom(ns) cancelado(s)` } },
      },
      { returnDocument: "after", session }
    );
    if (!cancelada) throw new NatalError(409, "Esta participação já foi cancelada ou não pode mais ser cancelada.", "status_invalido");
    return { cancelada, statusAnterior, ...encerramento };
  });

  await registrarAuditoriaNatal({
    acao: "participacao_cancelada",
    autor,
    now,
    clienteId: participacao.clienteId,
    loteId: participacao.loteId,
    pedidoId: participacao.pedidoId,
    participacaoId: participacao._id,
    cupomNumero: participacao.cupom?.numero,
    aposFechamento: fechamento.aposFechamento,
    detalhes: {
      protocolo: participacao.protocolo,
      motivo: texto,
      statusAnterior: resultado.statusAnterior,
      cuponsCancelados: resultado.devolvidos,
      justificativa: fechamento.justificativa,
    },
  });
  return resultado.cancelada;
};

// ---------- Lotes adicionais ----------

// Painel autenticado do distribuidor: novo lote para um cadastro dele, sem repetir os
// dados do pet shop. O lote fica aguardando a validação da gestão.
export const adicionarCuponsCadastro = async ({
  participacaoId,
  usuario,
  dados,
  arquivo,
  quantidade: quantidadeInformada,
  chaveIdempotencia,
  ip,
  userAgent,
  config = NATAL_2026,
  now = new Date(),
}) => {
  if (!isDistribuidorCampanha(usuario)) {
    throw new NatalError(403, "Somente o distribuidor dono do cadastro adiciona cupons.", "sem_permissao");
  }
  await garantirIndicesNatal();
  const participacao = await NatalParticipacao.findOne({ _id: participacaoId, clienteId: usuario._id });
  // Mesmo erro para cadastro inexistente e de outro distribuidor: nada é revelado.
  if (!participacao) throw new NatalError(404, "Cadastro não encontrado.", "nao_encontrado");
  const chave = validarChaveIdempotencia(chaveIdempotencia);
  if (!chave) throw new NatalError(400, "Identificador do envio inválido. Atualize a página.", "chave_invalida");
  const existente = await NatalDistribuicao.findOne({ campanha: NATAL_2026.slug, clienteId: usuario._id, chaveIdempotencia: chave });
  if (existente) return { repetida: true, ...await montarResultadoLote(existente) };

  const situacao = situacaoCadastros(config, now);
  if (situacao !== "aberta") throw new NatalError(409, MENSAGENS_BLOQUEIO[situacao], situacao);
  await verificarListaAberta(usuario);
  const modo = await obterModoCumulativo();
  if (modo === "migrando") throw new NatalError(503, MENSAGENS_BLOQUEIO.manutencao, "manutencao");
  if (modo !== "ativo" || !await multiplosCuponsAtivos()) {
    throw new NatalError(409, "A adição de cupons a cadastros ainda não está disponível.", "multiplos_indisponivel");
  }
  if (!["pendente", "aprovado"].includes(participacao.status)) {
    throw new NatalError(409, "Este cadastro foi rejeitado, cancelado ou invalidado e não recebe novos cupons.", "cadastro_inativo");
  }
  const conta = await garantirConta({ clienteId: usuario._id });
  const saldo = lerSaldoDoc(conta, "cupons.total");
  const validacao = validarQuantidadeCupons(quantidadeInformada);
  if (!validacao.valid) throw erroQuantidade(validacao.erro);
  if (validacao.quantidade > saldo.disponivel) {
    throw erroQuantidade(`Saldo insuficiente: você tem ${saldo.disponivel} cupom(ns) disponível(is).`, "saldo_insuficiente", 409);
  }

  const alertas = await detectarDuplicidades({ dados: { documento: documentoDaParticipacao(participacao.petshop), ...dados }, sha256: arquivo.meta.sha256 });
  const autor = { ...buildAutorNatal(usuario), usuarioNome: `${dados.vendedorNome} (${buildAutorNatal(usuario).usuarioNome})`.slice(0, 160) };
  const resultado = await gravarComArquivo({
    arquivo,
    operacao: (session, comprovante) => registrarLoteNaSessao({
      session,
      clienteId: usuario._id,
      fonte: fonteDeSaldo({ conta, lote: null, modo }),
      loteLink: null,
      quantidade: validacao.quantidade,
      dados,
      comprovante,
      chave,
      canal: "painel_distribuidor",
      participacaoAlvoId: participacao._id,
      vincularPorDocumento: false,
      autor,
      distribuidorNome: conta.distribuidorNome,
      origemRequisicao: { ipHash: hashIp(ip), userAgent: String(userAgent || "").slice(0, 200) },
      alertas,
      config,
      now,
    }),
  });
  return { repetida: resultado.repetida, ...await montarResultadoLote(resultado.distribuicao) };
};

const carregarLoteParaGestao = async (id, usuario) => {
  if (!isGestorCampanha(usuario)) throw new NatalError(403, "Somente o Comercial ou o Administrador analisam lotes.", "sem_permissao");
  await garantirIndicesNatal();
  const distribuicao = await NatalDistribuicao.findById(id);
  if (!distribuicao) throw new NatalError(404, "Lote de cupons não encontrado.", "nao_encontrado");
  const participacao = await NatalParticipacao.findById(distribuicao.participacaoId);
  if (!participacao) throw new NatalError(404, "Cadastro do lote não encontrado.", "nao_encontrado");
  const modo = await obterModoCumulativo();
  if (modo === "migrando") throw new NatalError(503, "Operação em pausa rápida para atualização. Tente novamente em alguns minutos.", "manutencao");
  return { distribuicao, participacao, modo };
};

// Validação de um lote adicional de um cadastro já aprovado. Lotes de cadastros
// pendentes são validados junto com o cadastro, nunca antes dele.
export const aprovarDistribuicao = async ({ id, usuario, justificativa, config = NATAL_2026, now = new Date() }) => {
  const fechamento = await verificarListaAberta(usuario, justificativa);
  const { distribuicao, participacao, modo } = await carregarLoteParaGestao(id, usuario);
  if (distribuicao.status !== "pendente") throw new NatalError(409, "Somente lotes aguardando validação podem ser aprovados.", "status_invalido");
  if (participacao.status !== "aprovado") {
    throw new NatalError(409, "Valide primeiro o cadastro do pet shop. Os lotes pendentes são aprovados junto com ele.", "cadastro_nao_aprovado");
  }
  const { fonte } = await fonteDoCadastro({ participacao, modo });
  const autor = buildAutorNatal(usuario);
  const resultado = await executarTransacaoNatal(async (session) => {
    const atual = await NatalParticipacao.findOne({ _id: participacao._id, status: "aprovado" }).session(session);
    if (!atual) throw new NatalError(409, "O cadastro deste lote mudou. Atualize a lista.", "concorrencia");
    const lote = await NatalDistribuicao.findOne({ _id: distribuicao._id, status: "pendente" }).session(session);
    if (!lote) throw new NatalError(409, "Este lote foi analisado por outra pessoa. Atualize a lista.", "concorrencia");
    const aprovacao = await aprovarLotesNaSessao({ distribuicoes: [lote], participacao: atual, fonte, autor, motivo: fechamento.justificativa, config, now, session });
    await NatalParticipacao.updateOne(
      { _id: atual._id },
      { $push: { historico: { acao: "lote_aprovado", em: now, autor, detalhes: `Lote ${lote.protocolo}: ${aprovacao.unidades} cupom(ns) validado(s)` } } },
      { session }
    );
    return aprovacao;
  });
  await registrarAuditoriaNatal({
    acao: "distribuicao_aprovada",
    autor,
    now,
    clienteId: participacao.clienteId,
    participacaoId: participacao._id,
    aposFechamento: fechamento.aposFechamento,
    detalhes: { protocolo: participacao.protocolo, distribuicao: distribuicao.protocolo, distribuicaoId: distribuicao._id, cuponsValidados: resultado.unidades, justificativa: fechamento.justificativa },
  });
  return { ...await montarResultadoLote(await NatalDistribuicao.findById(distribuicao._id)) };
};

const encerrarDistribuicao = async ({ id, usuario, motivo, justificativa, statusFinal, now }) => {
  const texto = validarMotivo(motivo, statusFinal === "rejeitado" ? "o motivo da rejeição" : "o motivo do cancelamento");
  const fechamento = await verificarListaAberta(usuario, justificativa);
  const { distribuicao, participacao, modo } = await carregarLoteParaGestao(id, usuario);
  const aceitos = statusFinal === "rejeitado" ? ["pendente"] : ["pendente", "aprovado"];
  if (!aceitos.includes(distribuicao.status)) {
    throw new NatalError(409, statusFinal === "rejeitado" ? "Somente lotes aguardando validação podem ser rejeitados." : "Este lote já foi encerrado.", "status_invalido");
  }
  if (statusFinal === "rejeitado" && participacao.status === "pendente" && distribuicao.tipo !== "adicional") {
    throw new NatalError(409, "Para recusar o primeiro lote, rejeite o cadastro do pet shop.", "rejeitar_cadastro");
  }
  const { fonte } = await fonteDoCadastro({ participacao, modo });
  const autor = buildAutorNatal(usuario);
  const resultado = await executarTransacaoNatal(async (session) => {
    const lote = await NatalDistribuicao.findOne({ _id: distribuicao._id, status: { $in: aceitos } }).session(session);
    if (!lote) throw new NatalError(409, "Este lote foi alterado por outra pessoa. Atualize a lista.", "concorrencia");
    let atual = await NatalParticipacao.findById(participacao._id).session(session);
    ({ participacao: atual } = await garantirDistribuicaoLegada({ participacao: atual, session, now, autor }));
    const encerramento = await encerrarLotesNaSessao({ distribuicoes: [lote], participacao: atual, fonte, statusFinal, motivo: texto, autor, now, session });
    await NatalParticipacao.updateOne(
      { _id: atual._id },
      { $push: { historico: { acao: statusFinal === "rejeitado" ? "lote_rejeitado" : "lote_cancelado", em: now, autor, motivo: texto, detalhes: `Lote ${lote.protocolo}: ${encerramento.devolvidos} cupom(ns) devolvido(s) ao saldo` } } },
      { session }
    );
    return encerramento;
  });
  await registrarAuditoriaNatal({
    acao: statusFinal === "rejeitado" ? "distribuicao_rejeitada" : "distribuicao_cancelada",
    autor,
    now,
    clienteId: participacao.clienteId,
    participacaoId: participacao._id,
    aposFechamento: fechamento.aposFechamento,
    detalhes: {
      protocolo: participacao.protocolo,
      distribuicao: distribuicao.protocolo,
      distribuicaoId: distribuicao._id,
      motivo: texto,
      statusAnterior: distribuicao.status,
      cuponsDevolvidos: resultado.devolvidos,
      justificativa: fechamento.justificativa,
    },
  });
  return { ...await montarResultadoLote(await NatalDistribuicao.findById(distribuicao._id)), devolvidos: resultado.devolvidos };
};

export const rejeitarDistribuicao = ({ id, usuario, motivo, justificativa, now = new Date() }) => (
  encerrarDistribuicao({ id, usuario, motivo, justificativa, statusFinal: "rejeitado", now })
);

// Cancela um lote específico sem afetar os demais lotes do mesmo cadastro.
export const cancelarDistribuicao = ({ id, usuario, motivo, justificativa, now = new Date() }) => (
  encerrarDistribuicao({ id, usuario, motivo, justificativa, statusFinal: "cancelado", now })
);
