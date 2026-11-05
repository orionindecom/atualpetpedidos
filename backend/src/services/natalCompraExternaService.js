import { NATAL_2026 } from "../config/natalPremiado2026.js";
import NatalAuditoria from "../models/NatalAuditoria.js";
import NatalBonificacao from "../models/NatalBonificacao.js";
import NatalCompraExterna from "../models/NatalCompraExterna.js";
import Usuario from "../models/Usuario.js";
import { buildAutorNatal } from "../models/natalSchemas.js";
import { dataBrasilia, isGestorCampanha, parseValorMonetario } from "../utils/natalCampanha.js";
import { paraCentavos, paraReais } from "../utils/natalCumulativo.js";
import {
  exigirCumulativoAtivo,
  executarTransacaoNatal,
  garantirIndicesNatal,
  NatalError,
  registrarAuditoriaNatal,
} from "./natalBaseService.js";
import { getComprovanteStorage } from "./natalComprovanteService.js";
import { recalcularConta } from "./natalContaService.js";

const exigirGestor = async (usuario) => {
  if (!isGestorCampanha(usuario)) throw new NatalError(403, "Somente o Comercial ou o Administrador gerenciam compras externas.", "sem_permissao");
  await exigirCumulativoAtivo();
};

const limparTexto = (valor, max) => (typeof valor === "string" ? valor.trim().slice(0, max) : "");
export const normalizarReferencia = (referencia) => referencia.toLowerCase().replace(/\s+/g, "");

export const validarCompra = (dados, config, now) => {
  const errors = {};
  const valor = parseValorMonetario(dados.valor);
  if (valor === null || valor <= 0 || valor > 10000000) errors.valor = "Informe o valor da compra.";
  const data = typeof dados.data === "string" ? dados.data.trim() : "";
  const hoje = dataBrasilia(now, config.timeZone);
  const inicio = dataBrasilia(config.inicio, config.timeZone);
  const fim = dataBrasilia(config.fimCadastros, config.timeZone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) errors.data = "Informe a data da compra.";
  else if (data < inicio || data > fim || data > hoje) errors.data = "A data precisa estar dentro do período da campanha e não pode ser futura.";
  const referencia = limparTexto(dados.referencia, 120);
  if (referencia.length < 3) errors.referencia = "Informe o número do pedido ou da nota fiscal.";
  if (Object.keys(errors).length > 0) {
    const error = new NatalError(400, "Revise os campos destacados.", "dados_invalidos");
    error.errors = errors;
    throw error;
  }
  return { valor: Math.round(valor * 100) / 100, data, referencia, observacoes: limparTexto(dados.observacoes, 1000) || undefined };
};

export const serializarCompraExterna = (compra) => ({
  _id: compra._id,
  clienteId: compra.clienteId,
  distribuidorNome: compra.distribuidorNome,
  valor: compra.valor,
  data: compra.data,
  referencia: compra.referencia,
  observacoes: compra.observacoes,
  status: compra.status,
  possuiComprovante: Boolean(compra.comprovante),
  registradoEm: compra.registradoEm,
  registradoPorNome: compra.registradoPor?.usuarioNome,
  validadoEm: compra.validadoEm,
  historico: (compra.historico || []).map((evento) => ({
    em: evento.em,
    acao: evento.acao,
    motivo: evento.motivo,
    autorNome: evento.autor?.usuarioNome,
  })),
});

// Registra sem contabilizar: a compra só soma depois de validada.
export const registrarCompraExterna = async ({ clienteId, dados, arquivo, usuario, config = NATAL_2026, now = new Date() }) => {
  await exigirGestor(usuario);
  await garantirIndicesNatal();
  const compra = validarCompra(dados, config, now);
  const cliente = await Usuario.findById(clienteId).select("tipo nomeFantasia razaoSocial nomeResponsavel").lean();
  if (!cliente || cliente.tipo !== "cliente") throw new NatalError(404, "Distribuidor não encontrado.", "nao_encontrado");

  const armazenado = arquivo ? await getComprovanteStorage().salvar(arquivo.buffer, arquivo.meta) : null;
  const autor = buildAutorNatal(usuario);
  try {
    const criada = await NatalCompraExterna.create({
      clienteId,
      distribuidorNome: cliente.nomeFantasia || cliente.razaoSocial || cliente.nomeResponsavel,
      ...compra,
      referenciaChave: normalizarReferencia(compra.referencia),
      ...(armazenado ? {
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
      } : {}),
      registradoPor: autor,
      registradoEm: now,
      historico: [{ em: now, acao: "registrada", autor }],
    });
    await registrarAuditoriaNatal({
      acao: "compra_externa_registrada",
      autor,
      now,
      clienteId,
      detalhes: { compraExternaId: criada._id, valor: criada.valor, data: criada.data, referencia: criada.referencia },
    });
    return criada;
  } catch (error) {
    if (armazenado) await getComprovanteStorage().remover(armazenado).catch(() => {});
    if (error?.code === 11000) {
      throw new NatalError(409, "Esta referência já foi registrada para este distribuidor.", "referencia_duplicada");
    }
    throw error;
  }
};

