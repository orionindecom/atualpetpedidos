import { useId, useMemo, useState } from "react";
import api from "../../api/axios";
import ConfirmDialog from "../ConfirmDialog/ConfirmDialog";
import { useModalDialog } from "../../hooks/useModalDialog";
import { getApiErrorMessage } from "../../utils/apiErrors";
import { applyPortfolioChanges, getClientName, planPortfolioChanges } from "../../utils/sellerAssignment";
import styles from "./UserFormModal.module.css";
import portfolio from "./PortfolioModal.module.css";

const normalize = (value) => String(value || "")
  .toLocaleLowerCase("pt-BR")
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "");

const assignedIds = (clients, sellerId) => new Set(
  clients.filter((client) => String(client.vendedorResponsavelId || "") === String(sellerId)).map((client) => String(client._id))
);

const plural = (count, singular, pluralForm) => `${count} ${count === 1 ? singular : pluralForm}`;

// Carteira do vendedor: seleção local, salva somente em "Salvar carteira".
function PortfolioModal({ seller, clients: initialClients, nameOf, reload, onClose, onSaved }) {
  const baseId = useId().replaceAll(":", "");
  const [clients, setClients] = useState(initialClients);
  const [selected, setSelected] = useState(() => assignedIds(initialClients, seller._id));
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const plan = useMemo(
    () => planPortfolioChanges({ sellerId: seller._id, clients, selectedIds: selected }),
    [clients, selected, seller._id]
  );
  const dirty = plan.total > 0;

  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirming("discard");
    else onClose();
  };
  const dialogRef = useModalDialog({ onClose: requestClose, closeDisabled: saving });

  const visible = useMemo(() => {
    const term = normalize(busca.trim());
    return clients.filter((client) => {
      const id = String(client._id);
      const text = normalize([client.nomeFantasia, client.razaoSocial, client.nomeResponsavel, client.cnpj, client.cidade, client.estado].join(" "));
      const matchesFilter = !filtro ||
        (filtro === "selecionados" && selected.has(id)) ||
        (filtro === "livres" && !client.vendedorResponsavelId);
      return (!term || text.includes(term)) && matchesFilter;
    });
  }, [busca, clients, filtro, selected]);

  const toggle = (clientId, checked) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(String(clientId));
      else next.delete(String(clientId));
      return next;
    });
    setFeedback(null);
  };

  const save = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const result = await applyPortfolioChanges(api, { sellerId: seller._id, plan });
      if (!result.conflicts.length && !result.failed.length) {
        onSaved(`Carteira de ${seller.nomeResponsavel} salva com sucesso.`);
        return;
      }
      const freshClients = await reload();
      setClients(freshClients);
      setSelected(assignedIds(freshClients, seller._id));
      const parts = [];
      if (result.saved.length) parts.push(`${plural(result.saved.length, "alteração salva", "alterações salvas")}.`);
      if (result.conflicts.length) {
        const atual = (conflict) => (conflict.currentSellerId
          ? conflict.currentSellerName || "responsável sem acesso ativo"
          : "sem responsável");
        parts.push(`${result.conflicts.length === 1 ? "Este cliente foi alterado" : "Estes clientes foram alterados"} por outra pessoa e não ${result.conflicts.length === 1 ? "foi modificado" : "foram modificados"}: ${result.conflicts.map((conflict) => `${getClientName(conflict)} (agora ${atual(conflict)})`).join(", ")}.`);
      }
      if (result.failed.length) {
        parts.push(`Não foi possível salvar ${result.failed.map(({ client }) => getClientName(client)).join(", ")}: ${getApiErrorMessage(result.failed[0].error)}`);
      }
      parts.push("A lista foi atualizada com a situação atual.");
      setFeedback({ type: result.failed.length ? "error" : "warning", message: parts.join(" ") });
    } catch (error) {
      setFeedback({ type: "error", message: getApiErrorMessage(error, "Não foi possível salvar a carteira.") });
    } finally {
      setSaving(false);
      setConfirming(null);
    }
  };

  const requestSave = () => {
    if (!dirty || saving) return;
    if (plan.remove.length || plan.transfers.length) setConfirming("save");
    else save();
  };

  return (
    <div className={styles.overlay} onMouseDown={(event) => {
      if (event.target === event.currentTarget) requestClose();
    }}>
      <section
        ref={dialogRef}
        className={`${styles.modal} ${portfolio.modal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${baseId}-title`}
        aria-describedby={`${baseId}-description`}
        tabIndex="-1"
      >
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Carteira do vendedor</span>
            <h2 id={`${baseId}-title`}>{seller.nomeResponsavel}</h2>
          </div>
          <button type="button" className={styles.closeButton} onClick={requestClose} disabled={saving}>
            Fechar
          </button>
        </header>

        <div className={portfolio.toolbar}>
          <p id={`${baseId}-description`}>
            Clientes que este vendedor poderá acessar. <strong>{plural(selected.size, "selecionado", "selecionados")}</strong>
          </p>
          <div className={portfolio.controls}>
            <label className={portfolio.search}>
              <span className={portfolio.srOnly}>Buscar distribuidor</span>
              <input
                type="search"
                value={busca}
                placeholder="Buscar distribuidor, CNPJ ou cidade..."
                onChange={(event) => setBusca(event.target.value)}
                autoFocus
              />
            </label>
            <div className={portfolio.filters} role="group" aria-label="Filtrar distribuidores">
              {[["", "Todos"], ["selecionados", "Selecionados"], ["livres", "Sem vendedor"]].map(([value, label]) => (
                <button key={value || "todos"} type="button" aria-pressed={filtro === value} onClick={() => setFiltro(value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.content}>
          {feedback && (
            <div className={portfolio.feedback} data-type={feedback.type} role="alert">{feedback.message}</div>
          )}
          {visible.length === 0 ? (
            <p className={portfolio.empty}>
              {clients.length === 0 ? "Nenhum distribuidor cadastrado." : "Nenhum distribuidor encontrado para a busca."}
            </p>
          ) : (
            <ul className={portfolio.list} aria-label="Distribuidores">
              {visible.map((client) => {
                const id = String(client._id);
                const checked = selected.has(id);
                const owner = client.vendedorResponsavelId && String(client.vendedorResponsavelId) !== String(seller._id)
                  ? nameOf(client.vendedorResponsavelId)
                  : "";
                const wasAssigned = String(client.vendedorResponsavelId || "") === String(seller._id);
                return (
                  <li key={id}>
                    <label className={portfolio.row} data-checked={checked}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={saving}
                        onChange={(event) => toggle(id, event.target.checked)}
                      />
                      <span className={portfolio.client}>
                        <strong>{getClientName(client)}</strong>
                        <small>{[client.razaoSocial, [client.cidade, client.estado].filter(Boolean).join("/")].filter(Boolean).join(" — ") || client.email}</small>
                      </span>
                      <span className={portfolio.status}>
                        {checked && owner && <span className={portfolio.transfer}>Será transferido de {owner}</span>}
                        {!checked && owner && <span className={portfolio.owner}>Com {owner}</span>}
                        {!checked && wasAssigned && <span className={portfolio.removing}>Será removido</span>}
                        {checked && !wasAssigned && !owner && <span className={portfolio.adding}>Será adicionado</span>}
                        {client.ativo === false && <span className={portfolio.owner}>Inativo</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className={styles.footer}>
          <p className={styles.saveState} data-dirty={dirty} aria-live="polite">
            {dirty
              ? [plan.add.length && `${plan.add.length} a adicionar`, plan.remove.length && `${plan.remove.length} a remover`].filter(Boolean).join(", ")
              : "Nenhuma alteração"}
          </p>
          <div className={styles.footerActions}>
            <button type="button" className={styles.secondaryButton} onClick={requestClose} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className={styles.primaryButton} onClick={requestSave} disabled={!dirty || saving}>
              {saving ? "Salvando..." : "Salvar carteira"}
            </button>
          </div>
        </footer>
      </section>

      {confirming === "save" && (
        <ConfirmDialog
          tone="warning"
          icon="clients"
          title="Salvar carteira?"
          message={`As mudanças alteram quais clientes ${seller.nomeResponsavel} poderá acessar.`}
          confirmLabel="Salvar carteira"
          busy={saving}
          onCancel={() => setConfirming(null)}
          onConfirm={save}
        >
          <ul>
            {plan.transfers.map((client) => (
              <li key={client._id}>{getClientName(client)} deixará a carteira de {nameOf(client.vendedorResponsavelId)}.</li>
            ))}
            {plan.remove.map((client) => (
              <li key={client._id}>{getClientName(client)} ficará sem vendedor responsável.</li>
            ))}
            {plan.add.length - plan.transfers.length > 0 && (
              <li>{plural(plan.add.length - plan.transfers.length, "cliente sem vendedor será adicionado", "clientes sem vendedor serão adicionados")}.</li>
            )}
          </ul>
        </ConfirmDialog>
      )}
      {confirming === "discard" && (
        <ConfirmDialog
          tone="warning"
          icon="edit"
          title="Descartar alterações?"
          message="As alterações realizadas ainda não foram salvas."
          cancelLabel="Continuar editando"
          confirmLabel="Descartar"
          onCancel={() => setConfirming(null)}
          onConfirm={() => { setConfirming(null); onClose(); }}
        />
      )}
    </div>
  );
}

export default PortfolioModal;
