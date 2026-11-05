import crypto from "node:crypto";
import { NATAL_2026 } from "../config/natalPremiado2026.js";
import NatalAuditoria from "../models/NatalAuditoria.js";
import { NatalCampanhaEstado } from "../models/NatalCampanhaEstado.js";
import NatalConta from "../models/NatalConta.js";
import NatalCupom from "../models/NatalCupom.js";
import NatalLote from "../models/NatalLote.js";
import NatalMigracaoExecucao from "../models/NatalMigracaoExecucao.js";
import NatalMovimentoCupom from "../models/NatalMovimentoCupom.js";
import NatalParticipacao from "../models/NatalParticipacao.js";
import NatalSubstituicaoCompra from "../models/NatalSubstituicaoCompra.js";
import Pedido from "../models/Pedido.js";
import { calcularFaixa, STATUS_FORA_DA_CAMPANHA } from "../utils/natalCampanha.js";
import { calcularEstadoCumulativo, paraCentavos, paraReais } from "../utils/natalCumulativo.js";
import { garantirIndicesNatal, NatalError, obterModoCumulativo } from "./natalBaseService.js";
import { cuponsAutomaticos, garantirConta, recalcularConta, recalcularContadoresConta } from "./natalContaService.js";

// Ativação controlada do modelo cumulativo, sempre por procedimento explícito:
//   analisarMigracao / validarIntegridade: somente leitura.
//   executarMigracao: cria contas e reconhece lotes, sem conceder nada.
//   concederBeneficios: libera diferenças e calcula bonificações.
//   ativarCumulativo: passa a usar o saldo por distribuidor.
//   reverterModo: volta ao modelo legado sem apagar nada.
// Só as coleções novas recebem gravação: lotes, cupons, cadastros, pedidos e auditoria
// antiga ficam intactos. Toda etapa pode ser repetida sem duplicar efeitos.

const CAMPOS_PEDIDO = "numeroPedido clienteId nomeFantasiaCliente razaoSocialCliente valorTotal status createdAt itens.nomeProduto itens.quantidade itens.valorUnitario itens.subtotal";

const contagemPorStatus = (lista, chave = "status") => lista.reduce((mapa, item) => {
  mapa[item[chave]] = (mapa[item[chave]] || 0) + 1;
  return mapa;
}, {});

// Pedido operacional montado com item de valor simbólico para compor a faixa.
const itensSimbolicos = (pedido) => (pedido?.itens || []).filter((item) => (
  Number(item.valorUnitario) <= 1 && Number(item.subtotal) >= 100
));

const diagnosticarLote = (lote, pedido, participacoes, cupons) => {
  const divergencias = [];
  const adicionar = (codigo, descricao, gravidade = "revisar") => divergencias.push({ codigo, gravidade, descricao, pedido: lote.numeroPedido });
  const aprovadas = participacoes.filter((item) => item.status === "aprovado").length;
  const pendentes = participacoes.filter((item) => item.status === "pendente").length;
  const validos = cupons.filter((item) => item.status === "valido").length;

  if (!pedido) adicionar("pedido_ausente", "O lote aponta para um pedido que não existe mais.");
  else if (pedido.status === "cancelado" && lote.status === "ativo") adicionar("lote_ativo_pedido_cancelado", "Lote ativo com pedido cancelado.");
  if (pedido && paraCentavos(pedido.valorTotal) !== paraCentavos(lote.valorAtual)) {
    adicionar("valor_divergente", `Lote com ${lote.valorAtual} e pedido com ${pedido.valorTotal}.`);
  }
  const faixaEsperada = calcularFaixa(lote.valorAtual)?.cupons || 0;
  if (lote.status === "ativo" && Number(lote.cuponsConcedidos) !== faixaEsperada) {
    adicionar("cupons_fora_da_faixa", `Lote com ${lote.cuponsConcedidos} cupons; a faixa do valor atual daria ${faixaEsperada}.`);
  }
  if (Number(lote.contadores?.aprovados || 0) !== aprovadas || Number(lote.contadores?.pendentes || 0) !== pendentes) {
    adicionar("contadores_divergentes", `Contadores do lote (${lote.contadores?.aprovados || 0}/${lote.contadores?.pendentes || 0}) diferem dos cadastros (${aprovadas}/${pendentes}).`);
  }
  if (validos !== aprovadas) adicionar("cupons_diferem_de_aprovados", `${validos} cupons válidos para ${aprovadas} cadastros aprovados.`);
  if (aprovadas > Number(lote.cuponsConcedidos)) adicionar("aprovados_acima_do_concedido", `${aprovadas} aprovados para ${lote.cuponsConcedidos} concedidos.`);
  if (lote.revisaoPendente) adicionar("revisao_pendente_antiga", "Lote com redução sem decisão administrativa.");
  if (itensSimbolicos(pedido).length > 0) {
    adicionar("pedido_simbolico", "Pedido composto por item de valor unitário simbólico. Soma no acumulado e não será alterado.");
  }
  return divergencias;
};

