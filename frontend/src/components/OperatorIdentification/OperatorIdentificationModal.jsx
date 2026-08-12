import { useEffect, useRef, useState } from "react";
import styles from "./OperatorIdentificationModal.module.css";

function OperatorIdentificationModal({
  orderNumber,
  operators = [],
  loading = false,
  feedback = "",
  onClose,
  onContinue,
}) {
  const pinRef = useRef(null);
  const [operatorId, setOperatorId] = useState(operators[0]?._id || "");
  const [pin, setPin] = useState("");

  const selectedOperatorId = operators.some((operator) => operator._id === operatorId)
    ? operatorId
    : operators[0]?._id || "";

  useEffect(() => {
    pinRef.current?.focus();
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    const success = await onContinue({ operatorId: selectedOperatorId, pin });
    if (!success) {
      setPin("");
      pinRef.current?.focus();
    }
  };

  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="operator-identification-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className={styles.eyebrow}>Pedido {orderNumber}</span>
        <h2 id="operator-identification-title">Quem está operando?</h2>
        <p>Identifique-se para acessar este pedido.</p>

        {feedback && <div className={styles.feedback} role="alert">{feedback}</div>}

        <form onSubmit={submit}>
          <label>
            Operador
            <select
              value={selectedOperatorId}
              onChange={(event) => setOperatorId(event.target.value)}
              disabled={loading || operators.length === 0}
            >
              {operators.length === 0 && <option value="">Nenhum operador ativo</option>}
              {operators.map((operator) => (
                <option key={operator._id} value={operator._id}>{operator.nome}</option>
              ))}
            </select>
          </label>

          <label>
            PIN do operador
            <input
              ref={pinRef}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{4,6}"
              minLength="4"
              maxLength="6"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={loading || operators.length === 0}
              aria-describedby="operator-pin-hint"
              required
            />
            <small id="operator-pin-hint">Use seu PIN de 4 a 6 dígitos.</small>
          </label>

          <div className={styles.actions}>
            <button type="button" onClick={onClose} disabled={loading}>Cancelar</button>
            <button
              type="submit"
              disabled={loading || !selectedOperatorId || pin.length < 4}
            >
              {loading ? "Identificando..." : "Continuar"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default OperatorIdentificationModal;
