import { NATAL_2026 } from "../config/natalPremiado2026.js";
import NatalBonificacao from "../models/NatalBonificacao.js";
import NatalLote from "../models/NatalLote.js";
import Pedido from "../models/Pedido.js";
import { podeAcessarPedido } from "../services/authorizationService.js";
import { natalBancoDisponivel, NatalError } from "../services/natalBaseService.js";
import { ComprovanteError, getComprovanteStorage, validarArquivoComprovante } from "../services/natalComprovanteService.js";
import {
  cancelarCompraExterna,
  listarComprasExternas,
  obterCompraExterna,
  registrarCompraExterna,
  registrarEntregaBonificacao,
  rejeitarCompraExterna,
  serializarCompraExterna,
  validarCompraExterna,
} from "../services/natalCompraExternaService.js";
import { ajustarCuponsConta } from "../services/natalContaService.js";
import {
  buscarClientesDistribuidores,
  carregarContaLeitura,
  detalharDistribuidor,
  listarDistribuidores,
  serializarConta,
} from "../services/natalDistribuidorService.js";
import { gerarExportacao, gerarResultadoSorteio } from "../services/natalExportacaoService.js";
import { listarLotesDoCadastro, serializarDistribuicao } from "../services/natalDistribuicaoService.js";
import {
  alterarFechamentoLista,
  buscarCupom,
  listarAuditoria,
  listarExportacoes,
  listarLotes,
  listarParticipacoes,
  obterPainelGestao,
  reconciliarContadores,
  serializarLote,
  serializarParticipacao,
} from "../services/natalGestaoService.js";
import { reconciliarLotes } from "../services/natalLoteService.js";
import { previaRevisaoPendente, resolverRevisaoPendente } from "../services/natalRevisaoService.js";
import { aplicarSubstituicao, previaSubstituicao } from "../services/natalSubstituicaoService.js";
import {
  adicionarCuponsCadastro,
  aprovarDistribuicao,
  aprovarParticipacao,
  cancelarDistribuicao,
  cancelarParticipacao,
  carregarDistribuicaoAutorizada,
  MENSAGENS_BLOQUEIO,
  obterLotePublico,
  obterParticipacaoAutorizada,
  registrarEnvioPublico,
  rejeitarDistribuicao,
  rejeitarParticipacao,
} from "../services/natalParticipacaoService.js";
import {
  beneficiosDaFaixa,
  calcularFaixa,
  isDistribuidorCampanha,
  isGestorCampanha,
  pareceEnvioAutomatizado,
  pedidoAprovadoParaCampanha,
  pedidoDentroDoPeriodo,
  proximaFaixa,
  resumoConfigPublica,
  saldoLote,
  situacaoCadastros,
  validarLoteAdicional,
  validarParticipacaoPublica,
} from "../utils/natalCampanha.js";
import { isValidObjectId } from "../utils/validation.js";

export const MENSAGEM_CADASTRO_RECEBIDO = "Cadastro recebido com sucesso! Sua participação será analisada pela equipe Atual Pet. A confirmação dependerá da validação das informações e do atendimento às regras da campanha.";

const plural = (quantidade, singular, pluralTexto) => (quantidade === 1 ? singular : pluralTexto);

// Mesma mensagem para cadastro novo e para novo lote de um CPF/CNPJ já cadastrado
// no distribuidor: o link público não revela quem já participa.
export const mensagemEnvioPublico = (quantidade) => (
  `Cadastro realizado com sucesso! ${plural(quantidade, "Foi gerado 1 cupom", `Foram gerados ${quantidade} cupons`)} para este pet shop. ` +
  `${plural(quantidade, "Ele passa", "Eles passam")} a valer no sorteio depois da validação da equipe Atual Pet.`
);

const respostaLote = ({ distribuicao, cupons }) => ({
  protocolo: distribuicao.protocolo,
  status: distribuicao.status,
  quantidade: distribuicao.quantidade,
  cupons: cupons.map((cupom) => cupom.codigo),
});

