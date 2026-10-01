import { useEffect, useId, useMemo, useState } from "react";
import api from "../../api/axios";
import ConfirmDialog from "../ConfirmDialog/ConfirmDialog";
import { useFeedback } from "../Feedback/feedbackContext";
import { getApiErrorMessage } from "../../utils/apiErrors";
import {
  buildConflictDialog,
  describeSellerChange,
  getClientName,
  groupResponsibles,
  responsibleScopeLabel,
  saveSellerAssignment,
} from "../../utils/sellerAssignment";
import styles from "./ClientDetailModal.module.css";

const UNKNOWN_RESPONSIBLE = "Responsável sem acesso ativo";

// Responsável pelo cliente: selecionar altera apenas o rascunho local.
// A API só é chamada em "Salvar alteração" (e após confirmação quando há troca ou remoção),
// enviando o responsável observado ao abrir a edição para a comparação atômica do backend.
function SellerAssignment({ cliente, onChange, onEditingChange }) {
  const selectId = useId();
  const { dialog } = useFeedback();
  const [responsaveis, setResponsaveis] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [currentId, setCurrentId] = useState(cliente.vendedorResponsavelId ? String(cliente.vendedorResponsavelId) : "");
  // Nomes informados pelo backend em conflitos (ex.: responsável que não está mais ativo).
  const [knownNames, setKnownNames] = useState({});
  const [editing, setEditing] = useState(false);
  const [expectedId, setExpectedId] = useState("");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    let active = true;
    api.get("/usuarios/responsaveis")
      .then(({ data }) => { if (active) setResponsaveis(Array.isArray(data) ? data : []); })
      .catch((error) => { if (active) setLoadError(getApiErrorMessage(error, "Não foi possível carregar os responsáveis.")); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    onEditingChange?.(Boolean(pending) || (editing && Boolean(draft) && draft !== expectedId));
  }, [draft, editing, expectedId, onEditingChange, pending]);

  const byId = useMemo(() => new Map((responsaveis || []).map((item) => [String(item._id), item])), [responsaveis]);
  const { vendedores, comerciais } = useMemo(() => groupResponsibles(responsaveis || []), [responsaveis]);
  const nameOf = (id) => byId.get(String(id))?.nomeResponsavel || knownNames[String(id)] || UNKNOWN_RESPONSIBLE;
  const clientName = getClientName(cliente);
  const current = currentId ? byId.get(currentId) : null;

  const startEdit = () => {
    setExpectedId(currentId);
    setDraft(currentId);
    setFeedback(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft("");
  };

  const showConflict = async (conflict) => {
    setPending(null);
    if (conflict.currentSellerId && conflict.currentSellerName) {
      setKnownNames((names) => ({ ...names, [conflict.currentSellerId]: conflict.currentSellerName }));
    }
    await dialog.alert(buildConflictDialog({ clientName, ...conflict }));
    // A intenção conflitante é descartada; a tela passa a mostrar a relação atual
    // e uma nova edição parte desse estado.
    const latest = conflict.currentSellerId || "";
    setCurrentId(latest);
    setEditing(false);
    setDraft("");
    setExpectedId("");
    onChange?.({ ...cliente, vendedorResponsavelId: latest || null });
  };

  const persist = async (nextId) => {
    const baseId = editing ? expectedId : currentId;
    const change = describeSellerChange({ currentId: baseId, nextId, clientName, nameOf });
    setSaving(true);
    setFeedback(null);
    try {
      const result = await saveSellerAssignment(api, { clientId: cliente._id, expectedSellerId: baseId || null, nextSellerId: nextId || null });
      if (result.status === "conflict") {
        setSaving(false);
        await showConflict(result);
        return;
      }
      const savedId = result.client?.vendedorResponsavelId ? String(result.client.vendedorResponsavelId) : "";
      setCurrentId(savedId);
      setEditing(false);
      setFeedback({ type: "success", message: change.success });
      onChange?.({ ...cliente, vendedorResponsavelId: savedId || null });
    } catch (error) {
      setFeedback({ type: "error", message: getApiErrorMessage(error, "Não foi possível alterar o responsável.") });
    } finally {
      setSaving(false);
      setPending(null);
    }
  };

  const requestSave = (nextId) => {
    const baseId = editing ? expectedId : currentId;
    const change = describeSellerChange({ currentId: baseId, nextId, clientName, nameOf });
    if (change.kind === "none" || saving) return;
    if (change.needsConfirmation) setPending({ nextId, change });
    else persist(nextId);
  };

  const renderOption = (item) => {
    const id = String(item._id);
    return (
      <option key={id} value={id}>
        {item.nomeResponsavel}{id === expectedId ? " (atual)" : ""}
      </option>
    );
  };

  return (
    <section className={styles.sellerSection} aria-labelledby={`${selectId}-title`}>
      <div className={styles.sectionHeading}>
        <div>
          <h3 id={`${selectId}-title`}>Vendedor responsável</h3>
          <p>Define quem responde comercialmente por este cliente. É salvo separadamente dos dados cadastrais.</p>
        </div>
      </div>

      {feedback && (
        <div
          className={feedback.type === "success" ? styles.successMessage : styles.errorMessage}
          role={feedback.type === "success" ? "status" : "alert"}
        >
          {feedback.message}
        </div>
      )}

      {loadError ? (
        <p className={styles.errorMessage} role="alert">{loadError}</p>
      ) : !responsaveis ? (
        <p className={styles.stateMessage}>Carregando responsáveis...</p>
      ) : editing ? (
        <div className={styles.sellerEditor}>
          <label htmlFor={selectId}>Novo responsável</label>
          <div className={styles.sellerEditorRow}>
            <select id={selectId} value={draft} disabled={saving} onChange={(event) => setDraft(event.target.value)}>
              <option value="" disabled>Selecione um responsável</option>
              {expectedId && !byId.has(expectedId) && (
                <option value={expectedId} disabled>{nameOf(expectedId)} (atual)</option>
              )}
              {vendedores.length > 0 && <optgroup label="Vendedores">{vendedores.map(renderOption)}</optgroup>}
              {comerciais.length > 0 && <optgroup label="Comercial (visão global)">{comerciais.map(renderOption)}</optgroup>}
            </select>
            <button type="button" className={styles.secondaryButton} onClick={cancelEdit} disabled={saving}>
              Cancelar
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => requestSave(draft)}
              disabled={saving || !draft || draft === expectedId}
            >
              {saving ? "Salvando..." : "Salvar alteração"}
            </button>
          </div>
          {responsaveis.length === 0 && <small>Nenhum Vendedor ou Comercial ativo disponível.</small>}
          {draft && byId.get(draft) && <small>{responsibleScopeLabel(byId.get(draft).tipo)}</small>}
          {draft && draft !== expectedId && !saving && <small className={styles.unsaved}>Alteração ainda não salva.</small>}
        </div>
      ) : (
        <div className={styles.sellerCurrent}>
          <div>
            {currentId ? (
              <>
                <strong>{nameOf(currentId)}</strong>
                <span>{current ? responsibleScopeLabel(current.tipo) : "Não está entre os responsáveis ativos"}</span>
              </>
            ) : (
              <span className={styles.sellerEmpty}>Nenhum vendedor atribuído</span>
            )}
          </div>
          <div className={styles.sellerActions}>
            {currentId && (
              <button type="button" className={styles.dangerButton} onClick={() => requestSave("")} disabled={saving}>
                {saving ? "Removendo..." : "Remover"}
              </button>
            )}
            <button type="button" className={styles.secondaryButton} onClick={startEdit} disabled={saving}>
              {currentId ? "Alterar" : "Definir vendedor"}
            </button>
          </div>
        </div>
      )}

      {pending && (
        <ConfirmDialog
          tone={pending.change.kind === "remove" ? "danger" : "warning"}
          icon={pending.change.kind === "remove" ? "userMinus" : "userSwitch"}
          busyLabel={pending.change.kind === "remove" ? "Removendo..." : "Salvando..."}
          title={pending.change.title}
          message={pending.change.message}
          confirmLabel={pending.change.confirmLabel}
          busy={saving}
          onCancel={() => setPending(null)}
          onConfirm={() => persist(pending.nextId)}
        />
      )}
    </section>
  );
}

export default SellerAssignment;
