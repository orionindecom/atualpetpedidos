import { NATAL_2026 } from "../config/natalPremiado2026.js";
import NatalConta from "../models/NatalConta.js";
import NatalCupom from "../models/NatalCupom.js";
import NatalDistribuicao from "../models/NatalDistribuicao.js";
import NatalLote from "../models/NatalLote.js";
import NatalParticipacao from "../models/NatalParticipacao.js";
import { NatalCampanhaEstado } from "../models/NatalCampanhaEstado.js";
import { executarTransacaoNatal, garantirIndicesNatal, NatalError } from "./natalBaseService.js";
import { contarUnidadesCupom, garantirDistribuicaoLegada } from "./natalDistribuicaoService.js";
import { executarEtapa } from "./natalMigracaoService.js";

// Migração para múltiplos cupons por cadastro. Nada é apagado, renumerado ou recriado:
// - cada cadastro antigo (1 cupom) ganha um lote histórico de 1 cupom, com o mesmo
//   protocolo, data, comprovante e situação; o cupom existente é apenas associado a ele;
// - o documento de cada cadastro ativo vira a chave contra duplicidade no distribuidor;
//   duplicidades antigas ficam sinalizadas para a gestão, sem fusão automática;
// - o índice único antigo (1 cupom por cadastro) é removido.
// A liberação dos múltiplos cupons é uma etapa separada e reversível.

const CAMPANHA = NATAL_2026.slug;
const ESTADOS_ATIVOS = ["pendente", "aprovado"];
const documentoDe = (petshop = {}) => petshop.documento || petshop.cnpj || "";

const indiceUnicoAntigo = async () => {
  const indices = await NatalCupom.collection.indexes().catch(() => []);
  return indices.find((indice) => indice.unique && Object.keys(indice.key || {}).length === 1 && indice.key.participacaoId === 1) || null;
};

// Retrato dos dados que a migração não pode alterar.
export const fotografarCupons = async () => {
  const [cupons, participacoes, contas] = await Promise.all([
    NatalCupom.find({}).select("numero codigo status participacaoId clienteId loteId emitidoEm").sort({ numero: 1 }).lean(),
    NatalParticipacao.find({}).select("protocolo status clienteId cupom recebidoEm petshop.documento petshop.cnpj").sort({ _id: 1 }).lean(),
    NatalConta.find({ campanha: CAMPANHA }).select("clienteId cupons contadores").sort({ clienteId: 1 }).lean(),
  ]);
  return JSON.stringify({ cupons, participacoes, contas });
};

