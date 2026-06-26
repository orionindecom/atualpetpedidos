import mongoose from "mongoose";

export const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

export const validateObjectIdParam = (paramName = "id") => (req, res, next) => {
  if (!isValidObjectId(req.params[paramName])) {
    return res.status(400).json({
      message: "Identificador inválido",
    });
  }

  return next();
};

export const isNonEmptyString = (value, maxLength = 255) => (
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.trim().length <= maxLength
);

export const isOptionalString = (value, maxLength = 1000) => (
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.length <= maxLength)
);

export const isValidEmail = (email) => (
  typeof email === "string" &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
  email.length <= 254
);

export const isStrongEnoughPassword = (password) => (
  typeof password === "string" && password.length >= 8 && password.length <= 128
);

export const toPositiveNumber = (value) => {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  return numberValue;
};

export const sendServerError = (res, fallbackMessage = "Erro interno do servidor") => (
  res.status(500).json({
    message: fallbackMessage,
  })
);

