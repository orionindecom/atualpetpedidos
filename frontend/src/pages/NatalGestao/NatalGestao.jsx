import { useCallback, useEffect, useState } from "react";
import api from "../../api/axios";
import EmptyState from "../../components/AdminUi/EmptyState";
import ui from "../../components/AdminUi/AdminUi.module.css";
import GestaoDistribuidores from "../../components/NatalBeneficios/GestaoDistribuidores";
import { LinkParticipacao } from "../../components/NatalBeneficios/NatalBeneficios";
import ParticipacaoModal from "../../components/NatalBeneficios/ParticipacaoModal";
import RevisoesLote from "../../components/NatalBeneficios/RevisoesLote";
import styles from "../../components/NatalBeneficios/NatalInterno.module.css";
import { useFeedback } from "../../components/Feedback/feedbackContext";
import Navbar from "../../components/Navbar/Navbar";
import PageHeader from "../../components/PageHeader/PageHeader";
import { getApiErrorMessage } from "../../utils/apiErrors";
import { getAuthSession } from "../../utils/authSession";
import {
  descreverPendenciaSincronizacao,
  FAIXA_EVENTO_LABELS,
  formatDocumentoBR,
  formatDateBR,
  formatDateTimeBR,
  formatMoney,
  PARTICIPACAO_STATUS_LABELS,
  PARTICIPACAO_STATUS_TONES,
} from "../../utils/natalPremiado";

const ABAS = [
  ["geral", "Visão geral"],
  ["distribuidores", "Distribuidores"],
  ["participacoes", "Participações"],
  ["lotes", "Links de pedidos"],
  ["sorteio", "Sorteio"],
];

const FILTROS_INICIAIS = {
  distribuidor: "", pedido: "", petshop: "", documento: "", vendedor: "", cupom: "",
  status: "", dataInicio: "", dataFim: "", comAlertas: "", ordem: "", pagina: 1,
};

const baixarArquivo = async (endpoint, nomePadrao) => {
  const response = await api.get(endpoint, { responseType: "blob", timeout: 120000 });
  const disposicao = response.headers["content-disposition"] || "";
  const nome = /filename="([^"]+)"/.exec(disposicao)?.[1] || nomePadrao;
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  return Number(response.headers["x-total-cupons"] || 0);
};

// Aparece só com divergência real entre o saldo gravado e os registros da campanha.
function AlertaSincronizacao({ pendencias, isAdmin, reconciliando, onReconciliar }) {
  if (!pendencias?.length) return null;
  return (
    <div className={ui.feedback} data-type="warning" role="status">
      <span>
        {pendencias.length === 1 ? "1 distribuidor precisa" : `${pendencias.length} distribuidores precisam`} de reconciliação de saldos: {pendencias.map(descreverPendenciaSincronizacao).join("; ")}.
        {!isAdmin && " Peça ao Administrador para reconciliar."}
      </span>
      {isAdmin && (
        <button type="button" disabled={reconciliando} onClick={onReconciliar}>
          {reconciliando ? "Reconciliando…" : "Reconciliar saldos"}
        </button>
      )}
    </div>
  );
}