const responderErro = (res, error, contexto) => {
  if (error instanceof NatalError || error instanceof ComprovanteError) {
    return res.status(error.statusCode).json({ message: error.message, codigo: error.code, errors: error.errors, detalhes: error.detalhes });
  }
  console.error(`[natal-2026] Falha em ${contexto}`, { name: error?.name, code: error?.code });
  return res.status(500).json({ message: "Erro interno do servidor" });
};

const exigirGestor = (req, res, next) => (
  isGestorCampanha(req.usuario) ? next() : res.status(403).json({ message: "Acesso negado" })
);

const exigirDistribuidor = (req, res, next) => (
  isDistribuidorCampanha(req.usuario) ? next() : res.status(403).json({ message: "Acesso exclusivo para distribuidores" })
);

const exigirAdmin = (req, res, next) => (
  req.usuario?.tipo === "admin" ? next() : res.status(403).json({ message: "Acesso negado" })
);

export const middlewaresNatal = { exigirGestor, exigirDistribuidor, exigirAdmin };

// ---------- Rotas públicas ----------

export const obterConfigPublica = (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json(resumoConfigPublica());
};

export const obterLinkPublico = async (req, res) => {
  try {
    const lote = await obterLotePublico(req.params.codigo);
    if (!lote) return res.status(404).json({ message: "Link de cadastro não encontrado. Confira o endereço recebido." });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(lote);
  } catch (error) {
    return responderErro(res, error, "consultar link público");
  }
};

export const enviarParticipacaoPublica = async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const body = req.body || {};
    if (pareceEnvioAutomatizado(body)) {
      return res.status(400).json({ message: "Não foi possível enviar o cadastro. Atualize a página e tente novamente." });
    }
    const situacao = situacaoCadastros();
    if (situacao !== "aberta") {
      return res.status(409).json({ message: MENSAGENS_BLOQUEIO[situacao], codigo: situacao });
    }
    const validacao = validarParticipacaoPublica(body);
    if (!validacao.valid) {
      return res.status(400).json({ message: "Revise os campos destacados.", errors: validacao.errors });
    }
    let meta;
    try {
      meta = validarArquivoComprovante(req.file);
    } catch (error) {
      if (error instanceof ComprovanteError) {
        return res.status(400).json({ message: error.message, errors: { comprovante: error.message } });
      }
      throw error;
    }
    const resultado = await registrarEnvioPublico({
      codigo: req.params.codigo,
      dados: validacao.data,
      arquivo: { buffer: req.file.buffer, meta },
      quantidade: body.quantidade ?? 1,
      chaveIdempotencia: body.chaveIdempotencia,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });
    const link = await obterLotePublico(req.params.codigo);
    return res.status(resultado.repetida ? 200 : 201).json({
      message: mensagemEnvioPublico(resultado.distribuicao.quantidade),
      ...respostaLote(resultado),
      repetida: resultado.repetida,
      saldo: link?.saldo || null,
    });
  } catch (error) {
    return responderErro(res, error, "enviar participação pública");
  }
};

// ---------- Distribuidor ----------

export const resumoDistribuidor = async (req, res) => {
  try {
    const lotes = await listarLotes({}, { clienteId: req.usuario._id });
    const conta = await detalharDistribuidor({ clienteId: req.usuario._id, gestor: false });
    // "totais" mantém compatível a tela publicada enquanto o frontend novo não entra.
    const totais = {
      concedidos: conta.cupons.total,
      aprovados: conta.cupons.utilizados,
      pendentes: conta.cupons.pendentes,
      disponiveis: conta.cupons.disponiveis,
    };
    return res.status(200).json({ campanha: resumoConfigPublica(), lotes, conta, totais });
  } catch (error) {
    return responderErro(res, error, "resumo do distribuidor");
  }
};

export const participacoesDistribuidor = async (req, res) => {
  try {
    return res.status(200).json(await listarParticipacoes(req.query, { clienteId: req.usuario._id, gestor: false }));
  } catch (error) {
    return responderErro(res, error, "listar participações do distribuidor");
  }
};

// ---------- Compartilhadas (gestão ou distribuidor dono) ----------

