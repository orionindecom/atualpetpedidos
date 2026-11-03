import crypto from "node:crypto";
import mongoose from "mongoose";
import NatalAuditoria from "../models/NatalAuditoria.js";
import NatalCupom from "../models/NatalCupom.js";
import NatalLote from "../models/NatalLote.js";
import NatalParticipacao from "../models/NatalParticipacao.js";
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
    ]).catch((error) => {
      indicesPromise = null;
      throw error;
    });
  }
  return indicesPromise;
};

export const resetIndicesNatalParaTestes = () => { indicesPromise = null; };

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
