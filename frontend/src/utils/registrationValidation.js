const FIELD_NAMES = new Set([
  "nomeResponsavel",
  "email",
  "senha",
  "confirmarSenha",
  "razaoSocial",
  "nomeFantasia",
  "cnpj",
  "telefone",
  "whatsapp",
  "cidade",
  "estado",
  "nomeProfissional",
  "instagram",
  "tiktok",
  "observacaoCadastro",
]);

export const REGISTRATION_STEP_FIELDS = Object.freeze([
  Object.freeze(["razaoSocial", "nomeFantasia", "cnpj"]),
  Object.freeze(["nomeResponsavel", "email", "telefone", "whatsapp"]),
  Object.freeze(["senha", "confirmarSenha"]),
]);

export const normalizeRegistrationDigits = (value) => (
  String(value ?? "").replace(/\D/g, "")
);

const hasRepeatedDigits = (value) => /^(\d)\1+$/.test(value);

export const getRegistrationDocumentType = (value) => {
  const digits = normalizeRegistrationDigits(value);
  if (digits.length === 11) return "cpf";
  if (digits.length === 14) return "cnpj";
  return null;
};

export const isValidRegistrationCpf = (value) => {
  const digits = normalizeRegistrationDigits(value);
  if (digits.length !== 11 || hasRepeatedDigits(digits)) return false;

  const calculateDigit = (length) => {
    const sum = digits
      .slice(0, length)
      .split("")
      .reduce((total, digit, index) => total + Number(digit) * (length + 1 - index), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return Number(digits[9]) === calculateDigit(9) &&
    Number(digits[10]) === calculateDigit(10);
};

const calculateCnpjDigit = (digits, weights) => {
  const sum = weights.reduce((total, weight, index) => (
    total + Number(digits[index]) * weight
  ), 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
};

export const isValidRegistrationCnpj = (value) => {
  const digits = normalizeRegistrationDigits(value);
  if (digits.length !== 14 || hasRepeatedDigits(digits)) return false;
  const first = calculateCnpjDigit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calculateCnpjDigit(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return Number(digits[12]) === first && Number(digits[13]) === second;
};

export const isValidRegistrationPhone = (value) => {
  const digits = normalizeRegistrationDigits(value);
  if (![10, 11].includes(digits.length) || hasRepeatedDigits(digits)) return false;
  const areaCode = Number(digits.slice(0, 2));
  if (areaCode < 11 || areaCode > 99) return false;
  return digits.length === 10 || digits[2] === "9";
};

export const validateRegistrationDocument = (value) => {
  const digits = normalizeRegistrationDigits(value);
  const hasValue = value !== undefined && value !== null && String(value).trim() !== "";

  if (!hasValue) return null;
  if (digits.length === 11) {
    return isValidRegistrationCpf(digits) ? null : "O CPF informado é inválido.";
  }
  if (digits.length === 14) {
    return isValidRegistrationCnpj(digits) ? null : "O CNPJ informado é inválido.";
  }
  if (digits.length > 14) {
    return "Informe um CPF ou CNPJ com no máximo 14 dígitos.";
  }
  if (digits.length < 11 || digits.length === 12 || digits.length === 13) {
    return digits.length > 0
      ? "O CPF ou CNPJ informado está incompleto."
      : "Informe um CPF ou CNPJ válido.";
  }
  return "Informe um CPF ou CNPJ válido.";
};

export const formatRegistrationCnpj = (value) => {
  const digits = normalizeRegistrationDigits(value).slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
};

export const formatRegistrationCpf = (value) => {
  const digits = normalizeRegistrationDigits(value).slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
};

export const formatRegistrationDocument = (value) => {
  const digits = normalizeRegistrationDigits(value).slice(0, 14);
  return digits.length <= 11
    ? formatRegistrationCpf(digits)
    : formatRegistrationCnpj(digits);
};

export const formatRegistrationPhone = (value) => {
  const digits = normalizeRegistrationDigits(value).slice(0, 11);
  if (digits.length <= 10) {
    return digits
      .replace(/^(\d{2})(\d)/, "($1) $2")
      .replace(/(\d{4})(\d)/, "$1-$2");
  }
  return digits
    .replace(/^(\d{2})(\d)/, "($1) $2")
    .replace(/(\d{5})(\d)/, "$1-$2");
};

export const validateRegistrationForm = (form = {}) => {
  const errors = {};
  const name = String(form.nomeResponsavel ?? "").trim();
  const email = String(form.email ?? "").trim();
  const password = typeof form.senha === "string" ? form.senha : "";
  const confirmation = typeof form.confirmarSenha === "string" ? form.confirmarSenha : "";

  if (!name || name.length > 120) {
    errors.nomeResponsavel = "Informe o nome do responsável em até 120 caracteres.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    errors.email = "Informe um e-mail válido.";
  }
  if (password.length < 8) {
    errors.senha = "A senha deve ter pelo menos 8 caracteres.";
  } else if (password.length > 128) {
    errors.senha = "A senha deve ter no máximo 128 caracteres.";
  }
  if (!confirmation) {
    errors.confirmarSenha = "Confirme sua senha.";
  } else if (confirmation !== password) {
    errors.confirmarSenha = "As senhas não coincidem.";
  }

  for (const [field, label] of [
    ["razaoSocial", "A razão social"],
    ["nomeFantasia", "O nome fantasia"],
  ]) {
    const value = form[field];
    if (
      value !== undefined &&
      value !== null &&
      (typeof value !== "string" || value.trim().length > 160)
    ) {
      errors[field] = `${label} deve ter no máximo 160 caracteres.`;
    }
  }

  const documentError = validateRegistrationDocument(form.cnpj);
  if (documentError) errors.cnpj = documentError;
  if (form.telefone && !isValidRegistrationPhone(form.telefone)) {
    errors.telefone = "Informe um telefone válido com DDD.";
  }
  if (form.whatsapp && !isValidRegistrationPhone(form.whatsapp)) {
    errors.whatsapp = "Informe um WhatsApp válido com DDD.";
  }

  return errors;
};

export const validateRegistrationStep = (form = {}, stepIndex = 0) => {
  const stepFields = new Set(REGISTRATION_STEP_FIELDS[stepIndex] || []);
  return Object.fromEntries(
    Object.entries(validateRegistrationForm(form)).filter(([field]) => stepFields.has(field))
  );
};

export const getRegistrationStepForErrors = (errors = {}) => (
  REGISTRATION_STEP_FIELDS.findIndex((stepFields) => (
    stepFields.some((field) => Boolean(errors[field]))
  ))
);

export const validateGroomerRegistrationForm = (form = {}) => {
  const errors = validateRegistrationForm({
    nomeResponsavel: form.nomeResponsavel,
    email: form.email,
    senha: form.senha,
    confirmarSenha: form.confirmarSenha,
    cnpj: form.cnpj,
    whatsapp: form.whatsapp,
  });

  if (!form.whatsapp || !isValidRegistrationPhone(form.whatsapp)) {
    errors.whatsapp = "Informe um WhatsApp válido com DDD.";
  }

  const city = String(form.cidade ?? "").trim();
  if (!city || city.length > 120) {
    errors.cidade = "Informe a cidade em até 120 caracteres.";
  }

  if (!/^[A-Za-z]{2}$/.test(String(form.estado ?? "").trim())) {
    errors.estado = "Selecione uma UF válida.";
  }

  for (const [field, maxLength, label] of [
    ["nomeProfissional", 160, "O nome profissional ou do pet shop"],
    ["instagram", 160, "O Instagram"],
    ["tiktok", 160, "O TikTok"],
    ["observacaoCadastro", 1000, "A observação"],
  ]) {
    const value = form[field];
    if (value !== undefined && value !== null && (
      typeof value !== "string" || value.trim().length > maxLength
    )) {
      errors[field] = `${label} deve ter no máximo ${maxLength} caracteres.`;
    }
  }

  return errors;
};

export const getRegistrationApiFieldErrors = (payload) => {
  if (!payload?.errors || typeof payload.errors !== "object" || Array.isArray(payload.errors)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(payload.errors).filter(([field, message]) => (
      FIELD_NAMES.has(field) && typeof message === "string" && message.trim()
    ))
  );
};