// Invariantes por distribuidor. "erros" interrompem a migração; "avisos" vão ao relatório.
export const verificarInvariantes = async () => {
  const [contas, cupons, lotes] = await Promise.all([
    NatalConta.find({ campanha: CAMPANHA }).lean(),
    NatalCupom.find({}).select("numero status participacaoId clienteId distribuicaoId").lean(),
    NatalLote.find({}).select("clienteId").lean(),
  ]);
  const erros = [];
  const avisos = [];
  if (new Set(cupons.map((item) => item.numero)).size !== cupons.length) erros.push({ codigo: "numero_repetido", descricao: "Há números de cupom repetidos." });

  const idsParticipacoes = new Set((await NatalParticipacao.find({ _id: { $in: [...new Set(cupons.map((item) => String(item.participacaoId)))] } }).select("_id").lean()).map((item) => String(item._id)));
  const orfaos = cupons.filter((item) => !idsParticipacoes.has(String(item.participacaoId)));
  if (orfaos.length) erros.push({ codigo: "cupom_sem_cadastro", descricao: `${orfaos.length} cupom(ns) sem cadastro: ${orfaos.slice(0, 10).map((item) => item.numero).join(", ")}` });

  const porStatus = cupons.reduce((mapa, item) => ({ ...mapa, [item.status]: (mapa[item.status] || 0) + 1 }), {});
  const distribuidores = [];
  const clientes = new Set([...contas.map((item) => String(item.clienteId)), ...lotes.map((item) => String(item.clienteId))]);
  for (const clienteId of clientes) {
    const conta = contas.find((item) => String(item.clienteId) === clienteId);
    const unidades = await contarUnidadesCupom({ clienteId: NatalConta.base.Types.ObjectId.createFromHexString(clienteId) });
    const linha = {
      clienteId,
      distribuidor: conta?.distribuidorNome,
      concedidos: Number(conta?.cupons?.total || 0),
      contaAprovados: Number(conta?.contadores?.aprovados || 0),
      contaPendentes: Number(conta?.contadores?.pendentes || 0),
      cuponsValidos: unidades.aprovados,
      unidadesPendentes: unidades.pendentes,
      cancelados: unidades.cancelados,
      rejeitados: unidades.rejeitados,
      invalidados: unidades.invalidados + unidades.invalidadosRevisao,
    };
    linha.disponivel = linha.concedidos - linha.cuponsValidos - linha.unidadesPendentes;
    distribuidores.push(linha);
    if (!conta) continue;
    if (linha.contaAprovados !== linha.cuponsValidos) erros.push({ codigo: "aprovados_divergentes", clienteId, descricao: `Conta com ${linha.contaAprovados} aprovados; cupons válidos somam ${linha.cuponsValidos}.` });
    if (linha.contaPendentes !== linha.unidadesPendentes) erros.push({ codigo: "pendentes_divergentes", clienteId, descricao: `Conta com ${linha.contaPendentes} pendentes; registros somam ${linha.unidadesPendentes}.` });
    if (linha.cuponsValidos > linha.concedidos) erros.push({ codigo: "validos_acima_do_saldo", clienteId, descricao: `${linha.cuponsValidos} válidos para ${linha.concedidos} concedidos.` });
    if (linha.disponivel < 0) avisos.push({ codigo: "pendentes_acima_do_saldo", clienteId, descricao: `Cadastros pendentes ocupam ${-linha.disponivel} vaga(s) além do saldo. Novos envios ficam bloqueados até a análise.` });
  }
  return {
    ok: erros.length === 0,
    erros,
    avisos,
    totais: {
      cupons: cupons.length,
      validos: porStatus.valido || 0,
      pendentes: porStatus.pendente || 0,
      cancelados: porStatus.cancelado || 0,
      rejeitados: porStatus.rejeitado || 0,
      invalidados: porStatus.invalidado || 0,
      saldoConcedido: contas.reduce((soma, conta) => soma + Number(conta.cupons?.total || 0), 0),
    },
    distribuidores,
  };
};

// Agrupa cadastros ativos por distribuidor + documento. Sem duplicidade, o cadastro recebe
// a chave. Com duplicidade, o mais antigo aprovado (ou, sem aprovado, o mais antigo
// pendente) recebe a chave e os demais ficam sinalizados para decisão da gestão.
const planejarChaves = async () => {
  const ativos = await NatalParticipacao.find({ status: { $in: ESTADOS_ATIVOS } })
    .select("_id clienteId status recebidoEm protocolo chaveCadastro duplicidadeLegada distribuidorNome petshop.documento petshop.cnpj petshop.nomeFantasia")
    .sort({ recebidoEm: 1, _id: 1 })
    .lean();
  const grupos = new Map();
  for (const item of ativos) {
    const documento = documentoDe(item.petshop);
    if (!/^(\d{11}|\d{14})$/.test(documento)) continue;
    const chave = `${item.clienteId}:${documento}`;
    grupos.set(chave, [...(grupos.get(chave) || []), item]);
  }
  const definir = [];
  const duplicidades = [];
  for (const itens of grupos.values()) {
    const titular = itens.find((item) => item.chaveCadastro) || itens.find((item) => item.status === "aprovado") || itens[0];
    if (!titular.chaveCadastro) definir.push({ _id: titular._id, chave: documentoDe(titular.petshop) });
    if (itens.length > 1) {
      duplicidades.push({
        distribuidor: titular.distribuidorNome,
        petshop: titular.petshop?.nomeFantasia,
        titular: { protocolo: titular.protocolo, status: titular.status },
        sinalizados: itens.filter((item) => item !== titular).map((item) => ({ _id: item._id, protocolo: item.protocolo, status: item.status, titularId: titular._id, jaSinalizado: Boolean(item.duplicidadeLegada) })),
      });
    }
  }
  return { definir, duplicidades };
};

