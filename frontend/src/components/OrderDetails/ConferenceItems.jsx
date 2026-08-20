import styles from "./OrderDetails.module.css";

const FINAL_STATUS_LABELS = {
  completo: "Completo",
  parcial: "Atendimento parcial",
  indisponivel: "Indisponível",
  excedente: "Acima do pedido atual",
};

function ConferenceItems({
  items = [],
  values = {},
  editable = false,
  onChange,
}) {
  return (
    <div className={styles.itemsTable}>
      {items.map((item) => {
        const produtoId = String(item.produtoId);
        const requested = Number(item.quantidadeSolicitada ?? item.quantidade ?? 0);
        const separated = Number(item.quantidadeSeparada ?? 0);
        const missingSeparation = Number(
          item.quantidadeFaltanteSeparacao ?? Math.max(requested - separated, 0)
        );
        const checkedValue = editable
          ? values[produtoId]
          : item.quantidadeConferida;
        const hasChecked =
          checkedValue !== null &&
          checkedValue !== undefined &&
          checkedValue !== "";
        const checked = hasChecked ? Number(checkedValue) : null;
        const difference = checked === null ? null : checked - requested;
        const currentStatus = separated > requested
          ? "excedente"
          : separated < requested
            ? separated === 0 ? "indisponivel" : "parcial"
            : checked === requested ? "completo" : item.situacaoFinal;

        return (
          <div className={`${styles.itemRow} ${styles.conferenceRow}`} key={`${produtoId}-${item.nomeProduto}`}>
            <div className={styles.itemIdentity}>
              <strong>{item.nomeProduto}</strong>
              <span data-item-status={currentStatus}>
                {FINAL_STATUS_LABELS[currentStatus] || "Aguardando conferência"}
              </span>
            </div>
            <div className={styles.quantityCell}>
              <span>Solicitado</span>
              <strong>{requested}</strong>
            </div>
            <div className={styles.quantityCell}>
              <span>Separado</span>
              <strong>{separated}</strong>
            </div>
            <div className={styles.quantityCell} data-shortage={missingSeparation > 0 || undefined}>
              <span>Faltante</span>
              <strong>{missingSeparation}</strong>
            </div>
            <div className={styles.quantityCell}>
              <span>Conferido</span>
              {editable ? (
                <input
                  aria-label={`Quantidade conferida de ${item.nomeProduto}`}
                  type="number"
                  min="0"
                  max={separated}
                  step="any"
                  required
                  value={values[produtoId] ?? ""}
                  onChange={(event) => onChange(produtoId, event.target.value)}
                />
              ) : (
                <strong>{checked ?? "—"}</strong>
              )}
            </div>
            <div className={styles.quantityCell} data-shortage={difference < 0 || undefined}>
              <span>Diferença pedido</span>
              <strong>{difference ?? "—"}</strong>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default ConferenceItems;