export const detalheParticipacao = async (req, res) => {
  try {
    const participacao = await obterParticipacaoAutorizada(req.params.id, req.usuario);
    const gestor = isGestorCampanha(req.usuario);
    return res.status(200).json({
      ...serializarParticipacao(participacao.toObject(), { gestor }),
      lotes: await listarLotesDoCadastro(participacao.toObject(), { gestor }),
    });
  } catch (error) {
    return responderErro(res, error, "detalhar participação");
  }
};

export const comprovanteParticipacao = async (req, res) => {
  try {
    const participacao = await obterParticipacaoAutorizada(req.params.id, req.usuario);
    const comprovante = participacao.comprovante;
    const stream = await getComprovanteStorage().abrir(comprovante);
    const extensao = comprovante.mimetype === "application/pdf" ? "pdf" : comprovante.mimetype.split("/")[1];
    res.setHeader("Content-Type", comprovante.mimetype);
    res.setHeader("Content-Disposition", `inline; filename="comprovante-${participacao.protocolo}.${extensao}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    stream.on("error", () => {
      if (!res.headersSent) res.status(502).json({ message: "Comprovante indisponível no momento." });
      else res.destroy();
    });
    return stream.pipe(res);
  } catch (error) {
    return responderErro(res, error, "abrir comprovante");
  }
};

export const cancelarParticipacaoHandler = async (req, res) => {
  try {
    const participacao = await cancelarParticipacao({
      id: req.params.id,
      usuario: req.usuario,
      motivo: req.body?.motivo,
      justificativa: req.body?.justificativa,
    });
    return res.status(200).json({
      message: "Participação cancelada.",
      participacao: serializarParticipacao(participacao.toObject(), { gestor: isGestorCampanha(req.usuario) }),
    });
  } catch (error) {
    return responderErro(res, error, "cancelar participação");
  }
};

export const beneficiosPedido = async (req, res) => {
  try {
    const pedido = await Pedido.findById(req.params.id)
      .select("_id numeroPedido clienteId vendedorResponsavelId nomeFantasiaCliente razaoSocialCliente nomeResponsavel valorTotal status aprovacao createdAt dataPedido")
      .lean();
    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado" });
    if (!(await podeAcessarPedido(req.usuario, pedido))) return res.status(403).json({ message: "Acesso negado" });

    const banco = natalBancoDisponivel();
    const lote = banco ? await NatalLote.findOne({ pedidoId: pedido._id }).lean() : null;
    const aprovado = pedidoAprovadoParaCampanha(pedido);
    const podeVerLink = isGestorCampanha(req.usuario) ||
      (isDistribuidorCampanha(req.usuario) && String(pedido.clienteId) === String(req.usuario._id));
    const loteSerializado = lote ? serializarLote(lote, { gestor: isGestorCampanha(req.usuario) }) : null;
    if (loteSerializado && !podeVerLink) delete loteSerializado.codigoPublico;

    let conta = null;
    if (banco && (lote || pedidoDentroDoPeriodo(pedido, NATAL_2026))) {
      const contaDoc = await carregarContaLeitura(pedido.clienteId);
      const [lotesConta, bonificacoes] = await Promise.all([
        NatalLote.find({ clienteId: pedido.clienteId }).select("codigoPublico numeroPedido pedidoId status createdAt").lean(),
        NatalBonificacao.find({ campanha: NATAL_2026.slug, clienteId: pedido.clienteId }).select("tipo valorDevido valorConcedido valorEntregue").lean(),
      ]);
      conta = serializarConta(contaDoc, { lotes: lotesConta, bonificacoes, incluirLinks: podeVerLink });
    }

    return res.status(200).json({
      campanha: resumoConfigPublica(),
      dentroDoPeriodo: pedidoDentroDoPeriodo(pedido, NATAL_2026),
      aguardandoAprovacao: pedido.status === "aguardando_aprovacao",
      cancelado: pedido.status === "cancelado",
      aprovado,
      previa: beneficiosDaFaixa(calcularFaixa(pedido.valorTotal)),
      proximaFaixa: beneficiosDaFaixa(proximaFaixa(pedido.valorTotal)),
      valorPedido: pedido.valorTotal,
      lote: loteSerializado,
      conta,
    });
  } catch (error) {
    return responderErro(res, error, "benefícios do pedido");
  }
};

// Benefícios de vários pedidos do distribuidor (lista "Meus pedidos").
export const beneficiosMeusPedidos = async (req, res) => {
  try {
    const lotes = await NatalLote.find({ clienteId: req.usuario._id })
      .select("pedidoId status faixaMaxima cuponsConcedidos contadores")
      .lean();
    return res.status(200).json({
      campanha: resumoConfigPublica(),
      lotes: lotes.map((lote) => ({
        pedidoId: lote.pedidoId,
        status: lote.status,
        faixaMaxima: lote.faixaMaxima,
        cuponsConcedidos: lote.cuponsConcedidos,
        saldo: saldoLote(lote),
      })),
    });
  } catch (error) {
    return responderErro(res, error, "benefícios dos pedidos");
  }
};

// ---------- Gestão (Comercial e Administrador) ----------

export const aprovarParticipacaoHandler = async (req, res) => {
  try {
    const participacao = await aprovarParticipacao({ id: req.params.id, usuario: req.usuario, justificativa: req.body?.justificativa });
    const validos = Number(participacao.cupons?.validos || (participacao.cupom ? 1 : 0));
    return res.status(200).json({
      message: `Cadastro aprovado. ${validos} ${plural(validos, "cupom válido", "cupons válidos")} no sorteio.`,
      participacao: serializarParticipacao(participacao.toObject(), { gestor: true }),
    });
  } catch (error) {
    return responderErro(res, error, "aprovar participação");
  }
};

export const rejeitarParticipacaoHandler = async (req, res) => {
  try {
    const participacao = await rejeitarParticipacao({
      id: req.params.id,
      usuario: req.usuario,
      motivo: req.body?.motivo,
      justificativa: req.body?.justificativa,
    });
    return res.status(200).json({
      message: "Participação rejeitada.",
      participacao: serializarParticipacao(participacao.toObject(), { gestor: true }),
    });
  } catch (error) {
    return responderErro(res, error, "rejeitar participação");
  }
};

export const painelGestao = async (req, res) => {
  try {
    return res.status(200).json(await obterPainelGestao());
  } catch (error) {
    return responderErro(res, error, "painel de gestão");
  }
};

export const lotesGestao = async (req, res) => {
  try {
    return res.status(200).json(await listarLotes(req.query));
  } catch (error) {
    return responderErro(res, error, "listar lotes");
  }
};

export const participacoesGestao = async (req, res) => {
  try {
    return res.status(200).json(await listarParticipacoes(req.query, { gestor: true }));
  } catch (error) {
    return responderErro(res, error, "listar participações");
  }
};

export const buscarCupomHandler = async (req, res) => {
  try {
    const resultado = await buscarCupom(req.params.numero);
    if (!resultado) return res.status(404).json({ message: "Cupom não encontrado." });
    return res.status(200).json(resultado);
  } catch (error) {
    return responderErro(res, error, "buscar cupom");
  }
};

export const alterarFechamentoHandler = async (req, res) => {
  try {
    await alterarFechamentoLista({ acao: req.body?.acao, justificativa: req.body?.justificativa, usuario: req.usuario });
    return res.status(200).json({
      message: req.body?.acao === "fechar" ? "Lista oficial fechada." : "Lista oficial reaberta.",
      painel: await obterPainelGestao(),
    });
  } catch (error) {
    return responderErro(res, error, "alterar fechamento");
  }
};

export const exportarCupons = (tipo) => async (req, res) => {
  try {
    const arquivo = await gerarExportacao({ tipo, usuario: req.usuario });
    res.setHeader("Content-Type", arquivo.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${arquivo.nomeArquivo}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Total-Cupons", String(arquivo.totalCupons));
    return res.status(200).send(arquivo.buffer);
  } catch (error) {
    return responderErro(res, error, "exportar cupons");
  }
};

export const exportacoesGestao = async (req, res) => {
  try {
    return res.status(200).json(await listarExportacoes());
  } catch (error) {
    return responderErro(res, error, "listar exportações");
  }
};

export const auditoriaGestao = async (req, res) => {
  try {
    return res.status(200).json(await listarAuditoria(req.query));
  } catch (error) {
    return responderErro(res, error, "listar auditoria");
  }
};

export const distribuidoresGestao = async (req, res) => {
  try {
    return res.status(200).json(await listarDistribuidores({ busca: req.query.busca }));
  } catch (error) {
    return responderErro(res, error, "listar distribuidores");
  }
};

export const detalheDistribuidorGestao = async (req, res) => {
  try {
    return res.status(200).json(await detalharDistribuidor({ clienteId: req.params.id, gestor: true }));
  } catch (error) {
    return responderErro(res, error, "detalhar distribuidor");
  }
};

export const buscarClientesGestao = async (req, res) => {
  try {
    return res.status(200).json(await buscarClientesDistribuidores(req.query.busca));
  } catch (error) {
    return responderErro(res, error, "buscar distribuidores");
  }
};

export const ajustarCuponsHandler = async (req, res) => {
  try {
    const { conta, repetido } = await ajustarCuponsConta({
      clienteId: req.params.id,
      quantidade: req.body?.quantidade,
      motivo: req.body?.motivo,
      justificativa: req.body?.justificativa,
      chave: req.body?.chave,
      usuario: req.usuario,
    });
    return res.status(repetido ? 200 : 201).json({ message: "Ajuste registrado.", cupons: conta.cupons });
  } catch (error) {
    return responderErro(res, error, "ajustar cupons");
  }
};

export const previaRevisaoHandler = async (req, res) => {
  try {
    return res.status(200).json(await previaRevisaoPendente({ clienteId: req.params.id }));
  } catch (error) {
    return responderErro(res, error, "prévia da revisão");
  }
};

export const resolverRevisaoHandler = async (req, res) => {
  try {
    const { revisao, invalidadas } = await resolverRevisaoPendente({ clienteId: req.params.id, entrada: req.body, usuario: req.usuario });
    return res.status(200).json({
      message: revisao.decisao === "manter" ? "Benefícios mantidos." : "Benefícios adequados.",
      decisao: revisao.decisao,
      participacoesInvalidadas: invalidadas,
    });
  } catch (error) {
    return responderErro(res, error, "resolver revisão");
  }
};

export const comprasExternasGestao = async (req, res) => {
  try {
    return res.status(200).json(await listarComprasExternas({
      clienteId: isValidObjectId(req.query.distribuidorId) ? req.query.distribuidorId : undefined,
      status: ["pendente", "validada", "rejeitada", "cancelada"].includes(req.query.status) ? req.query.status : undefined,
    }));
  } catch (error) {
    return responderErro(res, error, "listar compras externas");
  }
};

export const registrarCompraExternaHandler = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Identificador inválido" });
    const arquivo = req.file ? { buffer: req.file.buffer, meta: validarArquivoComprovante(req.file) } : null;
    const compra = await registrarCompraExterna({ clienteId: req.params.id, dados: req.body || {}, arquivo, usuario: req.usuario });
    return res.status(201).json({ message: "Compra externa registrada. Ela soma no acumulado depois de validada.", compra: serializarCompraExterna(compra) });
  } catch (error) {
    return responderErro(res, error, "registrar compra externa");
  }
};

export const validarCompraExternaHandler = async (req, res) => {
  try {
    const { compra, cuponsLiberados } = await validarCompraExterna({ id: req.params.id, usuario: req.usuario });
    return res.status(200).json({ message: "Compra validada e incluída no acumulado.", compra: serializarCompraExterna(compra), cuponsLiberados });
  } catch (error) {
    return responderErro(res, error, "validar compra externa");
  }
};

export const rejeitarCompraExternaHandler = async (req, res) => {
  try {
    const { compra } = await rejeitarCompraExterna({ id: req.params.id, motivo: req.body?.motivo, usuario: req.usuario });
    return res.status(200).json({ message: "Compra rejeitada.", compra: serializarCompraExterna(compra) });
  } catch (error) {
    return responderErro(res, error, "rejeitar compra externa");
  }
};

export const cancelarCompraExternaHandler = async (req, res) => {
  try {
    const { compra } = await cancelarCompraExterna({ id: req.params.id, motivo: req.body?.motivo, usuario: req.usuario });
    return res.status(200).json({ message: "Compra cancelada.", compra: serializarCompraExterna(compra) });
  } catch (error) {
    return responderErro(res, error, "cancelar compra externa");
  }
};

export const comprovanteCompraExterna = async (req, res) => {
  try {
    const compra = await obterCompraExterna(req.params.id);
    if (!compra.comprovante) return res.status(404).json({ message: "Esta compra não possui comprovante." });
    const stream = await getComprovanteStorage().abrir(compra.comprovante);
    res.setHeader("Content-Type", compra.comprovante.mimetype);
    res.setHeader("Content-Disposition", `inline; filename="comprovante-compra-${compra._id}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    stream.on("error", () => {
      if (!res.headersSent) res.status(502).json({ message: "Comprovante indisponível no momento." });
      else res.destroy();
    });
    return stream.pipe(res);
  } catch (error) {
    return responderErro(res, error, "abrir comprovante de compra externa");
  }
};