const mascararCodigo = (codigo) => `${String(codigo).slice(0, 4)}…${String(codigo).slice(-3)}`;

// Levantamento completo, sem nenhuma gravação.
export const analisarMigracao = async ({ config = NATAL_2026 } = {}) => {
  const substituidos = await NatalSubstituicaoCompra.find({ campanha: config.slug }).select("pedidoId").lean();
  const [lotes, participacoes, cupons, contas, pedidosContabilizados, totalAuditoria] = await Promise.all([
    NatalLote.find({}).lean(),
    NatalParticipacao.find({}).select("loteId clienteId status comprovante.chave cupom.numero").lean(),
    NatalCupom.find({}).select("loteId clienteId status numero").lean(),
    NatalConta.find({ campanha: config.slug }).lean(),
    Pedido.find({
      _id: { $nin: substituidos.map((item) => item.pedidoId) },
      status: { $nin: STATUS_FORA_DA_CAMPANHA },
      createdAt: { $gte: config.inicio, $lte: config.fimCadastros },
    }).select(CAMPOS_PEDIDO).lean(),
    NatalAuditoria.countDocuments({}),
  ]);
  const pedidosDosLotes = await Pedido.find({ _id: { $in: lotes.map((lote) => lote.pedidoId) } }).select(CAMPOS_PEDIDO).lean();
  const pedidoPorId = new Map([...pedidosDosLotes, ...pedidosContabilizados].map((pedido) => [String(pedido._id), pedido]));

  const ids = new Set([...lotes, ...pedidosContabilizados].map((item) => String(item.clienteId)));
  const distribuidores = [...ids].map((clienteId) => {
    const lotesCliente = lotes.filter((lote) => String(lote.clienteId) === clienteId);
    const participacoesCliente = participacoes.filter((item) => String(item.clienteId) === clienteId);
    const cuponsCliente = cupons.filter((item) => String(item.clienteId) === clienteId);
    const compras = pedidosContabilizados.filter((pedido) => String(pedido.clienteId) === clienteId);
    const totalCompras = compras.reduce((soma, pedido) => soma + paraCentavos(pedido.valorTotal), 0);
    const estado = calcularEstadoCumulativo(totalCompras, config);
    const legado = lotesCliente.filter((lote) => lote.status === "ativo").reduce((soma, lote) => soma + Number(lote.cuponsConcedidos || 0), 0);
    const aprovadas = participacoesCliente.filter((item) => item.status === "aprovado").length;

    const divergencias = lotesCliente.flatMap((lote) => diagnosticarLote(
      lote,
      pedidoPorId.get(String(lote.pedidoId)),
      participacoesCliente.filter((item) => String(item.loteId) === String(lote._id)),
      cuponsCliente.filter((item) => String(item.loteId) === String(lote._id))
    ));
    if (legado > estado.cuponsDevidos) {
      divergencias.push({ codigo: "legado_acima_do_calculo", gravidade: "revisar", descricao: `${legado} cupons concedidos; o novo cálculo dá ${estado.cuponsDevidos}. Nada é retirado.` });
    }
    if (legado > 0 && estado.cuponsDevidos > legado) {
      divergencias.push({ codigo: "direito_acima_do_legado", gravidade: "informativo", descricao: `Novo cálculo dá ${estado.cuponsDevidos}; ${legado} já concedidos. A migração libera só a diferença.` });
    }

    const nome = lotesCliente[0]?.distribuidorNome || compras[0]?.nomeFantasiaCliente || compras[0]?.razaoSocialCliente;
    return {
      clienteId,
      distribuidor: nome,
      antes: {
        links: lotesCliente.map((lote) => ({
          codigo: mascararCodigo(lote.codigoPublico),
          pedido: lote.numeroPedido,
          pedidoStatus: pedidoPorId.get(String(lote.pedidoId))?.status || "ausente",
          status: lote.status,
          valorAtual: lote.valorAtual,
          cuponsConcedidos: lote.cuponsConcedidos,
        })),
        cuponsConcedidos: legado,
        participacoes: contagemPorStatus(participacoesCliente),
        cupons: contagemPorStatus(cuponsCliente),
      },
      depois: {
        cuponsLegados: legado,
        comprasContabilizadas: paraReais(totalCompras),
        cuponsDevidos: estado.cuponsDevidos,
        cuponsLiberadosNaMigracao: Math.max(estado.cuponsDevidos - legado, 0),
        saldoTotal: Math.max(legado, estado.cuponsDevidos),
        saldoDisponivel: Math.max(Math.max(legado, estado.cuponsDevidos) - aprovadas, 0),
        bonificacaoProdutos: paraReais(estado.produtosDevidoCentavos),
        bonificacaoMarketing: paraReais(estado.marketingDevidoCentavos),
      },
      divergencias,
    };
  }).sort((a, b) => b.antes.cuponsConcedidos - a.antes.cuponsConcedidos);

  return {
    geradoEm: new Date().toISOString(),
    simulacaoId: crypto.randomUUID(),
    modoAtual: await obterModoCumulativo(),
    totais: {
      distribuidores: distribuidores.length,
      distribuidoresComLink: new Set(lotes.map((lote) => String(lote.clienteId))).size,
      links: lotes.length,
      linksAtivos: lotes.filter((lote) => lote.status === "ativo").length,
      cuponsConcedidosNosLotes: lotes.filter((lote) => lote.status === "ativo").reduce((soma, lote) => soma + Number(lote.cuponsConcedidos || 0), 0),
      numerosDeCupomEmitidos: cupons.length,
      cuponsPorStatus: contagemPorStatus(cupons),
      participacoes: participacoes.length,
      participacoesPorStatus: contagemPorStatus(participacoes),
      comprovantes: participacoes.filter((item) => item.comprovante?.chave).length,
      registrosAuditoria: totalAuditoria,
      contasExistentes: contas.length,
    },
    distribuidores,
    divergencias: distribuidores.flatMap((item) => item.divergencias.map((divergencia) => ({ distribuidor: item.distribuidor, ...divergencia }))),
  };
};

