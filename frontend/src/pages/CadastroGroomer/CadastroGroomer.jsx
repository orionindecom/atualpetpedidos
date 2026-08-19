import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../../api/axios";
import logo from "../../assets/logo-atualpet-white.png";
import {
  formatRegistrationDocument,
  formatRegistrationPhone,
  getRegistrationApiFieldErrors,
  validateGroomerRegistrationForm,
} from "../../utils/registrationValidation";
import styles from "../Cadastro/Cadastro.module.css";

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT",
  "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO",
  "RR", "SC", "SP", "SE", "TO",
];

const INITIAL_FORM = Object.freeze({
  nomeResponsavel: "",
  email: "",
  whatsapp: "",
  cnpj: "",
  cidade: "",
  estado: "",
  nomeProfissional: "",
  instagram: "",
  tiktok: "",
  observacaoCadastro: "",
  senha: "",
  confirmarSenha: "",
});

const maskValue = (name, value) => {
  if (name === "cnpj") return formatRegistrationDocument(value);
  if (name === "whatsapp") return formatRegistrationPhone(value);
  return value;
};

function CadastroGroomer() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ ...INITIAL_FORM });
  const [errors, setErrors] = useState({});
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: maskValue(name, value) }));
    setFeedback("");
    setErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  const fieldProps = (name) => ({
    "aria-invalid": Boolean(errors[name]),
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });

  const fieldError = (name) => errors[name] && (
    <span id={`${name}-error`} className={styles.fieldError}>{errors[name]}</span>
  );

  const submit = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const validationErrors = validateGroomerRegistrationForm(form);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      setFeedback("Revise os campos destacados antes de enviar a solicitação.");
      formElement.elements.namedItem(Object.keys(validationErrors)[0])?.focus();
      return;
    }

    setSubmitting(true);
    setErrors({});
    setFeedback("");
    try {
      await api.post("/auth/cadastro-groomer", form);
      window.alert("Cadastro de Groomer enviado com sucesso. Aguarde aprovação.");
      navigate("/login");
    } catch (error) {
      const apiErrors = getRegistrationApiFieldErrors(error.response?.data);
      setErrors(apiErrors);
      setFeedback(
        Object.keys(apiErrors).length > 0
          ? "Revise os campos destacados antes de enviar novamente."
          : error.response?.data?.message || "Não foi possível enviar o cadastro. Tente novamente."
      );
      formElement.elements.namedItem(Object.keys(apiErrors)[0])?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.info}>
        <div className={styles.brand}>
          <div className={styles.logo}><img src={logo} alt="AtualPet" /></div>
          <div><h1>AtualPet</h1><p>Portal Groomer</p></div>
        </div>
        <div className={styles.texto}>
          <h2>Conteúdo profissional para quem transforma o cuidado pet.</h2>
          <p>Solicite seu acesso a treinamentos e materiais selecionados pela AtualPet.</p>
        </div>
        <div className={styles.passos}>
          <span>1. Envie seus dados profissionais</span>
          <span>2. Aguarde a análise da AtualPet</span>
          <span>3. Acesse conteúdos para Groomers</span>
        </div>
      </section>

      <section className={styles.formArea}>
        <div className={styles.mobileIntro}>
          <img src={logo} alt="AtualPet" />
          <strong>AtualPet</strong>
          <span>Portal Groomer</span>
        </div>

        <form className={styles.card} onSubmit={submit} noValidate>
          <div className={styles.mobileCardHeader}>
            <h1>Cadastro de Groomer</h1>
            <p>Preencha seus dados para solicitar acesso aos conteúdos profissionais.</p>
          </div>
          <h2>Solicitar acesso Groomer</h2>
          <p>O acesso será liberado somente após aprovação administrativa.</p>

          {feedback && <div className={styles.feedback} role="alert"><strong>{feedback}</strong></div>}

          <div className={styles.grid}>
            <fieldset className={styles.section}>
              <legend>Dados profissionais</legend>
              <label>Nome completo *
                <input name="nomeResponsavel" value={form.nomeResponsavel} onChange={updateField} maxLength={120} autoComplete="name" required {...fieldProps("nomeResponsavel")} />
                {fieldError("nomeResponsavel")}
              </label>
              <label>Nome profissional ou do pet shop
                <input name="nomeProfissional" value={form.nomeProfissional} onChange={updateField} maxLength={160} autoComplete="organization" {...fieldProps("nomeProfissional")} />
                {fieldError("nomeProfissional")}
              </label>
              <label>CPF ou CNPJ
                <input name="cnpj" value={form.cnpj} onChange={updateField} inputMode="numeric" maxLength={18} placeholder="Opcional" {...fieldProps("cnpj")} />
                {fieldError("cnpj")}
              </label>
              <label>Cidade *
                <input name="cidade" value={form.cidade} onChange={updateField} maxLength={120} autoComplete="address-level2" required {...fieldProps("cidade")} />
                {fieldError("cidade")}
              </label>
              <label>Estado *
                <select name="estado" value={form.estado} onChange={updateField} autoComplete="address-level1" required {...fieldProps("estado")}>
                  <option value="">Selecione a UF</option>
                  {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                </select>
                {fieldError("estado")}
              </label>
            </fieldset>

            <fieldset className={styles.section}>
              <legend>Contato e redes</legend>
              <label>E-mail *
                <input name="email" type="email" value={form.email} onChange={updateField} maxLength={254} autoComplete="email" required {...fieldProps("email")} />
                {fieldError("email")}
              </label>
              <label>WhatsApp *
                <input name="whatsapp" value={form.whatsapp} onChange={updateField} inputMode="tel" maxLength={15} autoComplete="tel" required {...fieldProps("whatsapp")} />
                {fieldError("whatsapp")}
              </label>
              <label>Instagram
                <input name="instagram" value={form.instagram} onChange={updateField} maxLength={160} placeholder="@seuperfil" {...fieldProps("instagram")} />
                {fieldError("instagram")}
              </label>
              <label>TikTok
                <input name="tiktok" value={form.tiktok} onChange={updateField} maxLength={160} placeholder="@seuperfil" {...fieldProps("tiktok")} />
                {fieldError("tiktok")}
              </label>
              <label>Observação
                <textarea name="observacaoCadastro" value={form.observacaoCadastro} onChange={updateField} maxLength={1000} rows={4} {...fieldProps("observacaoCadastro")} />
                {fieldError("observacaoCadastro")}
              </label>
            </fieldset>

            <fieldset className={styles.section}>
              <legend>Acesso</legend>
              <label>Senha *
                <input name="senha" type="password" value={form.senha} onChange={updateField} minLength={8} maxLength={128} autoComplete="new-password" required {...fieldProps("senha")} />
                {fieldError("senha")}
              </label>
              <label>Confirmar senha *
                <input name="confirmarSenha" type="password" value={form.confirmarSenha} onChange={updateField} maxLength={128} autoComplete="new-password" required {...fieldProps("confirmarSenha")} />
                {fieldError("confirmarSenha")}
              </label>
            </fieldset>
          </div>

          <button type="submit" disabled={submitting}>
            {submitting ? "Enviando solicitação..." : "Enviar solicitação"}
          </button>
          <div className={styles.footer}><span>Já possui acesso?</span><Link to="/login">Entrar no portal</Link></div>
        </form>
      </section>
    </div>
  );
}

export default CadastroGroomer;
