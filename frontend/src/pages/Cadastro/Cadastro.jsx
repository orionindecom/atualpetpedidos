import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../../api/axios";
import logo from "../../assets/logo-atualpet-white.png";
import {
  formatRegistrationDocument,
  formatRegistrationPhone,
  getRegistrationApiFieldErrors,
  validateRegistrationForm,
} from "../../utils/registrationValidation";
import styles from "./Cadastro.module.css";

const INITIAL_FORM = Object.freeze({
  nomeResponsavel: "",
  email: "",
  senha: "",
  confirmarSenha: "",
  razaoSocial: "",
  nomeFantasia: "",
  cnpj: "",
  telefone: "",
  whatsapp: "",
});

const maskFieldValue = (name, value) => {
  if (name === "cnpj") return formatRegistrationDocument(value);
  if (["telefone", "whatsapp"].includes(name)) return formatRegistrationPhone(value);
  return value;
};

function Cadastro() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ ...INITIAL_FORM });
  const [errors, setErrors] = useState({});
  const [feedback, setFeedback] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const alterar = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: maskFieldValue(name, value) }));
    setFeedback(null);
    setErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  const focusFirstError = (formElement, fieldErrors) => {
    const firstField = Object.keys(fieldErrors)[0];
    formElement.elements.namedItem(firstField)?.focus();
  };

  const cadastrar = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const validationErrors = validateRegistrationForm(form);

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      setFeedback({
        type: "error",
        message: "Revise os campos destacados antes de enviar a solicitação.",
      });
      focusFirstError(formElement, validationErrors);
      return;
    }

    setSubmitting(true);
    setErrors({});
    setFeedback(null);
    try {
      await api.post("/auth/cadastro", form);
      window.alert("Cadastro enviado com sucesso. Aguarde aprovação.");
      navigate("/login");
    } catch (error) {
      const responseData = error.response?.data;
      const apiErrors = getRegistrationApiFieldErrors(responseData);
      const apiMessage = typeof responseData?.message === "string"
        ? responseData.message
        : "";
      setErrors(apiErrors);
      setFeedback({
        type: "error",
        message: Object.keys(apiErrors).length > 0
          ? "Revise os campos destacados antes de enviar novamente."
          : apiMessage || "Não foi possível enviar o cadastro. Tente novamente.",
      });
      if (Object.keys(apiErrors).length > 0) focusFirstError(formElement, apiErrors);
    } finally {
      setSubmitting(false);
    }
  };

  const fieldAccessibility = (name) => ({
    "aria-invalid": Boolean(errors[name]),
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });

  const fieldError = (name) => errors[name] && (
    <span id={`${name}-error`} className={styles.fieldError}>
      {errors[name]}
    </span>
  );

  return (
    <div className={styles.page}>
      <section className={styles.info}>
        <div className={styles.brand}>
          <div className={styles.logo}><img src={logo} alt="AtualPet" /></div>
          <div>
            <h1>AtualPet</h1>
            <p>Solicitação de acesso</p>
          </div>
        </div>

        <div className={styles.texto}>
          <h2>Cadastre sua empresa para acessar o catálogo comercial.</h2>
          <p>
            Após o envio, a equipe AtualPet irá analisar seu cadastro,
            aprovar o acesso e vincular sua tabela de preços.
          </p>
        </div>

        <div className={styles.passos}>
          <span>1. Envie seus dados</span>
          <span>2. Aguarde aprovação</span>
          <span>3. Acesse sua tabela</span>
        </div>
      </section>

      <section className={styles.formArea}>
        <div className={styles.mobileIntro}>
          <img src={logo} alt="AtualPet" />
          <strong>AtualPet</strong>
          <span>Solicitação de acesso</span>
        </div>

        <form className={styles.card} onSubmit={cadastrar} noValidate>
          <div className={styles.mobileCardHeader}>
            <h1>Solicitar acesso</h1>
            <p>Preencha seus dados para solicitar acesso ao portal comercial.</p>
          </div>

          <h2>Solicitar cadastro</h2>
          <p>Preencha os dados abaixo para solicitar acesso.</p>

          {feedback && (
            <div className={styles.feedback} data-type={feedback.type} role="alert">
              <strong>{feedback.message}</strong>
              {Object.keys(errors).length > 1 && (
                <ul>
                  {Object.entries(errors).map(([field, message]) => (
                    <li key={field}>{message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className={styles.grid}>
            <fieldset className={styles.section}>
              <legend>Dados da empresa</legend>

              <label>
                Razão social
                <input
                  name="razaoSocial"
                  placeholder="Razão social"
                  value={form.razaoSocial}
                  onChange={alterar}
                  maxLength={160}
                  autoComplete="organization"
                  {...fieldAccessibility("razaoSocial")}
                />
                {fieldError("razaoSocial")}
              </label>

              <label>
                Nome fantasia
                <input
                  name="nomeFantasia"
                  placeholder="Nome fantasia"
                  value={form.nomeFantasia}
                  onChange={alterar}
                  maxLength={160}
                  autoComplete="organization-title"
                  {...fieldAccessibility("nomeFantasia")}
                />
                {fieldError("nomeFantasia")}
              </label>

              <label>
                CPF ou CNPJ
                <input
                  name="cnpj"
                  placeholder="000.000.000-00 ou 00.000.000/0000-00"
                  value={form.cnpj}
                  onChange={alterar}
                  inputMode="numeric"
                  maxLength={18}
                  autoComplete="off"
                  {...fieldAccessibility("cnpj")}
                />
                {fieldError("cnpj")}
              </label>
            </fieldset>

            <fieldset className={styles.section}>
              <legend>Contato</legend>

              <label>
                Nome do responsável
                <input
                  name="nomeResponsavel"
                  placeholder="Nome do responsável"
                  value={form.nomeResponsavel}
                  onChange={alterar}
                  maxLength={120}
                  autoComplete="name"
                  required
                  {...fieldAccessibility("nomeResponsavel")}
                />
                {fieldError("nomeResponsavel")}
              </label>

              <label>
                E-mail
                <input
                  name="email"
                  type="email"
                  placeholder="nome@empresa.com.br"
                  value={form.email}
                  onChange={alterar}
                  maxLength={254}
                  autoComplete="email"
                  required
                  {...fieldAccessibility("email")}
                />
                {fieldError("email")}
              </label>

              <label>
                Telefone
                <input
                  name="telefone"
                  placeholder="(00) 0000-0000"
                  value={form.telefone}
                  onChange={alterar}
                  inputMode="tel"
                  maxLength={15}
                  autoComplete="tel"
                  {...fieldAccessibility("telefone")}
                />
                {fieldError("telefone")}
              </label>

              <label>
                WhatsApp
                <input
                  name="whatsapp"
                  placeholder="(00) 00000-0000"
                  value={form.whatsapp}
                  onChange={alterar}
                  inputMode="tel"
                  maxLength={15}
                  autoComplete="tel"
                  {...fieldAccessibility("whatsapp")}
                />
                {fieldError("whatsapp")}
              </label>
            </fieldset>

            <fieldset className={styles.section}>
              <legend>Acesso</legend>

              <label>
                Senha
                <input
                  name="senha"
                  type="password"
                  placeholder="Mínimo de 8 caracteres"
                  value={form.senha}
                  onChange={alterar}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                  {...fieldAccessibility("senha")}
                />
                {fieldError("senha")}
              </label>

              <label>
                Confirmar senha
                <input
                  name="confirmarSenha"
                  type="password"
                  placeholder="Digite a senha novamente"
                  value={form.confirmarSenha}
                  onChange={alterar}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                  {...fieldAccessibility("confirmarSenha")}
                />
                {fieldError("confirmarSenha")}
              </label>
            </fieldset>
          </div>

          <button type="submit" disabled={submitting}>
            {submitting ? "Enviando solicitação..." : "Enviar solicitação"}
          </button>

          <div className={styles.footer}>
            <span>Já possui acesso?</span>
            <Link to="/login">Entrar no portal</Link>
          </div>
        </form>
      </section>
    </div>
  );
}

export default Cadastro;
