import { NATAL_2026 } from "../config/natalPremiado2026.js";
import NatalLote from "../models/NatalLote.js";
import Pedido from "../models/Pedido.js";
import { podeAcessarPedido } from "../services/authorizationService.js";
import { garantirIndicesNatal, natalBancoDisponivel, NatalError } from "../services/natalBaseService.js";
import { ComprovanteError, getComprovanteStorage, validarArquivoComprovante } from "../services/natalComprovanteService.js";
import { gerarExportacao } from "../services/natalExportacaoService.js";
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
import { reconciliarLotes, sincronizarPedidoNatalSeguro } from "../services/natalLoteService.js";
import {
  aprovarParticipacao,
  cancelarParticipacao,
  MENSAGENS_BLOQUEIO,
  obterLotePublico,
  obterParticipacaoAutorizada,
  registrarParticipacaoPublica,
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
  validarParticipacaoPublica,
} from "../utils/natalCampanha.js";
import { isValidObjectId } from "../utils/validation.js";

export const MENSAGEM_CADASTRO_RECEBIDO = "Cadastro recebido com sucesso! Sua participação será analisada pela equipe Atual Pet. A confirmação dependerá da validação das informações e do atendimento às regras da campanha.";

const responderErro = (res, error, contexto) => {
  if (error instanceof NatalError || error instanceof ComprovanteError) {
    return res.status(error.statusCode).json({ message: error.message, codigo: error.code });
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
    const participacao = await registrarParticipacaoPublica({
      codigo: req.params.codigo,
      dados: validacao.data,
      arquivo: { buffer: req.file.buffer, meta },
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });
    return res.status(201).json({ message: MENSAGEM_CADASTRO_RECEBIDO, protocolo: participacao.protocolo, status: "pendente" });
  } catch (error) {
    return responderErro(res, error, "enviar participação pública");
  }
};

// ---------- Distribuidor ----------

export const resumoDistribuidor = async (req, res) => {
  try {
    await reconciliarLotes({ clienteId: req.usuario._id });
    const lotes = await listarLotes({}, { clienteId: req.usuario._id });
    const ativos = lotes.filter((lote) => lote.status === "ativo");
    const totais = ativos.reduce((acc, lote) => ({
      concedidos: acc.concedidos + lote.saldo.concedidos,
      aprovados: acc.aprovados + lote.saldo.aprovados,
      pendentes: acc.pendentes + lote.saldo.pendentes,
      disponiveis: acc.disponiveis + lote.saldo.disponivel,
    }), { concedidos: 0, aprovados: 0, pendentes: 0, disponiveis: 0 });
    return res.status(200).json({ campanha: resumoConfigPublica(), lotes, totais });
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
    await garantirIndicesNatal();
    const participacao = await obterParticipacaoAutorizada(req.params.id, req.usuario);
    return res.status(200).json(serializarParticipacao(participacao.toObject(), { gestor: isGestorCampanha(req.usuario) }));
  } catch (error) {
    return responderErro(res, error, "detalhar participação");
  }
};

export const comprovanteParticipacao = async (req, res) => {
  try {
    await garantirIndicesNatal();
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

    let lote = natalBancoDisponivel() ? await NatalLote.findOne({ pedidoId: pedido._id }).lean() : null;
    if (!lote && pedidoAprovadoParaCampanha(pedido)) {
      const resultado = await sincronizarPedidoNatalSeguro({ pedido, usuario: null, origem: "reconciliacao" });
      lote = resultado?.lote ? (resultado.lote.toObject?.() || resultado.lote) : null;
    }
    const podeVerLink = isGestorCampanha(req.usuario) ||
      (isDistribuidorCampanha(req.usuario) && String(pedido.clienteId) === String(req.usuario._id));
    const loteSerializado = lote ? serializarLote(lote, { gestor: isGestorCampanha(req.usuario) }) : null;
    if (loteSerializado && !podeVerLink) delete loteSerializado.codigoPublico;

    return res.status(200).json({
      campanha: resumoConfigPublica(),
      dentroDoPeriodo: pedidoDentroDoPeriodo(pedido, NATAL_2026),
      aguardandoAprovacao: pedido.status === "aguardando_aprovacao",
      cancelado: pedido.status === "cancelado",
      previa: beneficiosDaFaixa(calcularFaixa(pedido.valorTotal)),
      proximaFaixa: beneficiosDaFaixa(proximaFaixa(pedido.valorTotal)),
      valorPedido: pedido.valorTotal,
      lote: loteSerializado,
    });
  } catch (error) {
    return responderErro(res, error, "benefícios do pedido");
  }
};

// Benefícios de vários pedidos do distribuidor (lista "Meus pedidos").
export const beneficiosMeusPedidos = async (req, res) => {
  try {
    await reconciliarLotes({ clienteId: req.usuario._id });
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
    return res.status(200).json({
      message: `Participação aprovada. Cupom ${participacao.cupom?.codigo} emitido.`,
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
    await reconciliarLotes();
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

export const reconciliarHandler = async (req, res) => {
  try {
    await reconciliarLotes({ force: true });
    return res.status(200).json(await reconciliarContadores({ usuario: req.usuario }));
  } catch (error) {
    return responderErro(res, error, "reconciliar contadores");
  }
};

export const validarIdParticipacao = (req, res, next) => (
  isValidObjectId(req.params.id) ? next() : res.status(400).json({ message: "Identificador inválido" })
);
