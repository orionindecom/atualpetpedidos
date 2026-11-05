import crypto from "node:crypto";
import mongoose from "mongoose";
import NatalAuditoria from "../models/NatalAuditoria.js";
import NatalBonificacao from "../models/NatalBonificacao.js";
import NatalCompraExterna from "../models/NatalCompraExterna.js";
import NatalConta from "../models/NatalConta.js";
import NatalCupom from "../models/NatalCupom.js";
import NatalLote from "../models/NatalLote.js";
import NatalMigracaoExecucao from "../models/NatalMigracaoExecucao.js";
import NatalMovimentoCupom from "../models/NatalMovimentoCupom.js";
import NatalParticipacao from "../models/NatalParticipacao.js";
import NatalSubstituicaoCompra from "../models/NatalSubstituicaoCompra.js";
import { NatalCampanhaEstado, NatalExportacao } from "../models/NatalCampanhaEstado.js";
import { buildAutorNatal } from "../models/natalSchemas.js";
import { NATAL_2026 } from "../config/natalPremiado2026.js";

export class NatalError extends Error {
  constructor(statusCode, message, code = undefined) {
    super(message);
    this.name = "NatalError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

// Sem conexão ativa (ex.: testes unitários com modelos simulados) a campanha
// não é sincronizada; a reconciliação dos painéis cobre o que ficar pendente.
export const natalBancoDisponivel = () => mongoose.connection.readyState === 1;

let indicesPromise = null;

// Os índices únicos sustentam regras de negócio (um lote por pedido, número de
// cupom único), por isso são garantidos mesmo com MONGO_AUTO_INDEX=false.
export const garantirIndicesNatal = () => {
  if (!indicesPromise) {
    indicesPromise = Promise.all([
      NatalLote.createIndexes(),
      NatalParticipacao.createIndexes(),
      NatalCupom.createIndexes(),
      NatalAuditoria.createIndexes(),
      NatalExportacao.createIndexes(),
      NatalConta.createIndexes(),
      NatalMovimentoCupom.createIndexes(),
      NatalBonificacao.createIndexes(),
      NatalCompraExterna.createIndexes(),
      NatalMigracaoExecucao.createIndexes(),
      NatalSubstituicaoCompra.createIndexes(),
    ]).catch((error) => {
      indicesPromise = null;
      throw error;
    });
  }
  return indicesPromise;
};

export const resetIndicesNatalParaTestes = () => { indicesPromise = null; };

const MAX_TENTATIVAS_TRANSACAO = 12;

const erroRepetivel = (error) => Boolean(
  error?.hasErrorLabel?.("TransientTransactionError") ||
  error?.errorLabels?.includes?.("TransientTransactionError") ||
  error?.code === 112 ||
  error?.code === 11000 ||
  error?.codeName === "WriteConflict"
);

// Pedido explícito para repetir a transação a partir do estado gravado.
export class RepetirTransacaoNatal extends Error {}

// Executa "operacao" numa transação. Conflitos com operações simultâneas repetem
// tudo do início; como nada foi confirmado, nenhuma repetição concede em dobro.
export const executarTransacaoNatal = async (operacao) => {
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_TRANSACAO; tentativa += 1) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const resultado = await operacao(session);
      await session.commitTransaction();
      return resultado;
    } catch (error) {
      await session.abortTransaction().catch(() => {});
      if (!(error instanceof RepetirTransacaoNatal) && !erroRepetivel(error)) throw error;
      if (tentativa === MAX_TENTATIVAS_TRANSACAO) {
        throw new NatalError(409, "O saldo do distribuidor está sendo alterado por outra operação. Tente novamente.", "concorrencia");
      }
      await new Promise((resolve) => { setTimeout(resolve, 10 + Math.floor(Math.random() * 30) * tentativa); });
    } finally {
      await session.endSession();
    }
  }
  throw new NatalError(409, "Não foi possível concluir agora. Tente novamente.", "concorrencia");
};

// Modo vigente da campanha. A troca é sempre explícita (natalMigracaoService):
// nenhum acesso, painel ou pedido muda o modo.
export const obterModoCumulativo = async (session) => {
  const estado = await NatalCampanhaEstado.findById(NATAL_2026.slug).select("modoCumulativo").session(session || null).lean();
  return estado?.modoCumulativo || "legado";
};

export const exigirCumulativoAtivo = async () => {
  if (await obterModoCumulativo() !== "ativo") {
    throw new NatalError(409, "O controle cumulativo ainda não foi ativado.", "cumulativo_inativo");
  }
};

// Dentro de uma transação do modelo legado: conflita com a passagem para "migrando",
// de modo que uma operação antiga nunca termina depois da troca de modo.
export const travarModoLegado = (session) => NatalCampanhaEstado.updateOne(
  { _id: NATAL_2026.slug, modoCumulativo: { $nin: ["migrando", "ativo"] } },
  { $inc: { operacoesLegado: 1 } },
  { upsert: true, session }
);

const ALFABETO_PROTOCOLO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const gerarCodigoPublico = () => crypto.randomBytes(18).toString("base64url");

export const gerarProtocolo = () => {
  const bytes = crypto.randomBytes(8);
  let texto = "";
  for (const byte of bytes) texto += ALFABETO_PROTOCOLO[byte % ALFABETO_PROTOCOLO.length];
  return `NP26-${texto}`;
};

export const hashIp = (ip) => crypto
  .createHmac("sha256", process.env.JWT_SECRET || "natal-2026")
  .update(String(ip || ""))
  .digest("hex")
  .slice(0, 32);

export const registrarAuditoriaNatal = async ({ acao, usuario, autor, now = new Date(), ...dados }) => {
  try {
    await NatalAuditoria.create({
      acao,
      em: now,
      autor: autor || buildAutorNatal(usuario),
      ...dados,
    });
  } catch (error) {
    console.error("[natal-2026] Falha ao registrar auditoria", { acao, name: error?.name });
  }
};

export const obterEstadoCampanha = async () => {
  const estado = await NatalCampanhaEstado.findById(NATAL_2026.slug).lean();
  return estado || { _id: NATAL_2026.slug, listaFechada: false, historico: [] };
};

// Depois do fechamento definitivo, só o Administrador altera a lista oficial,
// sempre com justificativa registrada na auditoria.
export const verificarListaAberta = async (usuario, justificativa) => {
  const estado = await obterEstadoCampanha();
  if (!estado.listaFechada) return { aposFechamento: false };
  const texto = typeof justificativa === "string" ? justificativa.trim() : "";
  if (usuario?.tipo === "admin" && texto.length >= 15 && texto.length <= 1000) {
    return { aposFechamento: true, justificativa: texto };
  }
  throw new NatalError(
    409,
    usuario?.tipo === "admin"
      ? "A lista oficial está fechada. Informe uma justificativa (mínimo de 15 caracteres) para registrar este ajuste administrativo."
      : "A lista oficial do sorteio está fechada. Alterações dependem de procedimento administrativo.",
    "lista_fechada"
  );
};
