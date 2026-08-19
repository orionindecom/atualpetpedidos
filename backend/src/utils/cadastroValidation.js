import {
  isNonEmptyString,
  isStrongEnoughPassword,
  isValidEmail,
} from "./validation.js";

export const normalizeDigits = (value) => String(value ?? "").replace(/\D/g, "");

const hasRepeatedDigits = (value) => /^(\d)\1+$/.test(value);

export const getCadastroDocumentType = (value) => {
  const digits = normalizeDigits(value);
  if (digits.length === 11) return "cpf";
  if (digits.length === 14) return "cnpj";
  return null;
};

export const isValidCpf = (value) => {
  const digits = normalizeDigits(value);
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

export const isValidCnpj = (value) => {
  const digits = normalizeDigits(value);
  if (digits.length !== 14 || hasRepeatedDigits(digits)) return false;

  const firstDigit = calculateCnpjDigit(
    digits,
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  );
  const secondDigit = calculateCnpjDigit(
    digits,
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  );

  return Number(digits[12]) === firstDigit && Number(digits[13]) === secondDigit;
};

export const isValidBrazilianPhone = (value) => {
  const digits = normalizeDigits(value);
  if (![10, 11].includes(digits.length) || hasRepeatedDigits(digits)) return false;
  const areaCode = Number(digits.slice(0, 2));
  if (areaCode < 11 || areaCode > 99) return false;
  return digits.length === 10 || digits[2] === "9";
};

export const validateCadastroDocument = (value) => {
  const digits = normalizeDigits(value);
  const hasValue = value !== undefined && value !== null && String(value).trim() !== "";

  if (!hasValue) return { valid: true, digits: "", type: null, error: null };
  if (digits.length === 11) {
    return isValidCpf(digits)
      ? { valid: true, digits, type: "cpf", error: null }
      : { valid: false, digits, type: "cpf", error: "O CPF informado é inválido." };
  }
  if (digits.length === 14) {
    return isValidCnpj(digits)
      ? { valid: true, digits, type: "cnpj", error: null }
      : { valid: false, digits, type: "cnpj", error: "O CNPJ informado é inválido." };
  }
  if (digits.length > 14) {
    return {
      valid: false,
      digits,
      type: null,
      error: "Informe um CPF ou CNPJ com no máximo 14 dígitos.",
    };
  }
  if (digits.length < 11 || digits.length === 12 || digits.length === 13) {
    return {
      valid: false,
      digits,
      type: null,
      error: digits.length > 0
        ? "O CPF ou CNPJ informado está incompleto."
        : "Informe um CPF ou CNPJ válido.",
    };
  }

  return { valid: false, digits, type: null, error: "Informe um CPF ou CNPJ válido." };
};

const validateOptionalText = (source, field, maxLength, message, errors, data) => {
  const value = source[field];
  if (value === undefined || value === null || value === "") {
    data[field] = "";
    return;
  }
  if (typeof value !== "string" || value.trim().length > maxLength) {
    errors[field] = message;
    return;
  }
  data[field] = value.trim();
};

export const validateCadastroPayload = (source) => {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {
      valid: false,
      errors: { campos: "Informe os dados para solicitar o cadastro." },
      data: {},
    };
  }

  const errors = {};
  const data = {};

  if (!isNonEmptyString(source.nomeResponsavel, 120)) {
    errors.nomeResponsavel = "Informe o nome do responsável em até 120 caracteres.";
  } else {
    data.nomeResponsavel = source.nomeResponsavel.trim();
  }

  if (!isValidEmail(source.email)) {
    errors.email = "Informe um e-mail válido.";
  } else {
    data.email = source.email.trim().toLowerCase();
  }

  if (!isStrongEnoughPassword(source.senha)) {
    errors.senha = typeof source.senha === "string" && source.senha.length > 128
      ? "A senha deve ter no máximo 128 caracteres."
      : "A senha deve ter pelo menos 8 caracteres.";
  } else {
    data.senha = source.senha;
  }

  if (
    Object.hasOwn(source, "confirmarSenha") &&
    (typeof source.confirmarSenha !== "string" || source.confirmarSenha !== source.senha)
  ) {
    errors.confirmarSenha = "As senhas não coincidem.";
  }

  validateOptionalText(
    source,
    "razaoSocial",
    160,
    "A razão social deve ter no máximo 160 caracteres.",
    errors,
    data
  );
  validateOptionalText(
    source,
    "nomeFantasia",
    160,
    "O nome fantasia deve ter no máximo 160 caracteres.",
    errors,
    data
  );

  const document = validateCadastroDocument(source.cnpj);
  if (!document.valid) {
    errors.cnpj = document.error;
  } else {
    data.cnpj = document.digits;
  }

  for (const [field, label] of [
    ["telefone", "telefone"],
    ["whatsapp", "WhatsApp"],
  ]) {
    const digits = normalizeDigits(source[field]);
    if (source[field] && !isValidBrazilianPhone(source[field])) {
      errors[field] = `Informe um ${label} válido com DDD.`;
    } else {
      data[field] = digits;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    data,
  };
};

export const validateCadastroGroomerPayload = (source) => {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {
      valid: false,
      errors: { campos: "Informe os dados para solicitar o cadastro." },
      data: {},
    };
  }

  const base = validateCadastroPayload({
    nomeResponsavel: source.nomeResponsavel,
    email: source.email,
    senha: source.senha,
    confirmarSenha: source.confirmarSenha,
    cnpj: source.cnpj,
    whatsapp: source.whatsapp,
  });
  const errors = { ...base.errors };
  const data = { ...base.data };
  delete data.razaoSocial;
  delete data.nomeFantasia;
  delete data.telefone;

  if (!source.whatsapp || !isValidBrazilianPhone(source.whatsapp)) {
    errors.whatsapp = "Informe um WhatsApp válido com DDD.";
  }

  if (!isNonEmptyString(source.cidade, 120)) {
    errors.cidade = "Informe a cidade em até 120 caracteres.";
  } else {
    data.cidade = source.cidade.trim();
  }

  if (typeof source.estado !== "string" || !/^[A-Za-z]{2}$/.test(source.estado.trim())) {
    errors.estado = "Informe uma UF válida com 2 letras.";
  } else {
    data.estado = source.estado.trim().toUpperCase();
  }

  for (const [field, maxLength, message] of [
    ["nomeProfissional", 160, "O nome profissional ou do pet shop deve ter no máximo 160 caracteres."],
    ["instagram", 160, "O Instagram deve ter no máximo 160 caracteres."],
    ["tiktok", 160, "O TikTok deve ter no máximo 160 caracteres."],
    ["observacaoCadastro", 1000, "A observação deve ter no máximo 1000 caracteres."],
  ]) {
    validateOptionalText(source, field, maxLength, message, errors, data);
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    data,
  };
};

export const formatCnpj = (value) => {
  const digits = normalizeDigits(value).slice(0, 14);
  if (digits.length !== 14) return digits;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
};

export const formatCpf = (value) => {
  const digits = normalizeDigits(value).slice(0, 11);
  if (digits.length !== 11) return digits;
  return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
};

export const formatCadastroDocument = (value) => {
  const digits = normalizeDigits(value);
  if (digits.length === 11) return formatCpf(digits);
  if (digits.length === 14) return formatCnpj(digits);
  return digits;
};

export const buildDocumentDuplicateCandidates = (value) => {
  const digits = normalizeDigits(value);
  if (!digits) return [];
  return [...new Set([digits, formatCadastroDocument(digits)])];
};
