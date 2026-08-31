import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../../api/axios";
import logo from "../../assets/logo-atualpet-white.png";
import AuthMascots from "../../components/AuthMascots/AuthMascots";
import mascotStyles from "../../components/AuthMascots/AuthMascots.module.css";
import AuthInstitutionalArt from "../../components/AuthInstitutionalArt/AuthInstitutionalArt";
import {
  formatRegistrationDocument,
  formatRegistrationPhone,
  getRegistrationStepForErrors,
  getRegistrationApiFieldErrors,
  REGISTRATION_STEP_FIELDS,
  validateRegistrationForm,
  validateRegistrationStep,
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

const REGISTRATION_STEPS = Object.freeze([
  Object.freeze({ title: "Empresa", description: "Conte sobre a sua empresa." }),
  Object.freeze({ title: "Contato", description: "Informe quem será o contato da empresa." }),
  Object.freeze({ title: "Acesso", description: "Crie os dados de acesso à Central." }),
]);

const maskFieldValue = (name, value) => {
  if (name === "cnpj") return formatRegistrationDocument(value);
  if (["telefone", "whatsapp"].includes(name)) return formatRegistrationPhone(value);
  return value;
};

function Cadastro() {
  const navigate = useNavigate();
  const formRef = useRef(null);
  const progressRef = useRef(null);
  const [form, setForm] = useState({ ...INITIAL_FORM });
  const [errors, setErrors] = useState({});
  const [feedback, setFeedback] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

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
    window.requestAnimationFrame(() => {
      formElement.elements.namedItem(firstField)?.focus();
    });
  };

  const scrollToStepStart = () => {
    window.requestAnimationFrame(() => {
      progressRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const replaceStepErrors = (stepIndex, stepErrors) => {
    setErrors((current) => {
      const next = { ...current };
      REGISTRATION_STEP_FIELDS[stepIndex].forEach((field) => delete next[field]);
      return { ...next, ...stepErrors };
    });
  };

  const continuar = () => {
    const stepErrors = validateRegistrationStep(form, currentStep);
    replaceStepErrors(currentStep, stepErrors);

    if (Object.keys(stepErrors).length > 0) {
      setFeedback({
        type: "error",
        message: "Revise os campos destacados antes de continuar.",
      });
      focusFirstError(formRef.current, stepErrors);
      return;
    }

    setFeedback(null);
    setCurrentStep((step) => Math.min(step + 1, REGISTRATION_STEPS.length - 1));
    scrollToStepStart();
  };

  const voltar = () => {
    setFeedback(null);
    setCurrentStep((step) => Math.max(step - 1, 0));
    scrollToStepStart();
  };

  const cadastrar = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const validationErrors = validateRegistrationForm(form);

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      const errorStep = getRegistrationStepForErrors(validationErrors);
      if (errorStep >= 0) setCurrentStep(errorStep);
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
      const errorStep = getRegistrationStepForErrors(apiErrors);
      if (errorStep >= 0) setCurrentStep(errorStep);
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
      <AuthInstitutionalArt />

      <section className={styles.formArea}>
        <div className={styles.mobileIntro}>
          <img src={logo} alt="AtualPet" />
          <strong>AtualPet</strong>
          <span>Solicitação de acesso</span>
        </div>

        <div className={`${mascotStyles.visual} ${styles.formVisual}`}>
          <AuthMascots />

          <form ref={formRef} className={styles.card} onSubmit={cadastrar} noValidate>
            <div className={styles.mobileCardHeader}>
              <h1>Solicitar acesso</h1>
              <p>Preencha seus dados para solicitar acesso à Central Comercial.</p>
            </div>

            <div ref={progressRef} className={styles.progress} aria-live="polite">
              <div className={styles.progressHeading}>
                <span>Etapa {currentStep + 1} de {REGISTRATION_STEPS.length}</span>
                <strong>{REGISTRATION_STEPS[currentStep].title}</strong>
              </div>
              <p>{REGISTRATION_STEPS[currentStep].description}</p>
              <div
                className={styles.progressTrack}
                role="progressbar"
                aria-label="Progresso do cadastro"
                aria-valuemin="1"
                aria-valuemax={REGISTRATION_STEPS.length}
                aria-valuenow={currentStep + 1}
                aria-valuetext={`Etapa ${currentStep + 1} de ${REGISTRATION_STEPS.length}: ${REGISTRATION_STEPS[currentStep].title}`}
              >
                <span
                  className={styles.progressFill}
                  style={{ width: `${((currentStep + 1) / REGISTRATION_STEPS.length) * 100}%` }}
                />
              </div>
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
            <fieldset
              className={styles.section}
              data-active={currentStep === 0}
            >
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

            <fieldset
              className={styles.section}
              data-active={currentStep === 1}
            >
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

            <fieldset
              className={styles.section}
              data-active={currentStep === 2}
            >
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

            <button className={styles.desktopSubmit} type="submit" disabled={submitting}>
              {submitting ? "Enviando solicitação..." : "Enviar solicitação"}
            </button>

            <div className={styles.mobileActions} data-has-back={currentStep > 0}>
              {currentStep > 0 && (
                <button className={styles.backButton} type="button" onClick={voltar}>
                  Voltar
                </button>
              )}
              {currentStep < REGISTRATION_STEPS.length - 1 ? (
                <button type="button" onClick={continuar}>
                  Continuar
                </button>
              ) : (
                <button type="submit" disabled={submitting}>
                  {submitting ? "Enviando solicitação..." : "Enviar solicitação"}
                </button>
              )}
            </div>

            <div className={styles.footer}>
              <span>Já possui acesso?</span>
              <Link to="/login">Entrar na Central</Link>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

export default Cadastro;
