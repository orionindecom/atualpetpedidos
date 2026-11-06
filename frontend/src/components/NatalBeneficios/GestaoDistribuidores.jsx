import { useCallback, useEffect, useRef, useState } from "react";
import api from "../../api/axios";
import EmptyState from "../AdminUi/EmptyState";
import ui from "../AdminUi/AdminUi.module.css";
import { useFeedback } from "../Feedback/feedbackContext";
import { useModalDialog } from "../../hooks/useModalDialog";
import { getApiErrorMessage } from "../../utils/apiErrors";
import {
  BONIFICACAO_EVENTO_LABELS,
  COMPRA_EXTERNA_STATUS_LABELS,
  COMPRA_EXTERNA_STATUS_TONES,
  descreverFaixa,
  formatDateBR,
  formatDateTimeBR,
  formatMoney,
  MOVIMENTO_CUPOM_LABELS,
  separarLinks,
} from "../../utils/natalPremiado";
import { LinkParticipacao } from "./NatalBeneficios";
import RevisaoBeneficiosModal from "./RevisaoBeneficiosModal";
import RevisoesLote from "./RevisoesLote";
import styles from "./NatalInterno.module.css";

function ModalFormulario({ titulo, subtitulo, salvando, onFechar, children }) {
  const dialogRef = useModalDialog({ onClose: onFechar, closeDisabled: salvando });
  return (
    <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget && !salvando) onFechar(); }}>
      <section ref={dialogRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="natal-form-titulo" tabIndex="-1">
        <header className={styles.modalHeader}>
          <div>
            {subtitulo && <span>{subtitulo}</span>}
            <h2 id="natal-form-titulo">{titulo}</h2>
          </div>
          <button type="button" className={ui.secondaryButton} onClick={onFechar} disabled={salvando}>Fechar</button>
        </header>
        <div className={styles.modalContent}>{children}</div>
      </section>
    </div>
  );
}