const mudarStatus = async ({ id, de, para, acao, motivo, usuario, now, auditoria }) => {
  const autor = buildAutorNatal(usuario);
  return executarTransacaoNatal(async (session) => {
    const compra = await NatalCompraExterna.findOneAndUpdate(
      { _id: id, status: { $in: de } },
      {
        $set: {
          status: para,
          ativa: ["pendente", "validada"].includes(para),
          ...(para === "validada" ? { validadoEm: now } : {}),
        },
        $push: { historico: { em: now, acao, motivo, autor } },
      },
      { returnDocument: "after", session }
    );
    if (!compra) throw new NatalError(409, "Esta compra já foi analisada por outra pessoa. Atualize a lista.", "status_invalido");
    await NatalAuditoria.create([{
      acao: auditoria,
      em: now,
      autor,
      clienteId: compra.clienteId,
      detalhes: { compraExternaId: compra._id, valor: compra.valor, referencia: compra.referencia, motivo },
    }], { session });
    const recalculo = await recalcularConta({
      clienteId: compra.clienteId,
      usuario,
      origem: { tipo: "compra_externa", compraExternaId: compra._id, referencia: compra.referencia },
      now,
      session,
    });
    return { compra, ...recalculo };
  });
};

const validarMotivo = (motivo) => {
  const texto = limparTexto(motivo, 500);
  if (texto.length < 5) throw new NatalError(400, "Informe o motivo (5 a 500 caracteres).", "motivo_invalido");
  return texto;
};

// Validar soma a compra aos mesmos cálculos dos pedidos aprovados.
export const validarCompraExterna = async ({ id, usuario, now = new Date() }) => {
  await exigirGestor(usuario);
  await garantirIndicesNatal();
  return mudarStatus({ id, de: ["pendente"], para: "validada", acao: "validada", usuario, now, auditoria: "compra_externa_validada" });
};

export const rejeitarCompraExterna = async ({ id, motivo, usuario, now = new Date() }) => {
  await exigirGestor(usuario);
  await garantirIndicesNatal();
  return mudarStatus({ id, de: ["pendente"], para: "rejeitada", acao: "rejeitada", motivo: validarMotivo(motivo), usuario, now, auditoria: "compra_externa_rejeitada" });
};

// Cancelar uma compra validada segue a regra de reduções: benefícios concedidos só
// mudam por decisão administrativa, registrada como revisão pendente.
export const cancelarCompraExterna = async ({ id, motivo, usuario, now = new Date() }) => {
  await exigirGestor(usuario);
  await garantirIndicesNatal();
  return mudarStatus({ id, de: ["pendente", "validada"], para: "cancelada", acao: "cancelada", motivo: validarMotivo(motivo), usuario, now, auditoria: "compra_externa_cancelada" });
};

export const listarComprasExternas = async ({ clienteId, status } = {}) => {
  const filtro = {};
  if (clienteId) filtro.clienteId = clienteId;
  if (status) filtro.status = status;
  const compras = await NatalCompraExterna.find(filtro).sort({ registradoEm: -1 }).limit(300).lean().maxTimeMS(8000);
  return compras.map(serializarCompraExterna);
};

export const obterCompraExterna = async (id) => {
  const compra = await NatalCompraExterna.findById(id);
  if (!compra) throw new NatalError(404, "Compra externa não encontrada.", "nao_encontrado");
  return compra;
};

// Entrega é sempre informada pela equipe. Nada aqui gera financeiro ou nota fiscal.
export const registrarEntregaBonificacao = async ({ id, valor, observacao, usuario, now = new Date() }) => {
  await exigirGestor(usuario);
  const entrega = parseValorMonetario(valor);
  if (entrega === null || entrega <= 0) throw new NatalError(400, "Informe o valor entregue ou utilizado.", "valor_invalido");
  const texto = limparTexto(observacao, 500);
  if (texto.length < 5) throw new NatalError(400, "Descreva a entrega (5 a 500 caracteres).", "observacao_invalida");
  const autor = buildAutorNatal(usuario);
  await garantirIndicesNatal();

  return executarTransacaoNatal(async (session) => {
    const doc = await NatalBonificacao.findById(id).session(session);
    if (!doc) throw new NatalError(404, "Bonificação não encontrada.", "nao_encontrado");
    const entregueAntes = paraCentavos(doc.valorEntregue);
    const concedido = paraCentavos(doc.valorConcedido);
    const centavos = paraCentavos(entrega);
    if (entregueAntes + centavos > concedido) {
      throw new NatalError(409, `O saldo pendente desta bonificação é de R$ ${paraReais(concedido - entregueAntes).toFixed(2)}.`, "entrega_acima_do_saldo");
    }
    doc.valorEntregue = paraReais(entregueAntes + centavos);
    doc.saldoPendente = paraReais(concedido - entregueAntes - centavos);
    doc.historico.push({ em: now, tipo: "entrega", valorEntregue: paraReais(centavos), valorDevido: doc.valorDevido, observacao: texto, autor });
    await doc.save({ session });
    await NatalAuditoria.create([{
      acao: "bonificacao_entrega_registrada",
      em: now,
      autor,
      clienteId: doc.clienteId,
      detalhes: { bonificacaoId: doc._id, ciclo: doc.ciclo, tipo: doc.tipo, valor: paraReais(centavos), saldoPendente: doc.saldoPendente, observacao: texto },
    }], { session });
    return doc;
  });
};