export const registrarEntregaHandler = async (req, res) => {
  try {
    const bonificacao = await registrarEntregaBonificacao({ id: req.params.id, valor: req.body?.valor, observacao: req.body?.observacao, usuario: req.usuario });
    return res.status(200).json({ message: "Entrega registrada.", saldoPendente: bonificacao.saldoPendente });
  } catch (error) {
    return responderErro(res, error, "registrar entrega de bonificação");
  }
};

export const previaSubstituicaoHandler = async (req, res) => {
  try {
    return res.status(200).json(await previaSubstituicao({ pedidoId: req.params.id, dados: req.body || {} }));
  } catch (error) {
    return responderErro(res, error, "prévia de substituição");
  }
};

export const aplicarSubstituicaoHandler = async (req, res) => {
  try {
    const { repetida, substituicao } = await aplicarSubstituicao({
      pedidoId: req.params.id,
      dados: req.body?.compra || {},
      motivo: req.body?.motivo,
      confirmacao: req.body?.confirmacao,
      usuario: req.usuario,
    });
    return res.status(repetida ? 200 : 201).json({ message: "Substituição registrada.", substituicaoId: substituicao._id, repetida });
  } catch (error) {
    return responderErro(res, error, "aplicar substituição");
  }
};

export const reconciliarHandler = async (req, res) => {
  try {
    const { falhas } = await reconciliarLotes();
    const contadores = await reconciliarContadores({ usuario: req.usuario });
    if (falhas.length > 0) {
      return res.status(500).json({
        message: `Reconciliação incompleta: ${falhas.length} distribuidor(es) com falha. Tente novamente.`,
        codigo: "reconciliacao_parcial",
        falhas,
        ...contadores,
      });
    }
    return res.status(200).json(contadores);
  } catch (error) {
    return responderErro(res, error, "reconciliar contadores");
  }
};