// Escolha do distribuidor, inclusive quem ainda não comprou pela Central.
function BuscaDistribuidor({ valor, onSelecionar, disabled }) {
  const [busca, setBusca] = useState(valor?.nome || "");
  const [opcoes, setOpcoes] = useState([]);
  const pesquisar = busca.trim().length >= 2 && busca !== valor?.nome;
  useEffect(() => {
    if (!pesquisar) return undefined;
    const timer = window.setTimeout(() => {
      api.get("/natal-2026/gestao/distribuidores-busca", { params: { busca } })
        .then((response) => setOpcoes(response.data))
        .catch(() => setOpcoes([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [busca, pesquisar]);

  return (
    <label className={styles.campoTexto}>
      <span>Distribuidor</span>
      <input type="search" value={busca} disabled={disabled} onChange={(event) => { setBusca(event.target.value); onSelecionar(null); }} placeholder="Digite o nome" />
      {pesquisar && opcoes.length > 0 && (
        <div className={styles.opcoesBusca} role="listbox" aria-label="Distribuidores encontrados">
          {opcoes.map((opcao) => (
            <button key={opcao.clienteId} type="button" role="option" aria-selected={false} onClick={() => { onSelecionar(opcao); setBusca(opcao.nome); setOpcoes([]); }}>
              {opcao.nome}
            </button>
          ))}
        </div>
      )}
    </label>
  );
}

function CompraExternaModal({ distribuidor, onFechar, onSalvo }) {
  const [selecionado, setSelecionado] = useState(distribuidor || null);
  const [campos, setCampos] = useState({ valor: "", data: "", referencia: "", observacoes: "" });
  const [arquivo, setArquivo] = useState(null);
  const [erros, setErros] = useState({});
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const campo = (nome) => ({
    value: campos[nome],
    onChange: (event) => setCampos((atual) => ({ ...atual, [nome]: event.target.value })),
    disabled: salvando,
  });

  const salvar = async (event) => {
    event.preventDefault();
    if (!selecionado) { setErro("Selecione o distribuidor."); return; }
    setSalvando(true);
    setErro("");
    setErros({});
    try {
      const form = new FormData();
      Object.entries(campos).forEach(([nome, valor]) => form.append(nome, valor));
      if (arquivo) form.append("comprovante", arquivo);
      const { data } = await api.post(`/natal-2026/gestao/distribuidores/${selecionado.clienteId}/compras-externas`, form, { timeout: 60000 });
      onSalvo(data.message, selecionado);
    } catch (error) {
      setErros(error?.response?.data?.errors || {});
      setErro(getApiErrorMessage(error, "Não foi possível registrar a compra."));
      setSalvando(false);
    }
  };

  return (
    <ModalFormulario titulo="Registrar compra externa" subtitulo="Compra feita fora da Central Comercial" salvando={salvando} onFechar={onFechar}>
      <form onSubmit={salvar} className={styles.formulario}>
        {distribuidor
          ? <p className={styles.muted}>Distribuidor: <strong>{distribuidor.nome}</strong></p>
          : <BuscaDistribuidor valor={selecionado} onSelecionar={setSelecionado} disabled={salvando} />}
        <label className={styles.campoTexto}>
          <span>Valor da compra</span>
          <input inputMode="decimal" placeholder="12.000,00" required {...campo("valor")} />
          {erros.valor && <small className={styles.alertaTexto}>{erros.valor}</small>}
        </label>
        <label className={styles.campoTexto}>
          <span>Data da compra</span>
          <input type="date" required {...campo("data")} />
          {erros.data && <small className={styles.alertaTexto}>{erros.data}</small>}
        </label>
        <label className={styles.campoTexto}>
          <span>Referência do pedido ou nota fiscal</span>
          <input maxLength={120} required {...campo("referencia")} />
          {erros.referencia && <small className={styles.alertaTexto}>{erros.referencia}</small>}
        </label>
        <label className={styles.campoTexto}>
          <span>Observações</span>
          <textarea rows={2} maxLength={1000} {...campo("observacoes")} />
        </label>
        <label className={styles.campoTexto}>
          <span>Comprovante (opcional)</span>
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={salvando} onChange={(event) => setArquivo(event.target.files?.[0] || null)} />
        </label>
        <p className={styles.muted}>A compra só soma no acumulado depois de validada.</p>
        {erro && <div className={ui.feedback} data-type="error" role="alert">{erro}</div>}
        <div className={styles.acoes}>
          <button type="button" className={ui.secondaryButton} onClick={onFechar} disabled={salvando}>Cancelar</button>
          <button type="submit" className={ui.primaryButton} disabled={salvando}>{salvando ? "Salvando…" : "Registrar compra"}</button>
        </div>
      </form>
    </ModalFormulario>
  );
}

function AjusteCuponsModal({ distribuidor, listaFechada, isAdmin, onFechar, onSalvo }) {
  const [selecionado, setSelecionado] = useState(distribuidor || null);
  const [operacao, setOperacao] = useState("adicionar");
  const [quantidade, setQuantidade] = useState("");
  const [motivo, setMotivo] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  // A mesma chave em uma nova tentativa impede registrar o ajuste duas vezes.
  const chave = useRef(crypto.randomUUID());

  const salvar = async (event) => {
    event.preventDefault();
    if (!selecionado) { setErro("Selecione o distribuidor."); return; }
    setSalvando(true);
    setErro("");
    try {
      const valor = Number(quantidade) * (operacao === "retirar" ? -1 : 1);
      await api.post(`/natal-2026/gestao/distribuidores/${selecionado.clienteId}/ajustes-cupons`, {
        quantidade: valor, motivo, chave: chave.current, justificativa: justificativa.trim() || undefined,
      });
      onSalvo("Ajuste de cupons registrado.", selecionado);
    } catch (error) {
      setErro(getApiErrorMessage(error, "Não foi possível registrar o ajuste."));
      setSalvando(false);
    }
  };

  return (
    <ModalFormulario titulo="Ajustar cupons" subtitulo="Contado à parte dos cupons conquistados por compras" salvando={salvando} onFechar={onFechar}>
      <form onSubmit={salvar} className={styles.formulario}>
        {distribuidor
          ? <p className={styles.muted}>Distribuidor: <strong>{distribuidor.nome}</strong></p>
          : <BuscaDistribuidor valor={selecionado} onSelecionar={setSelecionado} disabled={salvando} />}
        <label className={styles.campoTexto}>
          <span>Operação</span>
          <select value={operacao} onChange={(event) => setOperacao(event.target.value)} disabled={salvando}>
            <option value="adicionar">Adicionar cupons</option>
            <option value="retirar">Retirar cupons</option>
          </select>
        </label>
        <label className={styles.campoTexto}>
          <span>Quantidade</span>
          <input type="number" min="1" step="1" required value={quantidade} onChange={(event) => setQuantidade(event.target.value)} disabled={salvando} />
        </label>
        <label className={styles.campoTexto}>
          <span>Motivo (obrigatório)</span>
          <textarea rows={3} maxLength={500} required value={motivo} onChange={(event) => setMotivo(event.target.value)} disabled={salvando} />
        </label>
        {listaFechada && isAdmin && (
          <label className={styles.campoTexto}>
            <span>Justificativa (lista oficial fechada)</span>
            <textarea rows={2} maxLength={1000} value={justificativa} onChange={(event) => setJustificativa(event.target.value)} disabled={salvando} />
          </label>
        )}
        {erro && <div className={ui.feedback} data-type="error" role="alert">{erro}</div>}
        <div className={styles.acoes}>
          <button type="button" className={ui.secondaryButton} onClick={onFechar} disabled={salvando}>Cancelar</button>
          <button type="submit" className={ui.primaryButton} disabled={salvando || motivo.trim().length < 10 || !(Number(quantidade) > 0)}>
            {salvando ? "Salvando…" : "Registrar ajuste"}
          </button>
        </div>
      </form>
    </ModalFormulario>
  );
}

function EntregaBonificacaoModal({ bonificacao, onFechar, onSalvo }) {
  const [valor, setValor] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const salvar = async (event) => {
    event.preventDefault();
    setSalvando(true);
    setErro("");
    try {
      await api.post(`/natal-2026/gestao/bonificacoes/${bonificacao._id}/entregas`, { valor, observacao });
      onSalvo("Entrega registrada.");
    } catch (error) {
      setErro(getApiErrorMessage(error, "Não foi possível registrar a entrega."));
      setSalvando(false);
    }
  };
  return (
    <ModalFormulario
      titulo="Registrar entrega de bonificação"
      subtitulo={`Ciclo ${bonificacao.ciclo} · ${bonificacao.tipo === "produtos" ? "Produtos" : "Marketing"}`}
      salvando={salvando}
      onFechar={onFechar}
    >
      <form onSubmit={salvar} className={styles.formulario}>
        <p className={styles.muted}>Saldo pendente: <strong>{formatMoney(bonificacao.saldoPendente)}</strong>. Este registro não gera nota fiscal nem movimentação financeira.</p>
        <label className={styles.campoTexto}>
          <span>Valor entregue ou utilizado</span>
          <input inputMode="decimal" required value={valor} onChange={(event) => setValor(event.target.value)} disabled={salvando} />
        </label>
        <label className={styles.campoTexto}>
          <span>Descrição da entrega</span>
          <textarea rows={2} maxLength={500} required value={observacao} onChange={(event) => setObservacao(event.target.value)} disabled={salvando} />
        </label>
        {erro && <div className={ui.feedback} data-type="error" role="alert">{erro}</div>}
        <div className={styles.acoes}>
          <button type="button" className={ui.secondaryButton} onClick={onFechar} disabled={salvando}>Cancelar</button>
          <button type="submit" className={ui.primaryButton} disabled={salvando || observacao.trim().length < 5}>{salvando ? "Salvando…" : "Registrar entrega"}</button>
        </div>
      </form>
    </ModalFormulario>
  );
}

function MotivoCompraModal({ compra, acao, onFechar, onSalvo }) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const titulo = acao === "rejeitar" ? "Rejeitar compra externa" : "Cancelar compra externa";
  const salvar = async (event) => {
    event.preventDefault();
    setSalvando(true);
    setErro("");
    try {
      const { data } = await api.post(`/natal-2026/gestao/compras-externas/${compra._id}/${acao}`, { motivo });
      onSalvo(data.message);
    } catch (error) {
      setErro(getApiErrorMessage(error, "Não foi possível concluir."));
      setSalvando(false);
    }
  };
  return (
    <ModalFormulario titulo={titulo} subtitulo={`${compra.referencia} · ${formatMoney(compra.valor)}`} salvando={salvando} onFechar={onFechar}>
      <form onSubmit={salvar} className={styles.formulario}>
        {compra.status === "validada" && (
          <p className={styles.muted}>O valor sai do acumulado. Se atingir benefícios concedidos, o distribuidor fica com revisão pendente.</p>
        )}
        <label className={styles.campoTexto}>
          <span>Motivo (obrigatório)</span>
          <textarea rows={3} maxLength={500} required value={motivo} onChange={(event) => setMotivo(event.target.value)} disabled={salvando} />
        </label>
        {erro && <div className={ui.feedback} data-type="error" role="alert">{erro}</div>}
        <div className={styles.acoes}>
          <button type="button" className={ui.secondaryButton} onClick={onFechar} disabled={salvando}>Voltar</button>
          <button type="submit" className={ui.dangerButton} disabled={salvando || motivo.trim().length < 5}>{salvando ? "Salvando…" : titulo}</button>
        </div>
      </form>
    </ModalFormulario>
  );
}

function DetalheDistribuidor({ clienteId, listaFechada, isAdmin, cumulativoAtivo, onVoltar, onAlterado }) {
  const { toast, dialog } = useFeedback();
  const [detalhe, setDetalhe] = useState(null);
  const [erro, setErro] = useState("");
  const [modal, setModal] = useState(null);
  const [revisao, setRevisao] = useState(null);

  const carregar = useCallback(() => {
    api.get(`/natal-2026/gestao/distribuidores/${clienteId}`)
      .then((response) => { setDetalhe(response.data); setErro(""); })
      .catch((error) => setErro(getApiErrorMessage(error, "Não foi possível carregar o distribuidor.")));
  }, [clienteId]);
  useEffect(() => { carregar(); }, [carregar]);

  const aposSalvar = (mensagem) => {
    toast.success(mensagem);
    setModal(null);
    setRevisao(null);
    carregar();
    onAlterado();
  };

  const abrirRevisao = async () => {
    try {
      const { data } = await api.get(`/natal-2026/gestao/distribuidores/${clienteId}/revisao`);
      setRevisao({ revisao: data, salvando: false, erro: "" });
    } catch (error) {
      toast.error("Não foi possível abrir a revisão", { description: getApiErrorMessage(error) });
    }
  };

  const confirmarRevisao = async (decisao) => {
    setRevisao((atual) => ({ ...atual, salvando: true, erro: "" }));
    try {
      const { data } = await api.post(`/natal-2026/gestao/distribuidores/${clienteId}/revisao`, decisao);
      aposSalvar(data.message);
    } catch (error) {
      setRevisao((atual) => ({ ...atual, salvando: false, erro: getApiErrorMessage(error, "Não foi possível registrar a decisão.") }));
    }
  };

  const validarCompra = async (compra) => {
    const confirmado = await dialog.confirm({
      title: "Validar compra externa?",
      message: `${compra.referencia} · ${formatMoney(compra.valor)}. O valor entra no acumulado do distribuidor.`,
      confirmLabel: "Validar",
    });
    if (!confirmado) return;
    try {
      const { data } = await api.post(`/natal-2026/gestao/compras-externas/${compra._id}/validar`);
      aposSalvar(data.message);
    } catch (error) {
      toast.error("Não foi possível validar", { description: getApiErrorMessage(error) });
    }
  };

  const abrirComprovante = async (compra) => {
    try {
      const response = await api.get(`/natal-2026/gestao/compras-externas/${compra._id}/comprovante`, { responseType: "blob", timeout: 60000 });
      const url = URL.createObjectURL(response.data);
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      toast.error("Não foi possível abrir o comprovante");
    }
  };

  if (erro) return <div className={ui.feedback} data-type="error" role="alert">{erro}</div>;
  if (!detalhe) return <p className={styles.muted} role="status">Carregando distribuidor…</p>;
  const { compras, cupons, bonificacoes } = detalhe;
  const { principal: linkPrincipal, anteriores: linksAnteriores } = separarLinks(detalhe.links);
  const referencia = { clienteId: detalhe.clienteId, nome: detalhe.distribuidorNome };

  return (
    <section className={styles.secao}>
      <div className={styles.secaoTitulo}>
        <h2>{detalhe.distribuidorNome}</h2>
        <button type="button" className={ui.ghostButton} onClick={onVoltar}>Voltar à lista</button>
      </div>

      {detalhe.revisaoPendente && (
        <div className={ui.feedback} data-type="warning" role="note">
          <span>
            Revisão pendente: o acumulado caiu de {formatMoney(detalhe.revisaoPendente.valorAnterior)} para {formatMoney(detalhe.revisaoPendente.valorNovo)}
            {detalhe.revisaoPendente.numeroPedido ? ` (pedido ${detalhe.revisaoPendente.numeroPedido})` : ""}. Os benefícios seguem válidos até a decisão.
          </span>
          <button type="button" onClick={abrirRevisao}>Revisar benefícios</button>
        </div>
      )}

      <div className={styles.kpis}>
        <div className={styles.kpi}><span>Compras na campanha</span><strong>{formatMoney(compras.total)}</strong></div>
        <div className={styles.kpi}><span>Ciclos concluídos</span><strong>{compras.ciclosConcluidos}</strong></div>
        <div className={styles.kpi}><span>Ciclo atual</span><strong>{compras.cicloAtual}º · {formatMoney(compras.acumuladoCiclo)}</strong></div>
        <div className={styles.kpi}><span>Faixa atual</span><strong>{descreverFaixa(compras.faixaAtual)}</strong></div>
        <div className={styles.kpi}><span>Falta para a próxima faixa</span><strong>{compras.proximaFaixa ? formatMoney(compras.restanteProximaFaixa) : "—"}</strong></div>
        <div className={styles.kpi}><span>Cupons concedidos</span><strong>{cupons.total}</strong></div>
        <div className={styles.kpi} data-tone="success"><span>Cupons disponíveis</span><strong>{cupons.disponiveis}</strong></div>
        <div className={styles.kpi}><span>Cupons utilizados</span><strong>{cupons.utilizados}</strong></div>
        <div className={styles.kpi} data-tone="accent"><span>Cadastros em análise</span><strong>{cupons.pendentes}</strong></div>
        <div className={styles.kpi} data-tone="danger"><span>Cupons invalidados</span><strong>{cupons.invalidados + cupons.cancelados}</strong></div>
      </div>
      <p className={styles.muted}>
        Cupons: {cupons.legado} do modelo anterior · {cupons.conquistados} conquistados · {cupons.reduzidos} retirados por revisão · {cupons.ajustes} em ajustes manuais.
      </p>

      {cumulativoAtivo && (
        <div className={styles.acoes}>
          <button type="button" className={ui.secondaryButton} onClick={() => setModal({ tipo: "compra" })}>Registrar compra externa</button>
          <button type="button" className={ui.secondaryButton} onClick={() => setModal({ tipo: "ajuste" })}>Ajustar cupons</button>
        </div>
      )}

      <section className={styles.bloco} aria-label="Link do distribuidor">
        <h3>Link do distribuidor</h3>
        {linkPrincipal
          ? <LinkParticipacao codigo={linkPrincipal.codigoPublico} distribuidorNome={detalhe.distribuidorNome} compacto />
          : <p className={styles.muted}>Nenhum link disponível. O link é criado na primeira compra aprovada.</p>}
        {linksAnteriores.length > 0 && (
          <details>
            <summary>Links anteriores ({linksAnteriores.length})</summary>
            <p className={styles.muted}>Continuam válidos e usam o mesmo saldo. Divulgue apenas o link acima.</p>
            {linksAnteriores.map((link) => (
              <div key={link.codigoPublico}>
                <p className={styles.muted}>
                  {link.tipo === "distribuidor" ? "Link do distribuidor" : `Pedido ${link.numeroPedido}`}{link.status !== "ativo" ? " · invalidado" : ""}
                </p>
                {link.status === "ativo" && <LinkParticipacao codigo={link.codigoPublico} distribuidorNome={detalhe.distribuidorNome} compacto />}
              </div>
            ))}
          </details>
        )}
      </section>

      <section className={styles.bloco} aria-label="Ciclos">
        <h3>Ciclos</h3>
        {detalhe.ciclos.length === 0 ? <p className={styles.muted}>Nenhuma compra contabilizada.</p> : (
          <div className={styles.rolagem}>
            <table className={styles.tabelaSimples}>
              <thead><tr><th>Ciclo</th><th>Acumulado</th><th>Situação</th><th>Faixa</th><th>Cupons</th><th>Produtos</th><th>Marketing</th></tr></thead>
              <tbody>
                {detalhe.ciclos.map((ciclo) => (
                  <tr key={ciclo.numero}>
                    <td>{ciclo.numero}º</td>
                    <td>{formatMoney(ciclo.acumulado)}</td>
                    <td>{ciclo.concluido ? "Concluído" : "Em andamento"}</td>
                    <td>{descreverFaixa(ciclo.faixa)}</td>
                    <td>{ciclo.cupons}</td>
                    <td>{ciclo.produtos.percentual}% · {formatMoney(ciclo.produtos.devido)}</td>
                    <td>{ciclo.marketing.percentual}% · {formatMoney(ciclo.marketing.devido)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.bloco} aria-label="Pedidos participantes">
        <h3>Pedidos participantes</h3>
        {detalhe.comprasParticipantes.length === 0 && <p className={styles.muted}>Nenhuma compra contabilizada.</p>}
        {detalhe.comprasParticipantes.length > 0 && (
          <div className={styles.rolagem}>
            <table className={styles.tabelaSimples}>
              <thead><tr><th>Origem</th><th>Referência</th><th>Situação</th><th>Data</th><th>Valor</th><th>Ciclos</th></tr></thead>
              <tbody>
                {detalhe.comprasParticipantes.map((compra) => (
                  <tr key={compra.id}>
                    <td>{compra.tipo === "pedido" ? "Pedido da Central" : "Compra externa"}</td>
                    <td>{compra.referencia}</td>
                    <td>{compra.status}</td>
                    <td>{formatDateBR(compra.data)}</td>
                    <td>{formatMoney(compra.valor)}</td>
                    <td>{compra.ciclos.map((item) => `${item.ciclo}º: ${formatMoney(item.valor)}`).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.bloco} aria-label="Bonificações">
        <h3>Bonificações</h3>
        <p className={styles.muted}>
          Produtos: {formatMoney(bonificacoes.produtos.concedido)} concedidos, {formatMoney(bonificacoes.produtos.entregue)} entregues, {formatMoney(bonificacoes.produtos.pendente)} pendentes.
          {" "}Marketing: {formatMoney(bonificacoes.marketing.concedido)} concedidos, {formatMoney(bonificacoes.marketing.entregue)} entregues, {formatMoney(bonificacoes.marketing.pendente)} pendentes.
        </p>
        {detalhe.bonificacoesDetalhe.length > 0 && (
          <div className={styles.rolagem}>
            <table className={styles.tabelaSimples}>
              <thead><tr><th>Ciclo</th><th>Tipo</th><th>Acumulado</th><th>%</th><th>Devido</th><th>Concedido</th><th>Entregue</th><th>Pendente</th><th aria-label="Ações" /></tr></thead>
              <tbody>
                {detalhe.bonificacoesDetalhe.map((item) => (
                  <tr key={item._id}>
                    <td>{item.ciclo}º</td>
                    <td>{item.tipo === "produtos" ? "Produtos" : "Marketing"}</td>
                    <td>{formatMoney(item.valorAcumulado)}</td>
                    <td>{item.percentual}%</td>
                    <td>{formatMoney(item.valorDevido)}</td>
                    <td>{formatMoney(item.valorConcedido)}</td>
                    <td>{formatMoney(item.valorEntregue)}</td>
                    <td>{formatMoney(item.saldoPendente)}</td>
                    <td>
                      {item.saldoPendente > 0 && (
                        <button type="button" className={ui.ghostButton} onClick={() => setModal({ tipo: "entrega", bonificacao: item })}>Registrar entrega</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {detalhe.bonificacoesDetalhe.length > 0 && (
          <details>
            <summary>Histórico das bonificações</summary>
            <div className={styles.rolagem}>
              <table className={styles.tabelaSimples}>
                <thead><tr><th>Data</th><th>Ciclo</th><th>Tipo</th><th>Evento</th><th>Devido</th><th>Anterior</th><th>Complemento</th><th>Origem</th><th>Responsável</th></tr></thead>
                <tbody>
                  {detalhe.bonificacoesDetalhe.flatMap((item) => item.historico.map((evento, indice) => (
                    <tr key={`${item._id}-${indice}`}>
                      <td>{formatDateTimeBR(evento.em)}</td>
                      <td>{item.ciclo}º</td>
                      <td>{item.tipo === "produtos" ? "Produtos" : "Marketing"}</td>
                      <td>{BONIFICACAO_EVENTO_LABELS[evento.tipo] || evento.tipo}</td>
                      <td>{formatMoney(evento.valorDevido)}</td>
                      <td>{formatMoney(evento.valorAnterior)}</td>
                      <td>{evento.tipo === "entrega" ? formatMoney(evento.valorEntregue) : formatMoney(evento.complemento)}</td>
                      <td>{evento.origem?.numeroPedido || evento.origem?.referencia || evento.observacao || "—"}</td>
                      <td>{evento.autorNome || "Sistema"}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>

      <section className={styles.bloco} aria-label="Compras externas">
        <h3>Compras externas</h3>
        {detalhe.comprasExternas.length === 0 ? <p className={styles.muted}>Nenhuma compra externa registrada.</p> : (
          <div className={styles.rolagem}>
            <table className={styles.tabelaSimples}>
              <thead><tr><th>Referência</th><th>Data</th><th>Valor</th><th>Situação</th><th>Responsável</th><th aria-label="Ações" /></tr></thead>
              <tbody>
                {detalhe.comprasExternas.map((compra) => (
                  <tr key={compra._id}>
                    <td>{compra.referencia}{compra.observacoes ? <small> · {compra.observacoes}</small> : null}</td>
                    <td>{formatDateBR(compra.data)}</td>
                    <td>{formatMoney(compra.valor)}</td>
                    <td><span className={ui.badge} data-tone={COMPRA_EXTERNA_STATUS_TONES[compra.status]}>{COMPRA_EXTERNA_STATUS_LABELS[compra.status]}</span></td>
                    <td>{compra.registradoPorNome}</td>
                    <td className={styles.celulaAcoes}>
                      {compra.possuiComprovante && <button type="button" className={ui.ghostButton} onClick={() => abrirComprovante(compra)}>Comprovante</button>}
                      {compra.status === "pendente" && <button type="button" className={ui.ghostButton} onClick={() => validarCompra(compra)}>Validar</button>}
                      {compra.status === "pendente" && <button type="button" className={ui.ghostButton} onClick={() => setModal({ tipo: "motivo", compra, acao: "rejeitar" })}>Rejeitar</button>}
                      {["pendente", "validada"].includes(compra.status) && <button type="button" className={ui.ghostButton} onClick={() => setModal({ tipo: "motivo", compra, acao: "cancelar" })}>Cancelar</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.bloco} aria-label="Extrato de cupons">
        <h3>Extrato de cupons</h3>
        {detalhe.movimentos.length === 0 ? <p className={styles.muted}>Nenhum movimento registrado.</p> : (
          <div className={`${styles.rolagem} ${styles.listaLimitada}`}>
            <table className={styles.tabelaSimples}>
              <thead><tr><th>Data</th><th>Movimento</th><th>Quantidade</th><th>Saldo</th><th>Motivo</th><th>Responsável</th></tr></thead>
              <tbody>
                {detalhe.movimentos.map((movimento) => (
                  <tr key={movimento._id}>
                    <td>{formatDateTimeBR(movimento.em)}</td>
                    <td>{MOVIMENTO_CUPOM_LABELS[movimento.tipo] || movimento.tipo}</td>
                    <td>{movimento.quantidade > 0 ? `+${movimento.quantidade}` : movimento.quantidade}</td>
                    <td>{movimento.saldoTotalApos}</td>
                    <td>{movimento.motivo}</td>
                    <td>{movimento.autorNome || "Sistema"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <RevisoesLote revisoes={detalhe.revisoes} gestor />

      {modal?.tipo === "compra" && <CompraExternaModal distribuidor={referencia} onFechar={() => setModal(null)} onSalvo={aposSalvar} />}
      {modal?.tipo === "ajuste" && <AjusteCuponsModal distribuidor={referencia} listaFechada={listaFechada} isAdmin={isAdmin} onFechar={() => setModal(null)} onSalvo={aposSalvar} />}
      {modal?.tipo === "motivo" && <MotivoCompraModal compra={modal.compra} acao={modal.acao} onFechar={() => setModal(null)} onSalvo={aposSalvar} />}
      {modal?.tipo === "entrega" && <EntregaBonificacaoModal bonificacao={modal.bonificacao} onFechar={() => setModal(null)} onSalvo={aposSalvar} />}
      {revisao && (
        <RevisaoBeneficiosModal
          revisao={revisao.revisao}
          salvando={revisao.salvando}
          erro={revisao.erro}
          mensagem="Uma redução atingiu benefícios já concedidos a este distribuidor. Deseja manter os benefícios ou adequá-los ao novo acumulado?"
          rotuloValor="Acumulado do distribuidor"
          rotuloConfirmar="Confirmar decisão"
          onCancelar={() => setRevisao(null)}
          onConfirmar={confirmarRevisao}
        />
      )}
    </section>
  );
}

// Consolidado por distribuidor: o saldo é único, mesmo com vários links ou pedidos.
function GestaoDistribuidores({ usuario, listaFechada, modoCumulativo, reconciliando, versaoPainel, onReconciliar, onAlterado }) {
  const { toast } = useFeedback();
  const [lista, setLista] = useState(null);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  const [selecionado, setSelecionado] = useState(null);
  const [modal, setModal] = useState(null);
  const [versao, setVersao] = useState(0);
  const isAdmin = usuario?.tipo === "admin";
  const cumulativoAtivo = modoCumulativo === "ativo";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      api.get("/natal-2026/gestao/distribuidores", { params: { busca: busca || undefined } })
        .then((response) => { setLista(response.data); setErro(""); })
        .catch((error) => setErro(getApiErrorMessage(error, "Não foi possível carregar os distribuidores.")));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [busca, versao, versaoPainel]);

  const aposSalvar = (mensagem, distribuidor) => {
    toast.success(mensagem);
    setModal(null);
    setVersao((atual) => atual + 1);
    onAlterado();
    if (distribuidor) setSelecionado(distribuidor.clienteId);
  };

  if (selecionado) {
    return (
      <DetalheDistribuidor
        key={selecionado}
        clienteId={selecionado}
        listaFechada={listaFechada}
        isAdmin={isAdmin}
        cumulativoAtivo={cumulativoAtivo}
        onVoltar={() => { setSelecionado(null); setVersao((atual) => atual + 1); }}
        onAlterado={onAlterado}
      />
    );
  }

  return (
    <section className={styles.secao}>
      {!cumulativoAtivo && (
        <div className={ui.feedback} data-type="warning" role="note">
          Controle cumulativo ainda não ativado. Os números abaixo são uma prévia e cada link usa o saldo do próprio pedido.
        </div>
      )}
      <div className={styles.filtros}>
        <label>Distribuidor<input type="search" value={busca} onChange={(event) => setBusca(event.target.value)} /></label>
        {cumulativoAtivo && (
          <div className={styles.acoes} style={{ marginTop: 0, gridColumn: "1 / -1" }}>
            <button type="button" className={ui.secondaryButton} onClick={() => setModal("compra")}>Registrar compra externa</button>
            <button type="button" className={ui.secondaryButton} onClick={() => setModal("ajuste")}>Ajustar cupons</button>
            {isAdmin && <button type="button" className={ui.ghostButton} disabled={reconciliando} onClick={onReconciliar}>{reconciliando ? "Reconciliando…" : "Reconciliar saldos"}</button>}
          </div>
        )}
      </div>
      {erro && <div className={ui.feedback} data-type="error" role="alert">{erro}</div>}
      {!lista && !erro && <p className={styles.muted} role="status">Carregando distribuidores…</p>}
      {lista && lista.length === 0 && <EmptyState headingLevel={3} title="Nenhum distribuidor encontrado" description="Distribuidores aparecem aqui quando têm pedidos aprovados, compras externas ou links da campanha." />}
      {lista && lista.length > 0 && (
        <div className={styles.rolagem}>
          <table className={styles.tabelaSimples}>
            <thead>
              <tr>
                <th>Distribuidor</th><th>Compras</th><th>Ciclos</th><th>Ciclo atual</th><th>Falta p/ faixa</th>
                <th>Cupons</th><th>Disponíveis</th><th>Utilizados</th><th>Bonif. produtos</th><th>Bonif. MKT</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((linha) => (
                <tr key={linha.clienteId}>
                  <td>
                    {linha.distribuidorNome}
                    {linha.revisaoPendente && <span className={styles.alertaIcone}> ⚠ Revisão pendente</span>}
                    <div><button type="button" className={ui.ghostButton} onClick={() => setSelecionado(linha.clienteId)}>Detalhes</button></div>
                  </td>
                  <td>{formatMoney(linha.compras.total)}</td>
                  <td>{linha.compras.ciclosConcluidos}</td>
                  <td>{linha.compras.cicloAtual}º · {formatMoney(linha.compras.acumuladoCiclo)}</td>
                  <td>{linha.compras.proximaFaixa ? formatMoney(linha.compras.restanteProximaFaixa) : "—"}</td>
                  <td>{linha.cupons.total}</td>
                  <td>{linha.cupons.disponiveis}</td>
                  <td>{linha.cupons.utilizados}</td>
                  <td>{formatMoney(linha.bonificacoes.produtos.concedido)}</td>
                  <td>{formatMoney(linha.bonificacoes.marketing.concedido)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal === "compra" && <CompraExternaModal onFechar={() => setModal(null)} onSalvo={aposSalvar} />}
      {modal === "ajuste" && <AjusteCuponsModal listaFechada={listaFechada} isAdmin={isAdmin} onFechar={() => setModal(null)} onSalvo={aposSalvar} />}
    </section>
  );
}

export default GestaoDistribuidores;