// Somente leitura: o que a migração faria e se os dados permitem fazê-la.
export const analisarMultiplosCupons = async () => {
  const [estado, invariantes, semLote, indice, plano, distribuicoes] = await Promise.all([
    NatalCampanhaEstado.findById(CAMPANHA).select("modoCumulativo multiplosCupons listaFechada").lean(),
    verificarInvariantes(),
    NatalParticipacao.find({ cupons: { $exists: false } }).select("status cupom").lean(),
    indiceUnicoAntigo(),
    planejarChaves(),
    NatalDistribuicao.countDocuments({}),
  ]);
  const porStatus = semLote.reduce((mapa, item) => ({ ...mapa, [item.status]: (mapa[item.status] || 0) + 1 }), {});
  return {
    banco: NatalConta.db?.name,
    estado: {
      modoCumulativo: estado?.modoCumulativo || "legado",
      multiplosCupons: Boolean(estado?.multiplosCupons),
      listaFechada: Boolean(estado?.listaFechada),
      indiceUnicoAntigo: indice?.name || null,
      lotesDeDistribuicao: distribuicoes,
    },
    previsto: {
      lotesHistoricosACriar: semLote.length,
      cadastrosAntigosPorStatus: porStatus,
      cuponsAntigosAAssociar: semLote.filter((item) => item.cupom?.numero).length,
      chavesDeDocumentoADefinir: plano.definir.length,
      duplicidadesASinalizar: plano.duplicidades.reduce((soma, item) => soma + item.sinalizados.filter((sinalizado) => !sinalizado.jaSinalizado).length, 0),
      removerIndiceUnicoAntigo: Boolean(indice),
    },
    duplicidades: plano.duplicidades.map((item) => ({ ...item, sinalizados: item.sinalizados.map(({ _id, titularId, ...resto }) => resto) })),
    invariantes,
    podeMigrar: invariantes.ok && estado?.modoCumulativo === "ativo",
  };
};

const resumoComparavel = (invariantes) => JSON.stringify({
  totais: invariantes.totais,
  distribuidores: invariantes.distribuidores.map(({ clienteId, concedidos, contaAprovados, contaPendentes, cuponsValidos, unidadesPendentes, cancelados, rejeitados, invalidados }) => (
    { clienteId, concedidos, contaAprovados, contaPendentes, cuponsValidos, unidadesPendentes, cancelados, rejeitados, invalidados }
  )).sort((a, b) => a.clienteId.localeCompare(b.clienteId)),
});