// Foto das identidades originais, para provar que nada mudou antes e depois.
export const fotografarDadosOriginais = async () => {
  const [lotes, cupons, participacoes] = await Promise.all([
    NatalLote.find({}).select("codigoPublico pedidoId clienteId cuponsConcedidos status").sort({ _id: 1 }).lean(),
    NatalCupom.find({}).select("numero codigo status participacaoId loteId").sort({ numero: 1 }).lean(),
    NatalParticipacao.find({}).select("protocolo status cupom.numero loteId pedidoId clienteId").sort({ _id: 1 }).lean(),
  ]);
  return JSON.stringify({ lotes, cupons, participacoes });
};

const hashDosDados = (foto) => crypto.createHash("sha256").update(foto).digest("hex");

const clientesDaCampanha = async (config) => {
  const [lotes, pedidos, contas] = await Promise.all([
    NatalLote.find({}).select("clienteId").lean(),
    Pedido.find({
      status: { $nin: STATUS_FORA_DA_CAMPANHA },
      createdAt: { $gte: config.inicio, $lte: config.fimCadastros },
    }).select("clienteId").lean(),
    NatalConta.find({ campanha: config.slug }).select("clienteId").lean(),
  ]);
  return [...new Set([...lotes, ...pedidos, ...contas].map((item) => String(item.clienteId)))];
};

