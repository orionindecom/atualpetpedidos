import { formatDateTimeBR, formatMoney } from "../../utils/natalPremiado";
import styles from "./NatalInterno.module.css";

const resumoFaixa = (faixa) => (faixa?.cupons > 0
  ? `${faixa.cupons} cupons · ${faixa.marketingPercentual}% MKT · ${faixa.produtosPercentual}% produtos`
  : "Sem benefícios (0 cupons)");

// Histórico das revisões de benefícios de um lote. A gestão vê justificativa e
// participações invalidadas; o distribuidor vê decisão, valores e faixa resultante.
function RevisoesLote({ revisoes = [], revisaoPendente, gestor = false }) {
  if (!revisoes.length && !revisaoPendente) return null;
  return (
    <section className={styles.bloco} aria-label="Revisões de benefícios">
      <h3>Revisões de benefícios</h3>
      {revisaoPendente && (
        <p className={styles.alertaTexto} role="note">
          Redução de {formatMoney(revisaoPendente.valorAnterior)} para {formatMoney(revisaoPendente.valorNovo)} sem decisão administrativa
          {gestor ? ". Os benefícios foram mantidos até a revisão: edite o pedido para registrar a decisão." : ". Os benefícios atuais seguem válidos até a revisão da Atual Pet."}
        </p>
      )}
      <div className={styles.revisoes}>
        {revisoes.map((revisao) => (
          <article key={revisao._id} className={styles.revisaoItem}>
            <strong>
              {revisao.decisao === "manter" ? "Benefícios mantidos" : "Benefícios adequados ao novo valor"} · {formatDateTimeBR(revisao.em)}
            </strong>
            <span>Pedido: {formatMoney(revisao.valorAnterior)} → {formatMoney(revisao.valorNovo)}</span>
            <span>Antes: {resumoFaixa(revisao.faixaAnterior)}</span>
            <span>Depois: {resumoFaixa(revisao.faixaResultante)}</span>
            {revisao.totalInvalidadas > 0 && <span>{revisao.totalInvalidadas} participação(ões) aprovada(s) invalidada(s) por revisão de faixa.</span>}
            {revisao.ajusteBonificacaoPendente && <span>Bonificações alteradas após o início da operação: verificar ajuste administrativo.</span>}
            {gestor && (
              <>
                <span>Responsável: {revisao.autorNome || "—"}</span>
                <span>Justificativa: {revisao.justificativa}</span>
                {revisao.participacoesInvalidadas?.length > 0 && (
                  <details>
                    <summary>Participações e cupons invalidados</summary>
                    <ul className={styles.historico}>
                      {revisao.participacoesInvalidadas.map((item) => (
                        <li key={item.participacaoId}>{item.protocolo} · cupom {item.cupomCodigo || "—"} · recebido {formatDateTimeBR(item.recebidoEm)}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export default RevisoesLote;
