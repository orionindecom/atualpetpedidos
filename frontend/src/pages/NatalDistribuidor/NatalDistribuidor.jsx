import { useCallback, useEffect, useState } from "react";
import api from "../../api/axios";
import EmptyState from "../../components/AdminUi/EmptyState";
import ui from "../../components/AdminUi/AdminUi.module.css";
import { LinkParticipacao, NatalBeneficiosCard } from "../../components/NatalBeneficios/NatalBeneficios";
import ParticipacaoModal from "../../components/NatalBeneficios/ParticipacaoModal";
import RevisoesLote from "../../components/NatalBeneficios/RevisoesLote";
import styles from "../../components/NatalBeneficios/NatalInterno.module.css";
import { useFeedback } from "../../components/Feedback/feedbackContext";
import Navbar from "../../components/Navbar/Navbar";
import PageHeader from "../../components/PageHeader/PageHeader";
import { getApiErrorMessage } from "../../utils/apiErrors";
import {
  formatDocumentoBR,
  formatDateBR,
  formatDateTimeBR,
  formatMoney,
  PARTICIPACAO_STATUS_LABELS,
  PARTICIPACAO_STATUS_TONES,
} from "../../utils/natalPremiado";

function NatalDistribuidor() {
  const { toast } = useFeedback();
  const [resumo, setResumo] = useState(null);
  const [erro, setErro] = useState("");
  const [filtros, setFiltros] = useState({ loteId: "", status: "", petshop: "", pagina: 1 });
  const [lista, setLista] = useState(null);
  const [versaoLista, setVersaoLista] = useState(0);
  const [selecionada, setSelecionada] = useState(null);
  const [buscaPetshop, setBuscaPetshop] = useState("");

  // Busca por texto aplicada após uma pausa na digitação (evita uma consulta por tecla).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFiltros((atual) => (atual.petshop === buscaPetshop ? atual : { ...atual, petshop: buscaPetshop, pagina: 1 }));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [buscaPetshop]);

  const carregarResumo = useCallback(() => {
    api.get("/natal-2026/distribuidor/resumo")
      .then((response) => setResumo(response.data))
      .catch((error) => setErro(getApiErrorMessage(error, "Não foi possível carregar a campanha.")));
  }, []);

  useEffect(() => { carregarResumo(); }, [carregarResumo]);
  useEffect(() => {
    let ativo = true;
    const params = Object.fromEntries(Object.entries(filtros).filter(([, valor]) => valor !== ""));
    api.get("/natal-2026/distribuidor/participacoes", { params })
      .then((response) => { if (ativo) setLista(response.data); })
      .catch((error) => toast.error("Não foi possível carregar as participações", { description: getApiErrorMessage(error) }));
    return () => { ativo = false; };
  }, [filtros, versaoLista, toast]);

  const alterarFiltro = (campo, valor) => setFiltros((atual) => ({ ...atual, [campo]: valor, pagina: campo === "pagina" ? valor : 1 }));

  const aposAlteracao = (mensagem) => {
    toast.success(mensagem || "Participação atualizada");
    carregarResumo();
    setVersaoLista((versao) => versao + 1);
  };

  const campanha = resumo?.campanha;
  const lotes = resumo?.lotes || [];

  return (
    <>
      <Navbar />
      <main className={ui.container}>
        <PageHeader
          eyebrow="Campanha"
          title="Natal Premiado 2026"
          description="Acompanhe os cupons conquistados nos seus pedidos, compartilhe os links de cadastro com a equipe comercial e consulte as participações dos pet shops."
        />

        {erro && <div className={ui.feedback} data-type="error" role="alert">{erro}</div>}
        {!resumo && !erro && <p className={styles.muted} role="status">Carregando campanha…</p>}

        {resumo && (
          <>
            <section className={styles.resumoCampanha} aria-label="Resumo da campanha">
              <strong>{campanha.nome}</strong>
              <span>
                Período: {formatDateBR(campanha.inicio)} a {formatDateBR(campanha.fimCadastros)} · Sorteio em {formatDateBR(campanha.sorteio)} · Prêmio: {campanha.premio}.
              </span>
              <span>Cada pedido aprovado é avaliado individualmente. Os cupons são liberados na aprovação do pedido.</span>
              <ul>
                {campanha.faixas.map((faixa) => (
                  <li key={faixa.nivel}>
                    A partir de {formatMoney(faixa.valorMinimo)}: {faixa.cupons} cupons, {faixa.marketingPercentual}% em material de marketing e {faixa.produtosPercentual}% em produtos.
                  </li>
                ))}
              </ul>
            </section>

            <div className={styles.kpis}>
              <div className={styles.kpi}><span>Cupons conquistados</span><strong>{resumo.totais.concedidos}</strong></div>
              <div className={styles.kpi} data-tone="success"><span>Utilizados (aprovados)</span><strong>{resumo.totais.aprovados}</strong></div>
              <div className={styles.kpi} data-tone="accent"><span>Em análise</span><strong>{resumo.totais.pendentes}</strong></div>
              <div className={styles.kpi}><span>Disponíveis</span><strong>{resumo.totais.disponiveis}</strong></div>
            </div>

            <section className={styles.secao}>
              <div className={styles.secaoTitulo}>
                <h2>Pedidos participantes</h2>
                <p>{lotes.length} {lotes.length === 1 ? "pedido" : "pedidos"}</p>
              </div>
              {lotes.length === 0 ? (
                <EmptyState
                  headingLevel={3}
                  title="Nenhum pedido participante ainda"
                  description={`Pedidos aprovados a partir de ${formatMoney(campanha.faixas[0].valorMinimo)}, lançados durante a campanha, geram cupons automaticamente.`}
                />
              ) : (
                <div className={styles.lotes}>
                  {lotes.map((lote) => (
                    <article key={lote._id} className={styles.lote} data-status={lote.status}>
                      <div className={styles.loteTopo}>
                        <div>
                          <h3>Pedido {lote.numeroPedido}</h3>
                          <p>Valor atual {formatMoney(lote.valorAtual)} · aprovado em {formatDateBR(lote.pedidoAprovadoEm)}</p>
                        </div>
                        <span className={ui.badge} data-tone={lote.status === "ativo" ? "active" : "inactive"}>
                          {lote.status === "ativo" ? "Lote ativo" : "Lote invalidado"}
                        </span>
                      </div>
                      <dl className={styles.numeros}>
                        <div><dt>Faixa atual</dt><dd>{lote.cuponsConcedidos > 0 ? formatMoney(lote.faixaMaxima.valorMinimo) : "Sem faixa"}</dd></div>
                        <div><dt>Cupons</dt><dd>{lote.cuponsConcedidos}</dd></div>
                        <div><dt>Aprovados</dt><dd>{lote.saldo.aprovados}</dd></div>
                        <div><dt>Pendentes</dt><dd>{lote.saldo.pendentes}</dd></div>
                        <div><dt>Saldo disponível</dt><dd>{lote.saldo.disponivel}</dd></div>
                      </dl>
                      <NatalBeneficiosCard tipo={lote.status !== "ativo" ? "invalidado" : lote.cuponsConcedidos > 0 ? "conquistado" : "sem_beneficios"} beneficios={{ ...lote.faixaMaxima, cupons: lote.cuponsConcedidos }} />
                      <RevisoesLote revisoes={lote.revisoes} revisaoPendente={lote.revisaoPendente} />
                      {lote.status === "ativo"
                        ? <LinkParticipacao codigo={lote.codigoPublico} distribuidorNome={lote.distribuidorNome} />
                        : <p className={styles.muted}>Lote invalidado: {lote.invalidacao?.motivo || "pedido cancelado"}. O link não aceita novos cadastros.</p>}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        <section className={styles.secao}>
          <div className={styles.secaoTitulo}>
            <h2>Participações cadastradas</h2>
            {lista && <p>{lista.total} {lista.total === 1 ? "cadastro" : "cadastros"}</p>}
          </div>
          <div className={styles.filtros}>
            <label>
              Pedido
              <select value={filtros.loteId} onChange={(event) => alterarFiltro("loteId", event.target.value)}>
                <option value="">Todos os pedidos</option>
                {lotes.map((lote) => <option key={lote._id} value={lote._id}>{lote.numeroPedido}</option>)}
              </select>
            </label>
            <label>
              Status
              <select value={filtros.status} onChange={(event) => alterarFiltro("status", event.target.value)}>
                <option value="">Todos os status</option>
                {Object.entries(PARTICIPACAO_STATUS_LABELS).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
              </select>
            </label>
            <label>
              Pet shop
              <input type="search" value={buscaPetshop} placeholder="Nome do pet shop" onChange={(event) => setBuscaPetshop(event.target.value)} />
            </label>
          </div>
          {!lista && <p className={styles.muted} role="status">Carregando participações…</p>}
          {lista && lista.itens.length === 0 && (
            <EmptyState headingLevel={3} title="Nenhuma participação encontrada" description="Os cadastros feitos pelos links dos seus pedidos aparecem aqui." />
          )}
          {lista && lista.itens.length > 0 && (
            <div className={styles.tabela} role="list">
              {lista.itens.map((item) => (
                <button key={item._id} type="button" role="listitem" className={styles.linha} onClick={() => setSelecionada(item._id)}>
                  <div>
                    <strong>{item.petshop.nomeFantasia}</strong>
                    <small>{formatDocumentoBR(item.petshop.documento)} · {item.protocolo}</small>
                  </div>
                  <div>
                    <small>Vendedor</small>
                    <span>{item.vendedorNome}</span>
                  </div>
                  <div>
                    <small>Pedido {item.numeroPedido}</small>
                    <span>{formatDateTimeBR(item.recebidoEm)}</span>
                  </div>
                  <div className={styles.linhaStatus}>
                    <span className={ui.badge} data-tone={PARTICIPACAO_STATUS_TONES[item.status]}>{PARTICIPACAO_STATUS_LABELS[item.status]}</span>
                    {item.cupom && item.status === "aprovado" && <small>Cupom {item.cupom.codigo}</small>}
                  </div>
                </button>
              ))}
            </div>
          )}
          {lista && lista.paginas > 1 && (
            <div className={styles.paginacao}>
              <button type="button" className={ui.secondaryButton} disabled={lista.pagina <= 1} onClick={() => alterarFiltro("pagina", lista.pagina - 1)}>Anterior</button>
              <span>Página {lista.pagina} de {lista.paginas}</span>
              <button type="button" className={ui.secondaryButton} disabled={lista.pagina >= lista.paginas} onClick={() => alterarFiltro("pagina", lista.pagina + 1)}>Próxima</button>
            </div>
          )}
        </section>
      </main>

      {selecionada && (
        <ParticipacaoModal
          participacaoId={selecionada}
          usuarioTipo="cliente"
          onClose={() => setSelecionada(null)}
          onChanged={aposAlteracao}
        />
      )}
    </>
  );
}

export default NatalDistribuidor;