// ---------- Lotes de cupons ----------

// Painel do distribuidor: novo lote para um cadastro existente (sem repetir os dados).
export const adicionarCuponsHandler = async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const body = req.body || {};
    const validacao = validarLoteAdicional(body);
    if (!validacao.valid) return res.status(400).json({ message: "Revise os campos destacados.", errors: validacao.errors });
    let meta;
    try {
      meta = validarArquivoComprovante(req.file);
    } catch (error) {
      if (error instanceof ComprovanteError) return res.status(400).json({ message: error.message, errors: { comprovante: error.message } });
      throw error;
    }
    const resultado = await adicionarCuponsCadastro({
      participacaoId: req.params.id,
      usuario: req.usuario,
      dados: validacao.data,
      arquivo: { buffer: req.file.buffer, meta },
      quantidade: body.quantidade,
      chaveIdempotencia: body.chaveIdempotencia,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });
    const total = Number(resultado.participacao?.cupons?.total || 0);
    const quantidade = resultado.distribuicao.quantidade;
    return res.status(resultado.repetida ? 200 : 201).json({
      message: `${plural(quantidade, "1 novo cupom adicionado", `${quantidade} novos cupons adicionados`)} com sucesso. Este pet shop agora possui ${total} ${plural(total, "cupom", "cupons")}. Os novos cupons passam a valer depois da validação da equipe Atual Pet.`,
      ...respostaLote(resultado),
      totalCadastro: total,
      repetida: resultado.repetida,
    });
  } catch (error) {
    return responderErro(res, error, "adicionar cupons");
  }
};