// Conferência somente leitura das contas contra os registros de origem.
export const validarIntegridade = async ({ config = NATAL_2026 } = {}) => {
  const [lotes, contas, participacoes, cupons, movimentos] = await Promise.all([
    NatalLote.find({}).select("clienteId status cuponsConcedidos").lean(),
    NatalConta.find({ campanha: config.slug }).lean(),
    NatalParticipacao.find({}).select("clienteId status").lean(),
    NatalCupom.find({}).select("clienteId status numero").lean(),
    NatalMovimentoCupom.find({ campanha: config.slug }).select("clienteId quantidade").lean(),
  ]);
  const problemas = [];
  const contasPorCliente = new Map(contas.map((conta) => [String(conta.clienteId), conta]));
  const adicionar = (codigo, clienteId, descricao) => problemas.push({ codigo, clienteId: String(clienteId), descricao });

  for (const lote of lotes) {
    const conta = contasPorCliente.get(String(lote.clienteId));
    if (!conta) adicionar("conta_ausente", lote.clienteId, "Lote sem conta do distribuidor.");
    else if (!conta.lotesImportados.some((id) => String(id) === String(lote._id))) adicionar("lote_nao_importado", lote.clienteId, `Lote ${lote._id} não importado.`);
  }
  for (const clienteId of new Set(participacoes.map((item) => String(item.clienteId)))) {
    if (!contasPorCliente.has(clienteId)) adicionar("conta_ausente", clienteId, "Cadastros sem conta do distribuidor.");
  }

  for (const conta of contas) {
    const clienteId = String(conta.clienteId);
    const daConta = (item) => String(item.clienteId) === clienteId;
    const aprovados = participacoes.filter((item) => daConta(item) && item.status === "aprovado").length;
    const pendentes = participacoes.filter((item) => daConta(item) && item.status === "pendente").length;
    const cuponsValidos = cupons.filter((item) => daConta(item) && item.status === "valido").length;
    const somaMovimentos = movimentos.filter(daConta).reduce((soma, item) => soma + item.quantidade, 0);
    const legado = lotes.filter((lote) => String(lote.clienteId) === clienteId && lote.status === "ativo")
      .reduce((soma, lote) => soma + Number(lote.cuponsConcedidos || 0), 0);
    const total = Number(conta.cupons?.total || 0);

    if (total !== cuponsAutomaticos(conta) + Number(conta.cupons?.ajustes || 0)) adicionar("total_incoerente", clienteId, "Total difere da soma das parcelas.");
    if (somaMovimentos !== total) adicionar("extrato_divergente", clienteId, `Extrato soma ${somaMovimentos}; saldo é ${total}.`);
    if (Number(conta.cupons?.legado || 0) !== legado) adicionar("legado_divergente", clienteId, `Conta com ${conta.cupons?.legado}; lotes ativos somam ${legado}.`);
    if (Number(conta.contadores?.aprovados || 0) !== aprovados) adicionar("aprovados_divergentes", clienteId, `Conta com ${conta.contadores?.aprovados}; cadastros somam ${aprovados}.`);
    if (Number(conta.contadores?.pendentes || 0) !== pendentes) adicionar("pendentes_divergentes", clienteId, `Conta com ${conta.contadores?.pendentes}; cadastros somam ${pendentes}.`);
    if (cuponsValidos !== aprovados) adicionar("cupons_diferem_de_aprovados", clienteId, `${cuponsValidos} cupons válidos para ${aprovados} aprovados.`);
    if (aprovados > total) adicionar("aprovados_acima_do_saldo", clienteId, `${aprovados} aprovados para saldo de ${total}.`);
  }
  if (new Set(cupons.map((item) => item.numero)).size !== cupons.length) adicionar("numero_cupom_repetido", "campanha", "Há números de cupom repetidos.");

  return {
    ok: problemas.length === 0,
    problemas,
    conferencia: {
      contas: contas.length,
      lotes: lotes.length,
      cupons: cupons.length,
      participacoes: participacoes.length,
      saldoTotal: contas.reduce((soma, conta) => soma + Number(conta.cupons?.total || 0), 0),
    },
  };
};

