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
  descreverFaixa,
  formatDocumentoBR,
  formatDateBR,
  formatDateTimeBR,
  formatMoney,
  PARTICIPACAO_STATUS_LABELS,
  PARTICIPACAO_STATUS_TONES,
  resumoCupons,
  separarLinks,
  textoCupons,
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
  const conta = resumo?.conta;
  const { principal: linkPrincipal, anteriores: linksAnteriores } = separarLinks(conta?.links);

  return (
    <>
      <Navbar />
      <main className={ui.container}>
        <PageHeader
          eyebrow="Campanha"
          title="Natal Premiado 2026"
          description="Acompanhe suas compras acumuladas e os cupons conquistados, compartilhe os links de cadastro com a equipe comercial e consulte as participações dos pet shops."
        />

        {erro && <div className={ui.feedback} data-type="error" role="alert">{erro}</div>}
        {!resumo && !erro && <p className={styles.muted} role="status">Carregando campanha…</p>}

        {resumo && (
          <>
            <div className={styles.kpis}>
              <div className={styles.kpi}><span>Cupons concedidos</span><strong>{conta?.cupons.total || 0}</strong></div>
              <div className={styles.kpi} data-tone="success"><span>Cupons disponíveis</span><strong>{conta?.cupons.disponiveis || 0}</strong></div>
              <div className={styles.kpi}><span>Cupons distribuídos</span><strong>{(conta?.cupons.utilizados || 0) + (conta?.cupons.pendentes || 0)}</strong></div>
              <div className={styles.kpi}><span>Válidos no sorteio</span><strong>{conta?.cupons.utilizados || 0}</strong></div>
              <div className={styles.kpi} data-tone="accent"><span>Aguardando validação</span><strong>{conta?.cupons.pendentes || 0}</strong></div>
              <div className={styles.kpi}><span>Acumulado no ciclo {conta?.compras.cicloAtual || 1}</span><strong>{formatMoney(conta?.compras.acumuladoCiclo)}</strong></div>
              <div className={styles.kpi}><span>Faixa atual</span><strong>{descreverFaixa(conta?.compras.faixaAtual)}</strong></div>
              <div className={styles.kpi}><span>Falta para a próxima faixa</span><strong>{conta?.compras.proximaFaixa ? formatMoney(conta.compras.restanteProximaFaixa) : "—"}</strong></div>
              <div className={styles.kpi}><span>Total comprado na campanha</span><strong>{formatMoney(conta?.compras.total)}</strong></div>
            </div>

            <section className={styles.secao}>
              <div className={styles.secaoTitulo}>
                <h2>Seu link de cadastro</h2>
                <p>O mesmo link vale para todos os seus pedidos e ciclos.</p>
              </div>
              {linkPrincipal ? (
                <>
                  <LinkParticipacao codigo={linkPrincipal.codigoPublico} distribuidorNome={conta?.distribuidorNome} />
                  {!conta?.cupons.disponiveis && (
                    <p className={styles.muted}>Este link passa a aceitar cadastros quando houver cupons disponíveis.</p>
                  )}
                </>
              ) : (
                <EmptyState
                  headingLevel={3}
                  title="Seu link ainda não está disponível"
                  description={`Ele aparece aqui depois da aprovação da sua primeira compra. Os benefícios começam a partir de ${formatMoney(campanha.faixas[0].valorMinimo)} acumulados no ciclo.`}
                />
              )}
              {linksAnteriores.length > 0 && (
                <details>
                  <summary>Links anteriores ({linksAnteriores.length})</summary>
                  <p className={styles.muted}>Continuam funcionando e usam o mesmo saldo. Divulgue apenas o link acima.</p>
                  <div className={styles.lotes}>
                    {linksAnteriores.map((link) => (
                      <article key={link.codigoPublico} className={styles.lote} data-status={link.status}>
                        <div className={styles.loteTopo}>
                          <div>
                            <h3>{link.tipo === "distribuidor" ? "Link do distribuidor" : `Pedido ${link.numeroPedido}`}</h3>
                          </div>
                          <span className={ui.badge} data-tone={link.status === "ativo" ? "active" : "inactive"}>
                            {link.status === "ativo" ? "Link ativo" : "Link invalidado"}
                          </span>
                        </div>
                        {link.status === "ativo"
                          ? <LinkParticipacao codigo={link.codigoPublico} distribuidorNome={conta?.distribuidorNome} compacto />
                          : <p className={styles.muted}>Este link não aceita novos cadastros.</p>}
                      </article>
                    ))}
                  </div>
                </details>
              )}
            </section>

            {conta && (
              <section className={styles.secao}>
                <div className={styles.secaoTitulo}><h2>Compras acumuladas</h2></div>
                {conta.comprasParticipantes.length === 0 ? (
                  <p className={styles.muted}>Nenhuma compra aprovada na campanha até agora.</p>
                ) : (
                  <div className={styles.rolagem}>
                    <table className={styles.tabelaSimples}>
                      <thead><tr><th>Compra</th><th>Data</th><th>Valor</th><th>Ciclos</th></tr></thead>
                      <tbody>
                        {conta.comprasParticipantes.map((compra) => (
                          <tr key={compra.id}>
                            <td>{compra.referencia}</td>
                            <td>{formatDateBR(compra.data)}</td>
                            <td>{formatMoney(compra.valor)}</td>
                            <td>{compra.ciclos.map((item) => `${item.ciclo}º: ${formatMoney(item.valor)}`).join(" · ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <NatalBeneficiosCard
                  tipo={conta.cupons.total > 0 ? "conquistado" : "sem_beneficios"}
                  beneficios={{ ...conta.compras.faixaAtual, cupons: conta.cupons.total }}
                  titulo="Benefícios acumulados"
                >
                  <p>Bonificação em produtos: {formatMoney(conta.bonificacoes.produtos.concedido)} · Material de marketing: {formatMoney(conta.bonificacoes.marketing.concedido)}.</p>
                </NatalBeneficiosCard>
                <RevisoesLote revisoes={conta.revisoes} revisaoPendente={conta.revisaoPendente} />
              </section>
            )}

            <section className={styles.resumoCampanha} aria-label="Resumo da campanha">
              <strong>{campanha.nome}</strong>
              <span>
                Período: {formatDateBR(campanha.inicio)} a {formatDateBR(campanha.fimCadastros)} · Sorteio em {formatDateBR(campanha.sorteio)} · Prêmio: {campanha.premio}.
              </span>
              <span>Suas compras elegíveis acumulam em ciclos de {formatMoney(campanha.cicloValor)}. Os benefícios são liberados na aprovação do pedido e, ao completar um ciclo, o próximo começa automaticamente.</span>
              <ul>
                {campanha.faixas.map((faixa) => (
                  <li key={faixa.nivel}>
                    A partir de {formatMoney(faixa.valorMinimo)}: {faixa.cupons} cupons, {faixa.marketingPercentual}% em material de marketing e {faixa.produtosPercentual}% em produtos.
                  </li>
                ))}
              </ul>
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
            <EmptyState headingLevel={3} title="Nenhuma participação encontrada" description="Os cadastros feitos pelos seus links aparecem aqui." />
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
                    <small>{item.numeroPedido ? `Pedido ${item.numeroPedido}` : "Link do distribuidor"}</small>
                    <span>{formatDateTimeBR(item.recebidoEm)}</span>
                  </div>
                  <div className={styles.linhaStatus}>
                    <span className={ui.badge} data-tone={PARTICIPACAO_STATUS_TONES[item.status]}>{PARTICIPACAO_STATUS_LABELS[item.status]}</span>
                    <small>{textoCupons(resumoCupons(item).total)} · {resumoCupons(item).validos} válido(s){resumoCupons(item).pendentes ? ` · ${resumoCupons(item).pendentes} aguardando` : ""}</small>
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
          saldoDisponivel={conta?.cupons.disponiveis}
          onClose={() => setSelecionada(null)}
          onChanged={aposAlteracao}
        />
      )}
    </>
  );
}

export default NatalDistribuidor;
