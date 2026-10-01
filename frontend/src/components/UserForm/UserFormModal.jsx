import { useId, useMemo, useState } from "react";
import api from "../../api/axios";
import ConfirmDialog from "../ConfirmDialog/ConfirmDialog";
import { useModalDialog } from "../../hooks/useModalDialog";
import { getApiErrorMessage } from "../../utils/apiErrors";
import {
  EXTERNAL_PROFILES,
  INTERNAL_PROFILES,
  applyProfileDefaults,
  buildUserPayload,
  changeUserProfile,
  countCustomizedPermissions,
  createUserForm,
  getPermissionState,
  groupPermissions,
  isUserFormDirty,
  profileLabel,
  togglePermission,
  validateUserForm,
} from "../../utils/userAdmin";
import styles from "./UserFormModal.module.css";

const LOCK_REASONS = {
  pedidosTodos: "Vendedor permanece restrito à própria carteira.",
  logistica: "Exclusiva do perfil Logística.",
  producao: "Exclusiva do perfil Logística.",
  conferencia: "Exclusiva do perfil Logística.",
  faturamento: "Exclusiva do perfil Logística.",
};

function PermissionGroup({ group, form, presets, disabled, onToggle }) {
  const states = group.keys.map((key) => ({ key, ...getPermissionState(form, key, presets) }));
  const enabled = states.filter((state) => state.checked).length;
  return (
    <fieldset className={styles.group}>
      <legend>
        <span>{group.title}</span>
        <small>{enabled} de {states.length}</small>
      </legend>
      {states.map((state) => {
        const hint = state.locked && form.tipo !== "admin"
          ? LOCK_REASONS[state.key] || "Definida pelo perfil."
          : "";
        return (
          <label key={state.key} className={styles.check} data-locked={state.locked} data-customized={state.customized}>
            <input
              type="checkbox"
              checked={state.checked}
              disabled={disabled || state.locked}
              onChange={(event) => onToggle(state.key, event.target.checked)}
              aria-describedby={hint ? `hint-${state.key}` : undefined}
            />
            <span className={styles.checkText}>
              <span>{presets.permissoes[state.key]}</span>
              {hint && <small id={`hint-${state.key}`}>{hint}</small>}
            </span>
            {state.customized && (
              <span className={styles.customTag} title={state.presetValue ? "Padrão do perfil: permitido" : "Padrão do perfil: negado"}>
                Personalizada
              </span>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}

function UserFormModal({ user, presets, currentUserId, onClose, onSaved }) {
  const isNew = !user;
  const baseId = useId().replaceAll(":", "");
  const [initial] = useState(() => createUserForm(user, presets));
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [profileNotice, setProfileNotice] = useState(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const focusField = (name) => document.getElementById(`${baseId}-${name}`)?.focus();

  const dirty = isUserFormDirty(form, initial);
  const isSelf = !isNew && String(user._id) === String(currentUserId);
  const isExternal = EXTERNAL_PROFILES.includes(form.tipo);
  const profileOptions = isExternal ? [form.tipo] : INTERNAL_PROFILES;
  const groups = useMemo(() => groupPermissions(presets.permissoes), [presets.permissoes]);
  const customized = countCustomizedPermissions(form, presets);

  const requestClose = () => {
    if (submitting) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };
  const dialogRef = useModalDialog({ onClose: requestClose, closeDisabled: submitting });

  const updateField = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const changeProfile = (tipo) => {
    const { form: next, keptCustomizations } = changeUserProfile(form, tipo, presets);
    setForm(next);
    setProfileNotice({ tipo, kept: keptCustomizations });
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitting || (!isNew && !dirty)) return;
    const localErrors = validateUserForm(form);
    if (Object.keys(localErrors).length) {
      setErrors(localErrors);
      const first = ["nomeResponsavel", "email", "senha"].find((name) => localErrors[name]);
      focusField(first);
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      const payload = buildUserPayload(form, presets);
      const { data } = isNew
        ? await api.post("/usuarios", payload)
        : await api.patch(`/usuarios/${user._id}`, payload);
      onSaved(data, { isNew, isSelf });
    } catch (error) {
      const message = getApiErrorMessage(error, isNew ? "Não foi possível criar o usuário." : "Não foi possível salvar as alterações.");
      if (error.response?.status === 409 && /e-mail/i.test(message)) {
        setErrors((current) => ({ ...current, email: message }));
        focusField("email");
      } else {
        setFormError(message);
      }
      setSubmitting(false);
    }
  };

  const fieldProps = (name) => ({
    id: `${baseId}-${name}`,
    "aria-invalid": errors[name] ? "true" : undefined,
    "aria-describedby": errors[name] ? `${baseId}-${name}-error` : undefined,
  });
  const fieldError = (name) => errors[name] && (
    <small className={styles.fieldError} id={`${baseId}-${name}-error`}>{errors[name]}</small>
  );

  return (
    <div className={styles.overlay} onMouseDown={(event) => {
      if (event.target === event.currentTarget) requestClose();
    }}>
      <section
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${baseId}-title`}
        tabIndex="-1"
      >
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>{isNew ? "Usuários" : profileLabel(initial.tipo)}</span>
            <h2 id={`${baseId}-title`}>{isNew ? "Novo usuário" : `Editar ${initial.nomeResponsavel || "usuário"}`}</h2>
          </div>
          <button type="button" className={styles.closeButton} onClick={requestClose} disabled={submitting}>
            Fechar
          </button>
        </header>

        <form className={styles.form} onSubmit={submit} noValidate>
          <div className={styles.content}>
            {formError && <div className={styles.formError} role="alert">{formError}</div>}

            <section className={styles.section} aria-labelledby={`${baseId}-basic`}>
              <h3 id={`${baseId}-basic`}>Informações básicas</h3>
              <div className={styles.fields}>
                <div className={styles.field}>
                  <label htmlFor={`${baseId}-nomeResponsavel`}>Nome</label>
                  <input
                    {...fieldProps("nomeResponsavel")}
                    value={form.nomeResponsavel}
                    maxLength={120}
                    autoComplete="off"
                    autoFocus
                    onChange={(event) => updateField("nomeResponsavel", event.target.value)}
                  />
                  {fieldError("nomeResponsavel")}
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${baseId}-email`}>E-mail</label>
                  <input
                    {...fieldProps("email")}
                    type="email"
                    value={form.email}
                    maxLength={254}
                    autoComplete="off"
                    onChange={(event) => updateField("email", event.target.value)}
                  />
                  {fieldError("email")}
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${baseId}-senha`}>{isNew ? "Senha inicial" : "Nova senha"}</label>
                  <div className={styles.passwordControl}>
                    <input
                      {...fieldProps("senha")}
                      type={showPassword ? "text" : "password"}
                      value={form.senha}
                      maxLength={128}
                      autoComplete="new-password"
                      placeholder={isNew ? "" : "Manter senha atual"}
                      onChange={(event) => updateField("senha", event.target.value)}
                    />
                    <button type="button" onClick={() => setShowPassword((value) => !value)} aria-pressed={showPassword}>
                      {showPassword ? "Ocultar" : "Mostrar"}
                    </button>
                  </div>
                  {fieldError("senha") || (
                    <small className={styles.help}>
                      {isNew ? "Mínimo de 8 caracteres." : "Preencha somente para definir uma nova senha."}
                    </small>
                  )}
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${baseId}-tipo`}>Perfil base</label>
                  <select
                    id={`${baseId}-tipo`}
                    value={form.tipo}
                    disabled={isExternal || isSelf}
                    onChange={(event) => changeProfile(event.target.value)}
                  >
                    {profileOptions.map((tipo) => <option key={tipo} value={tipo}>{profileLabel(tipo)}</option>)}
                  </select>
                  <small className={styles.help}>
                    {isSelf
                      ? "Você não pode alterar o próprio perfil administrativo."
                      : isExternal
                        ? "Contas de distribuidores e groomers mantêm o perfil do cadastro."
                        : "O perfil define as permissões iniciais."}
                  </small>
                </div>
                <fieldset className={`${styles.field} ${styles.statusField}`} disabled={isSelf}>
                  <legend>Status</legend>
                  <div className={styles.segmented}>
                    <label>
                      <input type="radio" name={`${baseId}-ativo`} checked={form.ativo} onChange={() => updateField("ativo", true)} />
                      <span>Ativo</span>
                    </label>
                    <label>
                      <input type="radio" name={`${baseId}-ativo`} checked={!form.ativo} onChange={() => updateField("ativo", false)} />
                      <span>Inativo</span>
                    </label>
                  </div>
                  <small className={styles.help}>
                    {isSelf ? "Você não pode desativar a própria conta." : "Usuários inativos não conseguem entrar na Central."}
                  </small>
                </fieldset>
              </div>
            </section>

            <section className={styles.section} aria-labelledby={`${baseId}-permissions`}>
              <div className={styles.sectionHeading}>
                <div>
                  <h3 id={`${baseId}-permissions`}>Permissões</h3>
                  <p>O perfil define as permissões iniciais. Você pode personalizá-las abaixo.</p>
                </div>
                {form.tipo !== "admin" && (
                  <div className={styles.permissionSummary}>
                    {customized ? (
                      <>
                        <span className={styles.customCount}>{customized} {customized === 1 ? "personalizada" : "personalizadas"}</span>
                        <button type="button" className={styles.linkButton} onClick={() => { setForm(applyProfileDefaults); setProfileNotice(null); }}>
                          Aplicar permissões padrão
                        </button>
                      </>
                    ) : (
                      <span>Padrão do perfil {profileLabel(form.tipo)}</span>
                    )}
                  </div>
                )}
              </div>

              {profileNotice && profileNotice.tipo === form.tipo && (
                <div className={styles.notice} role="status">
                  {profileNotice.kept > 0 ? (
                    <>
                      <p>
                        Perfil alterado para <strong>{profileLabel(form.tipo)}</strong>. {profileNotice.kept === 1
                          ? "Uma permissão personalizada foi mantida."
                          : `${profileNotice.kept} permissões personalizadas foram mantidas.`}
                      </p>
                      <button type="button" className={styles.noticeAction} onClick={() => { setForm(applyProfileDefaults); setProfileNotice({ tipo: form.tipo, kept: 0 }); }}>
                        Aplicar permissões padrão do perfil {profileLabel(form.tipo)}
                      </button>
                    </>
                  ) : (
                    <p>Permissões atualizadas para o padrão do perfil <strong>{profileLabel(form.tipo)}</strong>. Nada foi salvo ainda.</p>
                  )}
                </div>
              )}

              {form.tipo === "admin" && (
                <p className={styles.adminNote}>Admin tem acesso total à Central. As permissões abaixo não podem ser restringidas.</p>
              )}

              <div className={styles.groups}>
                {groups.map((group) => (
                  <PermissionGroup
                    key={group.id}
                    group={group}
                    form={form}
                    presets={presets}
                    disabled={submitting}
                    onToggle={(key, checked) => {
                      setForm((current) => togglePermission(current, key, checked, presets));
                      setProfileNotice((notice) => (notice?.kept ? notice : null));
                    }}
                  />
                ))}
              </div>
            </section>
          </div>

          <footer className={styles.footer}>
            <p className={styles.saveState} data-dirty={dirty} aria-live="polite">
              {isNew
                ? "O usuário só é criado ao confirmar."
                : dirty
                  ? (isSelf ? "Alterações não salvas. Ao salvar, você precisará entrar novamente." : "Alterações não salvas")
                  : "Nenhuma alteração"}
            </p>
            <div className={styles.footerActions}>
              <button type="button" className={styles.secondaryButton} onClick={requestClose} disabled={submitting}>
                Cancelar
              </button>
              <button type="submit" className={styles.primaryButton} disabled={submitting || (!isNew && !dirty)}>
                {submitting ? (isNew ? "Criando..." : "Salvando...") : (isNew ? "Criar usuário" : "Salvar alterações")}
              </button>
            </div>
          </footer>
        </form>
      </section>

      {confirmDiscard && (
        <ConfirmDialog
          tone="warning"
          icon="edit"
          title="Descartar alterações?"
          message="As alterações realizadas ainda não foram salvas."
          cancelLabel="Continuar editando"
          confirmLabel="Descartar"
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => { setConfirmDiscard(false); onClose(); }}
        />
      )}
    </div>
  );
}

export default UserFormModal;