function VisaoGeral({ painel, onAbrirDistribuidores }) {
  const i = painel.indicadores;
  return (
    <>
      <div className={styles.kpis}>
        <div className={styles.kpi}><span>Distribuidores participantes</span><strong>{i.distribuidoresParticipantes}</strong></div>
        <div className={styles.kpi}><span>Compras acumuladas</span><strong>{formatMoney(i.comprasAcumuladas)}</strong></div>
        <div className={styles.kpi}><span>Cupons concedidos</span><strong>{i.cuponsConcedidos}</strong></div>
        <div className={styles.kpi} data-tone="success"><span>Participações aprovadas</span><strong>{i.participacoesAprovadas}</strong></div>
        <div className={styles.kpi} data-tone="accent"><span>Participações pendentes</span><strong>{i.participacoesPendentes}</strong></div>
        <div className={styles.kpi} data-tone="danger"><span>Participações rejeitadas</span><strong>{i.participacoesRejeitadas}</strong></div>
        <div className={styles.kpi}><span>Participações canceladas</span><strong>{i.participacoesCanceladas}</strong></div>
        <div className={styles.kpi}><span>Cupons disponíveis</span><strong>{i.cuponsDisponiveis}</strong></div>
        <div className={styles.kpi}><span>Cupons invalidados</span><strong>{i.cuponsInvalidados + i.cuponsCancelados}</strong></div>
        <div className={styles.kpi}><span>Invalidadas por revisão de faixa</span><strong>{i.participacoesInvalidadasRevisao}</strong></div>
      </div>
      {i.contasComRevisaoPendente > 0 && (
        <div className={ui.feedback} data-type="warning" role="note">
          {i.contasComRevisaoPendente} distribuidor(es) com redução sem decisão administrativa. Veja a aba Distribuidores.
        </div>
      )}
      <p className={styles.muted}>
        Cupons válidos para o sorteio: <strong>{i.cuponsValidos}</strong>. Invalidados (pedido cancelado ou revisão de faixa): {i.cuponsInvalidados}; cancelados: {i.cuponsCancelados}; links de pedidos invalidados: {i.lotesInvalidados}.
      </p>
      <section className={styles.secao} style={{ marginTop: 20 }}>
        <div className={styles.secaoTitulo}>
          <h2>Resultado por distribuidor</h2>
          <button type="button" className={ui.ghostButton} onClick={onAbrirDistribuidores}>Ver detalhes</button>
        </div>
        {painel.porDistribuidor.length === 0 ? (
          <EmptyState headingLevel={3} title="Nenhum distribuidor participante" description="Distribuidores aparecem aqui quando têm pedidos aprovados, compras externas ou links da campanha." />
        ) : (
          <div className={styles.rolagem}>
            <table className={styles.tabelaSimples}>
              <thead>
                <tr><th>Distribuidor</th><th>Compras</th><th>Ciclos</th><th>Cupons</th><th>Aprovados</th><th>Pendentes</th><th>Rejeitados</th><th>Cancelados</th><th>Disponíveis</th></tr>
              </thead>
              <tbody>
                {painel.porDistribuidor.map((linha) => (
                  <tr key={linha.clienteId}>
                    <td>{linha.distribuidorNome}</td>
                    <td>{formatMoney(linha.compras.total)}</td>
                    <td>{linha.compras.ciclosConcluidos}</td>
                    <td>{linha.cupons.total}</td>
                    <td>{linha.cupons.utilizados}</td>
                    <td>{linha.cupons.pendentes}</td>
                    <td>{linha.cupons.rejeitados}</td>
                    <td>{linha.cupons.cancelados}</td>
                    <td>{linha.cupons.disponiveis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Participacoes({ usuario, onAlterado, filtroInicial }) {
  const { toast } = useFeedback();
  const [rascunho, setRascunho] = useState({ ...FILTROS_INICIAIS, ...filtroInicial });
  const [filtros, setFiltros] = useState({ ...FILTROS_INICIAIS, ...filtroInicial });
  const [lista, setLista] = useState(null);
  const [versao, setVersao] = useState(0);
  const [selecionada, setSelecionada] = useState(null);

  useEffect(() => {
    let ativo = true;
    const params = Object.fromEntries(Object.entries(filtros).filter(([, valor]) => valor !== ""));
    api.get("/natal-2026/gestao/participacoes", { params })
      .then((response) => { if (ativo) setLista(response.data); })
      .catch((error) => toast.error("Não foi possível carregar as participações", { description: getApiErrorMessage(error) }));
    return () => { ativo = false; };
  }, [filtros, versao, toast]);

  const aplicar = (event) => {
    event.preventDefault();
    setFiltros({ ...rascunho, pagina: 1 });
  };
  const limpar = () => {
    setRascunho(FILTROS_INICIAIS);
    setFiltros(FILTROS_INICIAIS);
  };
  const campo = (nome) => ({
    value: rascunho[nome],
    onChange: (event) => setRascunho((atual) => ({ ...atual, [nome]: event.target.value })),
  });

  return (
    <section className={styles.secao}>
      <form className={styles.filtros} onSubmit={aplicar} aria-label="Filtros de participações">
        <label>Distribuidor<input type="search" {...campo("distribuidor")} /></label>
        <label>Nº do pedido<input type="search" {...campo("pedido")} /></label>
        <label>Pet shop<input type="search" {...campo("petshop")} /></label>
        <label>CPF/CNPJ<input type="search" inputMode="numeric" {...campo("documento")} /></label>
        <label>Vendedor<input type="search" {...campo("vendedor")} /></label>
        <label>Nº do cupom<input type="search" inputMode="numeric" {...campo("cupom")} /></label>
        <label>
          Status
          <select {...campo("status")}>
            <option value="">Todos</option>
            {Object.entries(PARTICIPACAO_STATUS_LABELS).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
          </select>
        </label>
        <label>Recebido de<input type="date" {...campo("dataInicio")} /></label>
        <label>Recebido até<input type="date" {...campo("dataFim")} /></label>
        <label>
          Ordem
          <select {...campo("ordem")}>
            <option value="">Mais recentes</option>
            <option value="antigos">Ordem de recebimento</option>
          </select>
        </label>
        <label className={styles.filtroCheck}>
          <input
            type="checkbox"
            checked={rascunho.comAlertas === "true"}
            onChange={(event) => setRascunho((atual) => ({ ...atual, comAlertas: event.target.checked ? "true" : "" }))}
          />
          Só com alerta de duplicidade
        </label>
        <div className={styles.acoes} style={{ marginTop: 0 }}>
          <button type="button" className={ui.ghostButton} onClick={limpar}>Limpar</button>
          <button type="submit" className={ui.primaryButton}>Filtrar</button>
        </div>
      </form>

      {!lista && <p className={styles.muted} role="status">Carregando participações…</p>}
      {lista && (
        <div className={styles.secaoTitulo}><p>{lista.total} {lista.total === 1 ? "participação" : "participações"}</p></div>
      )}
      {lista && lista.itens.length === 0 && <EmptyState headingLevel={3} title="Nenhuma participação encontrada" description="Ajuste os filtros para ampliar a busca." />}
      {lista && lista.itens.length > 0 && (
        <div className={styles.tabela} role="list">
          {lista.itens.map((item) => (
            <button key={item._id} type="button" role="listitem" className={styles.linha} onClick={() => setSelecionada(item._id)}>
              <div>
                <strong>{item.petshop.nomeFantasia}</strong>
                <small>{formatDocumentoBR(item.petshop.documento)} · {item.protocolo}</small>
                {item.alertas?.length > 0 && <span className={styles.alertaIcone}>⚠ Possível duplicidade</span>}
              </div>
              <div>
                <strong>{item.distribuidorNome}</strong>
                <small>{item.numeroPedido ? `Pedido ${item.numeroPedido}` : "Link do distribuidor"} · vendedor {item.vendedorNome}</small>
              </div>
              <div>
                <small>Compra {formatDateBR(item.compra.data)} · {formatMoney(item.compra.valor)}</small>
                <small>Recebido {formatDateTimeBR(item.recebidoEm)}</small>
              </div>
              <div className={styles.linhaStatus}>
                <span className={ui.badge} data-tone={PARTICIPACAO_STATUS_TONES[item.status]}>{PARTICIPACAO_STATUS_LABELS[item.status]}</span>
                {item.cupom && <small>Cupom {item.cupom.codigo}</small>}
              </div>
            </button>
          ))}
        </div>
      )}
      {lista && lista.paginas > 1 && (
        <div className={styles.paginacao}>
          <button type="button" className={ui.secondaryButton} disabled={lista.pagina <= 1} onClick={() => setFiltros((atual) => ({ ...atual, pagina: lista.pagina - 1 }))}>Anterior</button>
          <span>Página {lista.pagina} de {lista.paginas}</span>
          <button type="button" className={ui.secondaryButton} disabled={lista.pagina >= lista.paginas} onClick={() => setFiltros((atual) => ({ ...atual, pagina: lista.pagina + 1 }))}>Próxima</button>
        </div>
      )}
      {selecionada && (
        <ParticipacaoModal
          participacaoId={selecionada}
          gestor
          usuarioTipo={usuario?.tipo}
          onClose={() => setSelecionada(null)}
          onChanged={(mensagem) => {
            toast.success(mensagem || "Participação atualizada");
            setVersao((atual) => atual + 1);
            onAlterado?.();
          }}
        />
      )}
    </section>
  );
}

function Lotes({ onVerParticipacoes }) {
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("");
  const [lotes, setLotes] = useState(null);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      api.get("/natal-2026/gestao/lotes", { params: { busca: busca || undefined, status: status || undefined } })
        .then((response) => { setLotes(response.data); setErro(""); })
        .catch((error) => setErro(getApiErrorMessage(error, "Não foi possível carregar os lotes.")));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [busca, status]);

  return (
    <section className={styles.secao}>
      <div className={styles.filtros}>
        <label>Pedido ou distribuidor<input type="search" value={busca} onChange={(event) => setBusca(event.target.value)} /></label>
        <label>
          Status do link
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Todos</option>
            <option value="ativo">Ativos</option>
            <option value="invalidado">Invalidados</option>
          </select>
        </label>
      </div>
      <p className={styles.muted}>Links gerados por pedido antes do modelo cumulativo. Continuam válidos e usam o saldo único do distribuidor.</p>
      {erro && <div className={ui.feedback} data-type="error" role="alert">{erro}</div>}
      {!lotes && !erro && <p className={styles.muted} role="status">Carregando links…</p>}
      {lotes && lotes.length === 0 && <EmptyState headingLevel={3} title="Nenhum link encontrado" description="Novos distribuidores recebem um link próprio na aba Distribuidores." />}
      <div className={styles.lotes}>
        {(lotes || []).map((lote) => (
          <article key={lote._id} className={styles.lote} data-status={lote.status}>
            <div className={styles.loteTopo}>
              <div>
                <h3>Pedido {lote.numeroPedido}</h3>
                <p>{lote.distribuidorNome} · aprovado em {formatDateBR(lote.pedidoAprovadoEm)}</p>
              </div>
              <span className={ui.badge} data-tone={lote.status === "ativo" ? "active" : "inactive"}>{lote.status === "ativo" ? "Ativo" : "Invalidado"}</span>
            </div>
            <dl className={styles.numeros}>
              <div><dt>Valor aprovado</dt><dd>{formatMoney(lote.valorAprovadoInicial)}</dd></div>
              <div><dt>Valor atual</dt><dd>{formatMoney(lote.valorAtual)}</dd></div>
              <div><dt>Faixa original</dt><dd>{lote.cuponsConcedidos > 0 ? formatMoney(lote.faixaMaxima.valorMinimo) : "Sem faixa"}</dd></div>
              <div><dt>Cupons do pedido</dt><dd>{lote.cuponsConcedidos}</dd></div>
              <div><dt>Aprovados</dt><dd>{lote.saldo.aprovados}</dd></div>
              <div><dt>Pendentes</dt><dd>{lote.saldo.pendentes}</dd></div>
              <div><dt>Rejeitados</dt><dd>{lote.saldo.rejeitados}</dd></div>
              <div><dt>Cancelados</dt><dd>{lote.saldo.cancelados}</dd></div>
              <div><dt>Invalidados (revisão)</dt><dd>{lote.saldo.invalidadosRevisao}</dd></div>
            </dl>
            {lote.status === "ativo" && <LinkParticipacao codigo={lote.codigoPublico} distribuidorNome={lote.distribuidorNome} compacto />}
            {lote.invalidacao && <p className={styles.muted}>Invalidado em {formatDateTimeBR(lote.invalidacao.em)}: {lote.invalidacao.motivo}</p>}
            <RevisoesLote revisoes={lote.revisoes} revisaoPendente={lote.revisaoPendente} gestor />
            <div className={styles.acoes}>
              <button type="button" className={ui.ghostButton} onClick={() => setAberto(aberto === lote._id ? null : lote._id)} aria-expanded={aberto === lote._id}>
                {aberto === lote._id ? "Ocultar alterações de faixa" : "Alterações de faixa"}
              </button>
              <button type="button" className={ui.secondaryButton} onClick={() => onVerParticipacoes(lote)}>Ver participações</button>
            </div>
            {aberto === lote._id && (
              <div className={styles.rolagem}>
                <table className={styles.tabelaSimples}>
                  <thead><tr><th>Data</th><th>Evento</th><th>Valor do pedido</th><th>Cupons</th><th>Responsável</th></tr></thead>
                  <tbody>
                    {lote.historicoFaixas.map((evento, indice) => (
                      <tr key={`${evento.tipo}-${indice}`}>
                        <td>{formatDateTimeBR(evento.em)}</td>
                        <td>{FAIXA_EVENTO_LABELS[evento.tipo] || evento.tipo}</td>
                        <td>{evento.valorAnterior !== undefined && evento.valorAnterior !== null ? `${formatMoney(evento.valorAnterior)} → ` : ""}{formatMoney(evento.valorPedido)}</td>
                        <td>{evento.cuponsAnterior} → {evento.cuponsNovo}{evento.acrescimo > 0 ? ` (+${evento.acrescimo})` : ""}</td>
                        <td>{evento.autorNome || "Sistema"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function Sorteio({ painel, usuario, onPainel }) {
  const { toast, dialog } = useFeedback();
  const [exportacoes, setExportacoes] = useState([]);
  const [gerando, setGerando] = useState("");
  const [numero, setNumero] = useState("");
  const [cupom, setCupom] = useState(null);
  const [erroCupom, setErroCupom] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [salvandoFechamento, setSalvandoFechamento] = useState(false);
  const isAdmin = usuario?.tipo === "admin";
  const fechada = painel.estado.listaFechada;

  const carregarExportacoes = useCallback(() => {
    api.get("/natal-2026/gestao/exportacoes").then((response) => setExportacoes(response.data)).catch(() => {});
  }, []);
  useEffect(() => { carregarExportacoes(); }, [carregarExportacoes]);

  const exportar = async (tipo) => {
    setGerando(tipo);
    try {
      const total = await baixarArquivo(
        tipo === "pdf" ? "/natal-2026/gestao/exportacoes/pdf-urna" : "/natal-2026/gestao/exportacoes/lista-numerica",
        tipo === "pdf" ? "natal-2026-cupons-urna.pdf" : "natal-2026-lista-numerica.csv"
      );
      toast.success("Arquivo gerado", { description: `${total} cupom(ns) válido(s) exportado(s).` });
      carregarExportacoes();
    } catch (error) {
      toast.error("Não foi possível gerar o arquivo", { description: getApiErrorMessage(error) });
    } finally {
      setGerando("");
    }
  };

  const consultarCupom = async (event) => {
    event.preventDefault();
    setErroCupom("");
    setCupom(null);
    if (!numero.trim()) return;
    try {
      const { data } = await api.get(`/natal-2026/gestao/cupons/${encodeURIComponent(numero.trim())}`);
      setCupom(data);
    } catch (error) {
      setErroCupom(getApiErrorMessage(error, "Cupom não encontrado."));
    }
  };

  const alterarFechamento = async () => {
    const acao = fechada ? "reabrir" : "fechar";
    const confirmado = await dialog.confirm({
      variant: "warning",
      title: fechada ? "Reabrir a lista oficial?" : "Fechar a lista oficial do sorteio?",
      message: fechada
        ? "A reabertura permite novas alterações e fica registrada na auditoria."
        : "Após o fechamento, aprovações, rejeições e cancelamentos ficam bloqueados. Ajustes posteriores exigem justificativa do Administrador.",
      confirmLabel: fechada ? "Reabrir lista" : "Fechar lista",
    });
    if (!confirmado) return;
    setSalvandoFechamento(true);
    try {
      const { data } = await api.post("/natal-2026/gestao/fechamento", { acao, justificativa: justificativa.trim() || undefined });
      toast.success(data.message);
      setJustificativa("");
      onPainel(data.painel);
    } catch (error) {
      toast.error("Não foi possível alterar o fechamento", { description: getApiErrorMessage(error) });
    } finally {
      setSalvandoFechamento(false);
    }
  };

  return (
    <>
      <div className={ui.feedback} data-type={fechada ? undefined : "warning"} role="status">
        <span>
          {fechada
            ? `Lista oficial fechada em ${formatDateTimeBR(painel.estado.fechadaEm)} por ${painel.estado.fechadaPorNome || "Administrador"}.`
            : `Lista oficial aberta. Exportações geradas agora são prévias. Sorteio em ${formatDateBR(painel.campanha.sorteio)}.`}
        </span>
      </div>

      <div className={styles.gradeAcoes}>
        <div className={styles.cartaoAcao}>
          <h3>Sorteio por urna</h3>
          <p>PDF com cupons padronizados (10 por folha A4) e linhas de corte. Inclui somente cupons válidos.</p>
          <div className={styles.acoes}>
            <button type="button" className={ui.primaryButton} disabled={Boolean(gerando)} onClick={() => exportar("pdf")}>
              {gerando === "pdf" ? "Gerando PDF…" : "Gerar PDF para impressão"}
            </button>
          </div>
        </div>
        <div className={styles.cartaoAcao}>
          <h3>Sorteio por gerador de números</h3>
          <p>Planilha CSV (abre no Excel) com número do cupom, pet shop, CNPJ e distribuidor. O sorteio é feito externamente.</p>
          <div className={styles.acoes}>
            <button type="button" className={ui.primaryButton} disabled={Boolean(gerando)} onClick={() => exportar("csv")}>
              {gerando === "csv" ? "Gerando lista…" : "Gerar lista numérica"}
            </button>
          </div>
        </div>
        <div className={styles.cartaoAcao}>
          <h3>Fechamento da lista oficial</h3>
          <p>{isAdmin ? "Encerre a lista antes do sorteio. Alterações posteriores exigem justificativa." : "O fechamento definitivo é feito pelo Administrador."}</p>
          {isAdmin && (
            <>
              {fechada && (
                <label className={styles.campoTexto}>
                  <span>Justificativa da reabertura</span>
                  <textarea rows={2} maxLength={1000} value={justificativa} onChange={(event) => setJustificativa(event.target.value)} />
                </label>
              )}
              <div className={styles.acoes}>
                <button type="button" className={fechada ? ui.secondaryButton : ui.dangerButton} disabled={salvandoFechamento} onClick={alterarFechamento}>
                  {salvandoFechamento ? "Salvando…" : fechada ? "Reabrir lista" : "Fechar lista oficial"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <section className={styles.secao} style={{ marginTop: 24 }}>
        <div className={styles.secaoTitulo}><h2>Consultar cupom sorteado</h2></div>
        <form className={styles.filtros} onSubmit={consultarCupom}>
          <label>Número do cupom<input inputMode="numeric" value={numero} onChange={(event) => setNumero(event.target.value)} placeholder="Ex.: 03971" /></label>
          <div className={styles.acoes} style={{ marginTop: 0 }}><button type="submit" className={ui.primaryButton}>Consultar</button></div>
        </form>
        {erroCupom && <div className={ui.feedback} data-type="error" role="alert">{erroCupom}</div>}
        {cupom && (
          <div className={styles.cartaoAcao}>
            <h3>Cupom {cupom.cupom.codigo} — {cupom.cupom.status === "valido" ? "válido" : cupom.cupom.status}</h3>
            {cupom.participacao && (
              <p>
                {cupom.participacao.petshop.nomeFantasia} ({formatDocumentoBR(cupom.participacao.petshop.documento)}) · responsável {cupom.participacao.petshop.responsavel} · WhatsApp {cupom.participacao.petshop.whatsapp} · distribuidor {cupom.participacao.distribuidorNome} · pedido {cupom.participacao.numeroPedido} · protocolo {cupom.participacao.protocolo}
              </p>
            )}
            {cupom.cupom.motivoEncerramento && <p>Motivo do encerramento: {cupom.cupom.motivoEncerramento}</p>}
          </div>
        )}
      </section>

      <section className={styles.secao}>
        <div className={styles.secaoTitulo}><h2>Histórico de exportações</h2></div>
        {exportacoes.length === 0 ? (
          <p className={styles.muted}>Nenhum arquivo gerado ainda.</p>
        ) : (
          <div className={styles.rolagem}>
            <table className={styles.tabelaSimples}>
              <thead><tr><th>Data</th><th>Arquivo</th><th>Cupons</th><th>Lista</th><th>Gerado por</th><th>SHA-256</th></tr></thead>
              <tbody>
                {exportacoes.map((item) => (
                  <tr key={item._id}>
                    <td>{formatDateTimeBR(item.geradaEm)}</td>
                    <td>{item.nomeArquivo}</td>
                    <td>{item.totalCupons}</td>
                    <td>{item.listaFechada ? "Oficial" : "Prévia"}</td>
                    <td>{item.autorNome}</td>
                    <td><code title={item.sha256}>{item.sha256.slice(0, 12)}…</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {fechada && painel.estado.historico.length > 0 && (
        <section className={styles.secao}>
          <div className={styles.secaoTitulo}><h2>Registro de fechamento</h2></div>
          <ul className={styles.historico}>
            {painel.estado.historico.map((evento, indice) => (
              <li key={`${evento.acao}-${indice}`}>
                <strong>{evento.acao === "fechamento" ? "Lista fechada" : "Lista reaberta"} · {evento.totalCuponsValidos} cupons válidos</strong>
                <span>{formatDateTimeBR(evento.em)} · {evento.autorNome}</span>
                {evento.justificativa && <small>{evento.justificativa}</small>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function NatalGestao() {
  const { toast } = useFeedback();
  const usuario = getAuthSession()?.usuario;
  const [aba, setAba] = useState("geral");
  const [painel, setPainel] = useState(null);
  const [erro, setErro] = useState("");
  const [filtroLote, setFiltroLote] = useState(null);
  const [reconciliando, setReconciliando] = useState(false);
  const [versaoPainel, setVersaoPainel] = useState(0);

  const carregarPainel = useCallback(() => {
    api.get("/natal-2026/gestao/painel")
      .then((response) => { setPainel(response.data); setErro(""); })
      .catch((error) => setErro(getApiErrorMessage(error, "Não foi possível carregar o painel da campanha.")));
  }, []);
  useEffect(() => { carregarPainel(); }, [carregarPainel]);

  const reconciliar = async () => {
    setReconciliando(true);
    try {
      await api.post("/natal-2026/gestao/reconciliar");
      toast.success("Saldos reconciliados");
    } catch (error) {
      const dados = error?.response?.data;
      toast.error("Reconciliação não concluída", {
        description: dados?.codigo === "reconciliacao_parcial" ? dados.message : getApiErrorMessage(error),
      });
    } finally {
      setReconciliando(false);
      setVersaoPainel((atual) => atual + 1);
      carregarPainel();
    }
  };

  return (
    <>
      <Navbar />
      <main className={ui.container}>
        <PageHeader
          eyebrow="Campanha"
          title="Natal Premiado 2026"
          description="Validação das participações, controle de cupons por distribuidor e preparação do sorteio de 15/12/2026."
        />
        <div className={styles.abas} role="tablist" aria-label="Seções da campanha">
          {ABAS.map(([id, rotulo]) => (
            <button key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => { setAba(id); if (id !== "participacoes") setFiltroLote(null); }}>
              {rotulo}
            </button>
          ))}
        </div>
        {erro && <div className={ui.feedback} data-type="error" role="alert">{erro}</div>}
        {painel && (
          <AlertaSincronizacao
            pendencias={painel.pendenciasSincronizacao}
            isAdmin={usuario?.tipo === "admin"}
            reconciliando={reconciliando}
            onReconciliar={reconciliar}
          />
        )}
        {!painel && !erro && <p className={styles.muted} role="status">Carregando painel…</p>}
        {painel && aba === "geral" && <VisaoGeral painel={painel} onAbrirDistribuidores={() => setAba("distribuidores")} />}
        {painel && aba === "distribuidores" && <GestaoDistribuidores usuario={usuario} listaFechada={painel.estado.listaFechada} modoCumulativo={painel.estado.modoCumulativo} reconciliando={reconciliando} versaoPainel={versaoPainel} onReconciliar={reconciliar} onAlterado={carregarPainel} />}
        {aba === "participacoes" && (
          <Participacoes
            key={filtroLote?._id || "todas"}
            usuario={usuario}
            onAlterado={carregarPainel}
            filtroInicial={filtroLote ? { pedido: filtroLote.numeroPedido, ordem: "antigos" } : {}}
          />
        )}
        {aba === "lotes" && <Lotes onVerParticipacoes={(lote) => { setFiltroLote(lote); setAba("participacoes"); }} />}
        {painel && aba === "sorteio" && <Sorteio painel={painel} usuario={usuario} onPainel={setPainel} />}
      </main>
    </>
  );
}

export default NatalGestao;