// Etapa 1 (gravação, idempotente): lotes históricos, chaves de documento e índices.
// Interrompe sem gravar se as invariantes falharem; confere tudo de novo no fim.
export const migrarMultiplosCupons = async ({ operador, now = new Date() }) => {
  const antes = await verificarInvariantes();
  if (!antes.ok) {
    const erro = new NatalError(409, "Invariantes falharam antes da migração. Nada foi gravado.", "invariantes");
    erro.problemas = antes.erros;
    throw erro;
  }
  const estado = await NatalCampanhaEstado.findById(CAMPANHA).select("modoCumulativo").lean();
  if (estado?.modoCumulativo !== "ativo") throw new NatalError(409, "Migre para múltiplos cupons somente com o modelo cumulativo ativo.", "modo_invalido");
  const fotoAntes = await fotografarCupons();

  return executarEtapa({ etapa: "multiplos_migracao", operador, now, acaoAuditoria: "migracao_multiplos_cupons" }, async () => {
    const autor = { usuarioTipo: "sistema", usuarioNome: `Migração múltiplos cupons (${operador})`.slice(0, 160) };
    const indice = await indiceUnicoAntigo();
    if (indice) await NatalCupom.collection.dropIndex(indice.name);
    await garantirIndicesNatal();

    let lotesCriados = 0;
    const semLote = await NatalParticipacao.find({ cupons: { $exists: false } }).select("_id").lean();
    for (const { _id } of semLote) {
      const resultado = await executarTransacaoNatal(async (session) => {
        const participacao = await NatalParticipacao.findById(_id).session(session);
        return garantirDistribuicaoLegada({ participacao, session, now, autor });
      });
      if (resultado.criada) lotesCriados += 1;
    }

    const plano = await planejarChaves();
    let chavesDefinidas = 0;
    for (const item of plano.definir) {
      const resultado = await NatalParticipacao.updateOne(
        { _id: item._id, chaveCadastro: { $exists: false }, status: { $in: ESTADOS_ATIVOS } },
        { $set: { chaveCadastro: item.chave } }
      );
      chavesDefinidas += resultado.modifiedCount;
    }
    let sinalizados = 0;
    for (const grupo of plano.duplicidades) {
      for (const item of grupo.sinalizados) {
        const resultado = await NatalParticipacao.updateOne(
          { _id: item._id, duplicidadeLegada: { $ne: true } },
          {
            $set: { duplicidadeLegada: true },
            $push: {
              alertas: { tipo: "mesmo_documento_distribuidor", participacaoId: item.titularId, protocolo: grupo.titular.protocolo, detectadoEm: now },
              historico: { acao: "alerta_duplicidade", em: now, autor, detalhes: `Mesmo CPF/CNPJ do cadastro ${grupo.titular.protocolo} neste distribuidor. Os novos lotes vão para aquele cadastro; este segue como está para análise.` },
            },
          }
        );
        sinalizados += resultado.modifiedCount;
      }
    }

    const depois = await verificarInvariantes();
    const fotoDepois = await fotografarCupons();
    const resumo = {
      indiceRemovido: indice?.name || null,
      lotesHistoricosCriados: lotesCriados,
      chavesDefinidas,
      duplicidadesSinalizadas: sinalizados,
      dadosOriginaisInalterados: fotoAntes === fotoDepois,
      invariantesIguais: resumoComparavel(antes) === resumoComparavel(depois),
      invariantesDepois: { ok: depois.ok, erros: depois.erros, avisos: depois.avisos, totais: depois.totais },
    };
    if (!resumo.dadosOriginaisInalterados || !resumo.invariantesIguais || !depois.ok) {
      const erro = new NatalError(500, "A conferência após a migração falhou. Os múltiplos cupons continuam desligados; analise o relatório.", "conferencia_falhou");
      erro.problemas = resumo;
      throw erro;
    }
    return resumo;
  });
};

// Etapa 2: liga os múltiplos cupons. Exige a migração concluída e as invariantes íntegras.
export const ativarMultiplosCupons = async ({ operador, now = new Date() }) => executarEtapa(
  { etapa: "multiplos_ativacao", operador, now, acaoAuditoria: "migracao_multiplos_cupons" },
  async () => {
    const [indice, pendentesDeMigracao, invariantes] = await Promise.all([
      indiceUnicoAntigo(),
      NatalParticipacao.countDocuments({ cupons: { $exists: false } }),
      verificarInvariantes(),
    ]);
    if (indice) throw new NatalError(409, "O índice único antigo ainda existe. Execute a migração antes.", "migracao_pendente");
    if (pendentesDeMigracao > 0) throw new NatalError(409, `${pendentesDeMigracao} cadastro(s) sem lote histórico. Execute a migração antes.`, "migracao_pendente");
    if (!invariantes.ok) {
      const erro = new NatalError(409, "Invariantes falharam. Os múltiplos cupons continuam desligados.", "invariantes");
      erro.problemas = invariantes.erros;
      throw erro;
    }
    await NatalCampanhaEstado.updateOne({ _id: CAMPANHA }, { $set: { multiplosCupons: true, multiplosCuponsAlteradoEm: now } }, { upsert: true });
    return { multiplosCupons: true, totais: invariantes.totais };
  }
);

// Reversão: volta a 1 cupom por envio. Cadastros, lotes e cupons já emitidos ficam como estão.
export const desativarMultiplosCupons = async ({ operador, motivo, now = new Date() }) => {
  const texto = typeof motivo === "string" ? motivo.trim() : "";
  if (texto.length < 10) throw new NatalError(400, "Informe o motivo da reversão (mínimo de 10 caracteres).", "motivo_invalido");
  return executarEtapa({ etapa: "multiplos_desativacao", operador, now, acaoAuditoria: "migracao_multiplos_cupons" }, async () => {
    await NatalCampanhaEstado.updateOne({ _id: CAMPANHA }, { $set: { multiplosCupons: false, multiplosCuponsAlteradoEm: now } });
    return { multiplosCupons: false, motivo: texto, totais: (await verificarInvariantes()).totais };
  });
};