// Registra a execução e impede duas ao mesmo tempo. Falha fica no histórico.
const executarEtapa = async ({ etapa, operador, now }, operacao) => {
  await garantirIndicesNatal();
  const execucaoId = crypto.randomUUID();
  try {
    await NatalMigracaoExecucao.create({ execucaoId, etapa, operador, emAndamento: true, iniciadaEm: now });
  } catch (error) {
    if (error?.code === 11000) throw new NatalError(409, "Já existe uma etapa da migração em andamento.", "migracao_em_andamento");
    throw error;
  }
  try {
    const resumo = await operacao(execucaoId);
    await NatalMigracaoExecucao.updateOne({ execucaoId }, { $set: { status: "concluida", concluidaEm: new Date(), resumo }, $unset: { emAndamento: 1 } });
    await NatalAuditoria.create({
      acao: "migracao_cumulativa",
      em: now,
      autor: { usuarioTipo: "sistema", usuarioNome: operador },
      detalhes: { execucaoId, etapa, resumo },
    });
    return { execucaoId, ...resumo };
  } catch (error) {
    await NatalMigracaoExecucao.updateOne(
      { execucaoId },
      { $set: { status: "falhou", concluidaEm: new Date(), erro: String(error?.message || error).slice(0, 500) }, $unset: { emAndamento: 1 } }
    );
    throw error;
  }
};

const definirModo = (modo, now) => NatalCampanhaEstado.updateOne(
  { _id: NATAL_2026.slug },
  { $set: { modoCumulativo: modo, modoAlteradoEm: now } },
  { upsert: true }
);

const exigirModo = async (permitidos) => {
  const modo = await obterModoCumulativo();
  if (!permitidos.includes(modo)) {
    throw new NatalError(409, `Etapa indisponível no modo "${modo}".`, "modo_invalido");
  }
  return modo;
};

// Etapa 1. Pausa cadastros e aprovações, cria as contas e reconhece os lotes. Não
// concede nada: benefícios só mudam na etapa 2. Pode ser repetida sem duplicar.
export const executarMigracao = async ({ operador = "Migração", config = NATAL_2026, now = new Date() } = {}) => {
  await garantirIndicesNatal();
  await exigirModo(["legado", "migrando"]);
  return executarEtapa({ etapa: "migracao", operador, now }, async () => {
    await definirModo("migrando", now);
    const hashAntes = hashDosDados(await fotografarDadosOriginais());
    const movimentosAntes = await NatalMovimentoCupom.countDocuments({});
    const contasAntes = await NatalConta.countDocuments({ campanha: config.slug });
    const clientes = await clientesDaCampanha(config);
    for (const clienteId of clientes) {
      await garantirConta({ clienteId, now });
      await recalcularContadoresConta(clienteId);
    }
    const hashDepois = hashDosDados(await fotografarDadosOriginais());
    const integridade = await validarIntegridade({ config });
    return {
      distribuidores: clientes.length,
      contasCriadas: await NatalConta.countDocuments({ campanha: config.slug }) - contasAntes,
      movimentosCriados: await NatalMovimentoCupom.countDocuments({}) - movimentosAntes,
      dadosOriginaisInalterados: hashAntes === hashDepois,
      hashDados: hashDepois,
      integridade,
    };
  });
};

