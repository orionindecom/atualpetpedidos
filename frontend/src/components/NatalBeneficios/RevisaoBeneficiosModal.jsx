import { useState } from "react";
import ui from "../AdminUi/AdminUi.module.css";
import { useModalDialog } from "../../hooks/useModalDialog";
import { formatDateTimeBR, formatMoney } from "../../utils/natalPremiado";
import styles from "./NatalInterno.module.css";

const descreverFaixa = (faixa) => (faixa && faixa.cupons > 0
  ? `A partir de ${formatMoney(faixa.valorMinimo)}`
  : "Sem faixa (abaixo de R$ 12.000,00)");

// Decisão obrigatória quando o valor de um pedido participante é reduzido.
// Os dados vêm do backend (resposta 409 da edição); cancelar não salva nada.
function RevisaoBeneficiosModal({ revisao, salvando = false, erro = "", onConfirmar, onCancelar }) {
  const [decisao, setDecisao] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const dialogRef = useModalDialog({ onClose: onCancelar, closeDisabled: salvando });
  const antes = revisao.beneficiosAtuais;
  const depois = revisao.beneficiosDoNovoValor;
  const adequar = revisao.impactoAdequar;
  const manter = revisao.impactoManter;
  const semMudanca = depois.cupons >= antes.cupons &&
    depois.marketingPercentual === antes.marketingPercentual &&
    depois.produtosPercentual === antes.produtosPercentual;
  const justificativaValida = justificativa.trim().length >= 10;

  const linhas = [
    ["Valor do pedido", formatMoney(revisao.valorAnterior), formatMoney(revisao.valorNovo)],
    ["Faixa da campanha", descreverFaixa(antes), descreverFaixa(depois)],
    ["Cupons", antes.cupons, depois.cupons],
    ["Bonificação MKT", `${antes.marketingPercentual}%`, `${depois.marketingPercentual}%`],
    ["Bonificação produtos", `${antes.produtosPercentual}%`, `${depois.produtosPercentual}%`],
  ];

  return (
    <div className={`${styles.overlay} ${styles.overlaySuperior}`} onMouseDown={(event) => { if (event.target === event.currentTarget && !salvando) onCancelar(); }}>
      <section ref={dialogRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="natal-revisao-titulo" tabIndex="-1">
        <header className={styles.modalHeader}>
          <div>
            <span>Natal Premiado 2026 · Pedido {revisao.numeroPedido}</span>
            <h2 id="natal-revisao-titulo">Revisão dos benefícios da campanha</h2>
          </div>
          <button type="button" className={ui.secondaryButton} onClick={onCancelar} disabled={salvando}>Fechar</button>
        </header>
        <div className={styles.modalContent}>
          <p className={styles.revisaoMensagem}>
            O valor deste pedido foi reduzido. Deseja manter os benefícios anteriormente conquistados ou adequá-los ao novo valor?
          </p>

          <div className={styles.rolagem}>
            <table className={styles.tabelaSimples}>
              <thead><tr><th>Informação</th><th>Antes</th><th>Depois</th></tr></thead>
              <tbody>
                {linhas.map(([rotulo, valorAntes, valorDepois]) => (
                  <tr key={rotulo}>
                    <th scope="row">{rotulo}</th>
                    <td>{valorAntes}</td>
                    <td data-mudou={String(valorAntes) !== String(valorDepois) || undefined}>{valorDepois}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.muted}>
            Situação atual do lote: {revisao.aprovadas} participação(ões) aprovada(s) e {revisao.pendentes} pendente(s).
          </p>

          <fieldset className={styles.opcoesRevisao} disabled={salvando}>
            <legend className={styles.srOnly}>Decisão sobre os benefícios</legend>
            <label className={styles.opcaoRevisao} data-selecionada={decisao === "manter" || undefined}>
              <input type="radio" name="decisao-revisao" value="manter" checked={decisao === "manter"} onChange={() => setDecisao("manter")} />
              <span>
                <strong>Manter os benefícios conquistados</strong>
                <small>
                  Continuam {manter.cupons} cupons, {antes.marketingPercentual}% em material de marketing e {antes.produtosPercentual}% em produtos.
                  Nenhuma participação é invalidada. Saldo disponível: {manter.saldoDisponivel}.
                </small>
              </span>
            </label>
            <label className={styles.opcaoRevisao} data-selecionada={decisao === "adequar" || undefined}>
              <input type="radio" name="decisao-revisao" value="adequar" checked={decisao === "adequar"} onChange={() => setDecisao("adequar")} />
              <span>
                <strong>Adequar os benefícios ao novo valor</strong>
                {semMudanca ? (
                  <small>O novo valor continua na mesma faixa: os benefícios não mudam.</small>
                ) : (
                  <small>
                    Passam a {adequar.cupons} cupons, {depois.marketingPercentual}% em material de marketing e {depois.produtosPercentual}% em produtos.
                    {adequar.invalidadas > 0
                      ? ` ${adequar.invalidadas} participação(ões) aprovada(s) mais recente(s) será(ão) invalidada(s), com seus cupons.`
                      : " Nenhuma participação aprovada precisa ser invalidada."}
                    {` Saldo disponível: ${adequar.saldoDisponivel}.`}
                    {adequar.cupons === 0 && " O link deixa de aceitar novos cadastros enquanto o limite estiver zerado."}
                    {adequar.pendentesSemSaldo > 0 && ` ${adequar.pendentesSemSaldo} cadastro(s) pendente(s) ficarão sem saldo para aprovação.`}
                  </small>
                )}
              </span>
            </label>
          </fieldset>

          {decisao === "adequar" && adequar.invalidadas > 0 && (
            <section className={styles.bloco} aria-label="Participações que serão invalidadas">
              <h3>Participações que serão invalidadas ({adequar.invalidadas})</h3>
              <p className={styles.muted}>Critério automático: são invalidadas as aprovadas recebidas por último. As mais antigas são preservadas.</p>
              <div className={`${styles.rolagem} ${styles.listaLimitada}`}>
                <table className={styles.tabelaSimples}>
                  <thead><tr><th>Protocolo</th><th>Pet shop</th><th>Recebido em</th><th>Cupom</th></tr></thead>
                  <tbody>
                    {adequar.participacoes.map((item) => (
                      <tr key={item.protocolo}>
                        <td>{item.protocolo}</td>
                        <td>{item.petshop}</td>
                        <td>{formatDateTimeBR(item.recebidoEm)}</td>
                        <td>{item.cupom || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {adequar.invalidadas > adequar.participacoes.length && (
                <p className={styles.muted}>Exibindo as primeiras {adequar.participacoes.length} de {adequar.invalidadas}.</p>
              )}
            </section>
          )}

          <label className={styles.campoTexto}>
            <span>Justificativa administrativa (obrigatória)</span>
            <textarea rows={3} maxLength={1000} value={justificativa} onChange={(event) => setJustificativa(event.target.value)} disabled={salvando} />
          </label>
          {justificativa && !justificativaValida && <p className={styles.muted}>Informe pelo menos 10 caracteres.</p>}
          {erro && <div className={ui.feedback} data-type="error" role="alert">{erro}</div>}

          <div className={styles.acoes}>
            <button type="button" className={ui.secondaryButton} onClick={onCancelar} disabled={salvando}>Cancelar sem salvar</button>
            <button
              type="button"
              className={decisao === "adequar" && adequar.invalidadas > 0 ? ui.dangerButton : ui.primaryButton}
              disabled={salvando || !decisao || !justificativaValida}
              onClick={() => onConfirmar({ decisao, justificativa: justificativa.trim(), cuponsEsperados: revisao.cuponsEsperados })}
            >
              {salvando ? "Salvando…" : "Confirmar decisão e salvar pedido"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default RevisaoBeneficiosModal;