export const detalheDistribuicaoHandler = async (req, res) => {
  try {
    const distribuicao = await carregarDistribuicaoAutorizada(req.params.id, req.usuario);
    return res.status(200).json(serializarDistribuicao(distribuicao.toObject(), { gestor: isGestorCampanha(req.usuario) }));
  } catch (error) {
    return responderErro(res, error, "detalhar lote");
  }
};

export const comprovanteDistribuicao = async (req, res) => {
  try {
    const distribuicao = await carregarDistribuicaoAutorizada(req.params.id, req.usuario);
    const comprovante = distribuicao.comprovante;
    if (!comprovante) return res.status(404).json({ message: "Este lote não possui comprovante." });
    const stream = await getComprovanteStorage().abrir(comprovante);
    const extensao = comprovante.mimetype === "application/pdf" ? "pdf" : comprovante.mimetype.split("/")[1];
    res.setHeader("Content-Type", comprovante.mimetype);
    res.setHeader("Content-Disposition", `inline; filename="comprovante-${distribuicao.protocolo}.${extensao}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    stream.on("error", () => {
      if (!res.headersSent) res.status(502).json({ message: "Comprovante indisponível no momento." });
      else res.destroy();
    });
    return stream.pipe(res);
  } catch (error) {
    return responderErro(res, error, "abrir comprovante do lote");
  }
};

const responderLoteGestao = (acao, contexto) => async (req, res) => {
  try {
    const resultado = await acao({ id: req.params.id, usuario: req.usuario, motivo: req.body?.motivo, justificativa: req.body?.justificativa });
    const quantidade = resultado.distribuicao.quantidade;
    const devolvidos = Number(resultado.devolvidos || 0);
    const mensagens = {
      aprovado: `Lote aprovado. ${quantidade} ${plural(quantidade, "cupom válido", "cupons válidos")} no sorteio.`,
      rejeitado: `Lote rejeitado. ${devolvidos} ${plural(devolvidos, "cupom voltou", "cupons voltaram")} ao saldo do distribuidor.`,
      cancelado: `Lote cancelado. ${devolvidos} ${plural(devolvidos, "cupom voltou", "cupons voltaram")} ao saldo do distribuidor.`,
    };
    const distribuicao = resultado.distribuicao.toObject ? resultado.distribuicao.toObject() : resultado.distribuicao;
    return res.status(200).json({
      message: mensagens[distribuicao.status] || "Lote atualizado.",
      lote: serializarDistribuicao(distribuicao, { gestor: true, cupons: resultado.cupons }),
    });
  } catch (error) {
    return responderErro(res, error, contexto);
  }
};

export const aprovarDistribuicaoHandler = responderLoteGestao(aprovarDistribuicao, "aprovar lote");
export const rejeitarDistribuicaoHandler = responderLoteGestao(rejeitarDistribuicao, "rejeitar lote");
export const cancelarDistribuicaoHandler = responderLoteGestao(cancelarDistribuicao, "cancelar lote");

export const resultadoSorteioHandler = async (req, res) => {
  try {
    const arquivo = await gerarResultadoSorteio({ numero: req.params.numero, usuario: req.usuario });
    res.setHeader("Content-Type", arquivo.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${arquivo.nomeArquivo}"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(arquivo.buffer);
  } catch (error) {
    return responderErro(res, error, "resultado do sorteio");
  }
};

export const validarIdParticipacao = (req, res, next) => (
  isValidObjectId(req.params.id) ? next() : res.status(400).json({ message: "Identificador inválido" })
);