const processarBeneficios = async ({ execucaoId, config, now }) => {
  const clientes = await clientesDaCampanha(config);
  const concessoes = [];
  for (const clienteId of clientes) {
    const { conta, cuponsLiberados, complementos } = await recalcularConta({
      clienteId,
      origem: { tipo: "ativacao", referencia: execucaoId },
      now,
      config,
      processamentoAutorizado: true,
    });
    if (cuponsLiberados > 0 || complementos.length > 0) {
      concessoes.push({ clienteId, distribuidor: conta.distribuidorNome, cuponsLiberados, cuponsTotal: conta.cupons.total, complementos: complementos.length });
    }
  }
  return {
    distribuidores: clientes.length,
    cuponsLiberados: concessoes.reduce((soma, item) => soma + item.cuponsLiberados, 0),
    concessoes,
  };
};

// Etapa 2. Único caminho que libera os benefícios históricos. Repetir não concede de novo.
export const concederBeneficios = async ({ operador = "Migração", config = NATAL_2026, now = new Date() } = {}) => {
  await exigirModo(["migrando"]);
  return executarEtapa({ etapa: "concessao", operador, now }, (execucaoId) => processarBeneficios({ execucaoId, config, now }));
};

// Etapa 3. Só ativa com a conferência limpa. A troca de modo encerra o modelo legado;
// a passada final cobre pedidos aprovados entre a concessão e este momento.
export const ativarCumulativo = async ({ operador = "Migração", config = NATAL_2026, now = new Date() } = {}) => {
  await exigirModo(["migrando"]);
  return executarEtapa({ etapa: "ativacao", operador, now }, async (execucaoId) => {
    const contas = await NatalConta.find({ campanha: config.slug }).select("clienteId").lean();
    for (const conta of contas) await recalcularContadoresConta(conta.clienteId);
    const integridade = await validarIntegridade({ config });
    if (!integridade.ok) {
      const error = new NatalError(409, `Ativação recusada: ${integridade.problemas.length} problema(s) de integridade.`, "integridade_invalida");
      error.problemas = integridade.problemas;
      throw error;
    }
    await definirModo("ativo", now);
    const final = await processarBeneficios({ execucaoId, config, now });
    return { integridade, cuponsLiberadosNaAtivacao: final.cuponsLiberados, concessoes: final.concessoes };
  });
};

// Volta ao modelo legado sem apagar contas, cupons ou cadastros criados depois da
// ativação. O resumo aponta o que depende do saldo por distribuidor para revisão.
export const reverterModo = async ({ operador = "Migração", motivo, config = NATAL_2026, now = new Date() } = {}) => {
  const texto = typeof motivo === "string" ? motivo.trim() : "";
  if (texto.length < 10) throw new NatalError(400, "Informe o motivo da reversão (mínimo de 10 caracteres).", "motivo_invalido");
  const modoAnterior = await exigirModo(["migrando", "ativo"]);
  return executarEtapa({ etapa: "reversao", operador, now }, async () => {
    await definirModo("legado", now);
    const contas = await NatalConta.find({ campanha: config.slug }).select("clienteId distribuidorNome cupons contadores").lean();
    const lotes = await NatalLote.find({}).select("clienteId cuponsConcedidos contadores status").lean();
    const excedidos = lotes.filter((lote) => Number(lote.contadores?.aprovados || 0) > Number(lote.cuponsConcedidos || 0));
    return {
      motivo: texto,
      modoAnterior,
      contasPreservadas: contas.length,
      cadastrosEmLinkProprio: await NatalParticipacao.countDocuments({ loteId: { $exists: false } }),
      lotesComAprovadosAcimaDoConcedido: excedidos.length,
    };
  });
};

export const listarExecucoes = () => NatalMigracaoExecucao.find({}).sort({ iniciadaEm: -1 }).limit(50).lean();

// Trava presa após queda do processo. Nunca roda sozinha: exige comando do operador.
export const liberarTrava = () => NatalMigracaoExecucao.updateMany(
  { emAndamento: true },
  { $set: { status: "falhou", erro: "Trava liberada pelo operador", concluidaEm: new Date() }, $unset: { emAndamento: 1 } }
);
