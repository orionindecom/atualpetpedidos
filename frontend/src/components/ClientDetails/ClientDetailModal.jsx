import { useState } from "react";
import ConfirmDialog from "../ConfirmDialog/ConfirmDialog";
import SellerAssignment from "./SellerAssignment";
import { getAuthSession } from "../../utils/authSession";
import { hasPermission } from "../../utils/permissions";
import {
  formatClientDocument,
  getClientAccountTypeLabel,
  getClientDisplayName,
  getClientDocumentLabel,
  isAvailableDistributorTable,
  isClientAccountActive,
  isGroomerAccount,
} from "../../utils/clientAdmin";
import { useModalDialog } from "../../hooks/useModalDialog";
import styles from "./ClientDetailModal.module.css";

const STATUS_LABELS = {
  pendente: "Pendente",
  aprovado: "Aprovado",
  reprovado: "Reprovado",
  inativo: "Aprovado (cadastro legado)",
};

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
};

const display = (value) => value || "—";

function ClientDetailModal({
  client,
  form,
  tables,
  loading,
  editing,
  saving,
  actionBusy,
  feedback,
  onClose,
  onStartEdit,
  onCancelEdit,
  onSubmit,
  onFieldChange,
  onApprove,
  onReject,
  onToggleActive,
  onResetPassword,
  onClientChange,
}) {
  const hasClient = Boolean(client && typeof client === "object");
  const groomer = hasClient && isGroomerAccount(client);
  const accountTypeLabel = hasClient ? getClientAccountTypeLabel(client) : "cadastro";
  const safeForm = form && typeof form === "object" ? form : {};
  const availableTables = Array.isArray(tables)
    ? tables.filter(isAvailableDistributorTable)
    : [];
  const currentTable = hasClient && client.tabelaPrecoId && typeof client.tabelaPrecoId === "object"
    ? client.tabelaPrecoId
    : null;
  const currentTableAvailable = hasClient && availableTables.some(
    (table) => String(table._id) === String(safeForm.tabelaPrecoId)
  );
  const accountActive = hasClient ? isClientAccountActive(client) : false;
  const documentLabel = hasClient ? getClientDocumentLabel(client.cnpj) : "CPF/CNPJ";
  const formattedDocument = hasClient ? formatClientDocument(client.cnpj) : "";
  const approvalStatus = hasClient ? client.statusCadastro || "pendente" : "";
  const canToggleActive = ["aprovado", "inativo"].includes(approvalStatus);
  const busy = saving || actionBusy;
  const [sellerDirty, setSellerDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const canAssignSeller = hasClient && client.tipo === "cliente" && hasPermission(getAuthSession()?.usuario, "usuarios");
  const requestClose = () => {
    if (busy) return;
    if (sellerDirty) setConfirmDiscard(true);
    else onClose();
  };
  const dialogRef = useModalDialog({ onClose: requestClose, closeDisabled: busy });

  return (
    <div className={styles.overlay} onMouseDown={(event) => {
      if (event.target === event.currentTarget) requestClose();
    }}>
      <section
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-detail-title"
        tabIndex="-1"
      >
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Cadastro de {accountTypeLabel}</span>
            <h2 id="client-detail-title">
              {getClientDisplayName(client) || "Carregando cadastro"}
            </h2>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            aria-label="Fechar detalhes do cliente"
            onClick={requestClose}
            disabled={busy}
          >
            Fechar
          </button>
        </header>

        <div className={styles.modalContent}>
          {loading && <p className={styles.stateMessage}>Carregando dados do cadastro...</p>}

          {!loading && !hasClient && (
            <p className={styles.errorMessage} role="alert">
              {feedback?.message || "Não foi possível carregar este cadastro."}
            </p>
          )}

          {!loading && hasClient && (
            <>
              {feedback?.message && (
                <div
                  className={feedback.type === "success" ? styles.successMessage : styles.errorMessage}
                  role="status"
                >
                  {feedback.message}
                </div>
              )}

            <form onSubmit={onSubmit}>
              <div className={styles.sectionHeading}>
                <div>
                  <h3>Dados cadastrais</h3>
                  <p>E-mail e CPF/CNPJ identificam a conta e permanecem somente para leitura.</p>
                </div>
                {!editing && (
                  <button type="button" className={styles.secondaryButton} onClick={onStartEdit}>
                    Editar
                  </button>
                )}
              </div>

              {editing ? (
                <div className={styles.formGrid}>
                  <label>
                    Responsável
                    <input
                      name="nomeResponsavel"
                      value={safeForm.nomeResponsavel || ""}
                      onChange={onFieldChange}
                      maxLength={120}
                      required
                    />
                  </label>
                  {!groomer && <>
                    <label>
                      Razão social
                      <input name="razaoSocial" value={safeForm.razaoSocial || ""} onChange={onFieldChange} maxLength={160} />
                    </label>
                    <label>
                      Nome fantasia
                      <input name="nomeFantasia" value={safeForm.nomeFantasia || ""} onChange={onFieldChange} maxLength={160} />
                    </label>
                    <label>
                      Telefone
                      <input name="telefone" value={safeForm.telefone || ""} onChange={onFieldChange} maxLength={32} />
                    </label>
                  </>}
                  {groomer && <>
                    <label>
                      Nome profissional ou pet shop
                      <input name="nomeProfissional" value={safeForm.nomeProfissional || ""} onChange={onFieldChange} maxLength={160} />
                    </label>
                    <label>
                      Cidade
                      <input name="cidade" value={safeForm.cidade || ""} onChange={onFieldChange} maxLength={120} required />
                    </label>
                    <label>
                      Estado
                      <input name="estado" value={safeForm.estado || ""} onChange={onFieldChange} maxLength={2} required />
                    </label>
                    <label>
                      Instagram
                      <input name="instagram" value={safeForm.instagram || ""} onChange={onFieldChange} maxLength={160} />
                    </label>
                    <label>
                      TikTok
                      <input name="tiktok" value={safeForm.tiktok || ""} onChange={onFieldChange} maxLength={160} />
                    </label>
                    <label>
                      Observação
                      <input name="observacaoCadastro" value={safeForm.observacaoCadastro || ""} onChange={onFieldChange} maxLength={1000} />
                    </label>
                  </>}
                  <label>
                    WhatsApp
                    <input
                      name="whatsapp"
                      value={safeForm.whatsapp || ""}
                      onChange={onFieldChange}
                      maxLength={32}
                    />
                  </label>
                  {!groomer && <label>
                    Tabela de preços
                    <select
                      name="tabelaPrecoId"
                      value={safeForm.tabelaPrecoId || ""}
                      onChange={onFieldChange}
                    >
                      <option value="">Selecione uma tabela</option>
                      {safeForm.tabelaPrecoId && !currentTableAvailable && (
                        <option value={safeForm.tabelaPrecoId} disabled>
                          {currentTable?.nome || "Tabela atual"} (indisponível)
                        </option>
                      )}
                      {availableTables.map((table) => (
                        <option key={table._id} value={table._id}>{table.nome}</option>
                      ))}
                    </select>
                  </label>}
                  <label>
                    {documentLabel}
                    <input value={formattedDocument} readOnly aria-readonly="true" />
                  </label>
                  <label>
                    E-mail
                    <input value={client.email || ""} readOnly aria-readonly="true" />
                  </label>
                </div>
              ) : (
                <dl className={styles.detailGrid}>
                  <div><dt>Responsável</dt><dd>{display(client.nomeResponsavel)}</dd></div>
                  {!groomer && <>
                    <div><dt>Razão social</dt><dd>{display(client.razaoSocial)}</dd></div>
                    <div><dt>Nome fantasia</dt><dd>{display(client.nomeFantasia)}</dd></div>
                  </>}
                  {groomer && <>
                    <div><dt>Nome profissional ou pet shop</dt><dd>{display(client.nomeProfissional)}</dd></div>
                    <div><dt>Cidade</dt><dd>{display(client.cidade)}</dd></div>
                    <div><dt>Estado</dt><dd>{display(client.estado)}</dd></div>
                    <div><dt>Instagram</dt><dd>{display(client.instagram)}</dd></div>
                    <div><dt>TikTok</dt><dd>{display(client.tiktok)}</dd></div>
                    <div><dt>Observação</dt><dd>{display(client.observacaoCadastro)}</dd></div>
                  </>}
                  <div><dt>{documentLabel}</dt><dd>{display(formattedDocument)}</dd></div>
                  <div><dt>E-mail</dt><dd>{display(client.email)}</dd></div>
                  {!groomer && <div><dt>Telefone</dt><dd>{display(client.telefone)}</dd></div>}
                  <div><dt>WhatsApp</dt><dd>{display(client.whatsapp)}</dd></div>
                  {!groomer && <div><dt>Tabela atual</dt><dd>{display(currentTable?.nome)}</dd></div>}
                </dl>
              )}

              {editing && (
                <div className={styles.editActions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={onCancelEdit}
                    disabled={saving}
                  >
                    Cancelar
                  </button>
                  <button type="submit" className={styles.primaryButton} disabled={saving}>
                    {saving ? "Salvando..." : "Salvar alterações"}
                  </button>
                </div>
              )}
            </form>

            {canAssignSeller && (
              <SellerAssignment
                key={client._id}
                cliente={client}
                onChange={onClientChange}
                onEditingChange={setSellerDirty}
              />
            )}

            <section className={styles.accountSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <h3>Situação da conta</h3>
                  <p>Aprovação cadastral e acesso ao sistema são controles independentes.</p>
                </div>
              </div>
              <dl className={styles.detailGrid}>
                <div><dt>Aprovação</dt><dd>{STATUS_LABELS[approvalStatus] || approvalStatus}</dd></div>
                <div><dt>Acesso</dt><dd>{accountActive ? "Ativo" : "Inativo"}</dd></div>
                <div><dt>Cadastrado em</dt><dd>{formatDate(client.createdAt)}</dd></div>
                <div><dt>Aprovado em</dt><dd>{formatDate(client.aprovadoEm)}</dd></div>
                <div><dt>Última atualização</dt><dd>{formatDate(client.updatedAt)}</dd></div>
              </dl>

              <div className={styles.accountActions}>
                {approvalStatus === "pendente" && (
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={onApprove}
                    disabled={busy || editing}
                  >
                    Aprovar {accountTypeLabel}
                  </button>
                )}
                {approvalStatus === "pendente" && (
                  <button
                    type="button"
                    className={styles.dangerButton}
                    onClick={onReject}
                    disabled={busy || editing}
                  >
                    Rejeitar cadastro
                  </button>
                )}
                {canToggleActive && (
                  <button
                    type="button"
                    className={accountActive ? styles.dangerButton : styles.activateButton}
                    onClick={onToggleActive}
                    disabled={busy || editing}
                  >
                    {accountActive ? "Desativar acesso" : "Reativar acesso"}
                  </button>
                )}
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={onResetPassword}
                  disabled={busy || editing || !accountActive}
                >
                  Redefinir senha
                </button>
              </div>
            </section>
            </>
          )}
        </div>
      </section>

      {confirmDiscard && (
        <ConfirmDialog
          tone="warning"
          icon="edit"
          title="Descartar alterações?"
          message="A alteração do vendedor responsável ainda não foi salva."
          cancelLabel="Continuar editando"
          confirmLabel="Descartar"
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => { setConfirmDiscard(false); onClose(); }}
        />
      )}
    </div>
  );
}

export default ClientDetailModal;
