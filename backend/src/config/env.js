const getConfiguredOrigins = () => (
  process.env.CORS_ORIGIN || process.env.FRONTEND_URL || ""
);

const requiredCloudinaryVars = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

export const parseAllowedOrigins = () => {
  const configuredOrigins = getConfiguredOrigins();

  if (configuredOrigins) {
    return configuredOrigins
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  if (process.env.NODE_ENV === "production") {
    return [];
  }

  return ["http://localhost:5173", "http://127.0.0.1:5173"];
};

export const validateEnv = () => {
  const missing = [];

  if (!process.env.MONGO_URI) {
    missing.push("MONGO_URI");
  }

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    missing.push("JWT_SECRET com pelo menos 32 caracteres");
  }

  for (const envName of requiredCloudinaryVars) {
    if (!process.env[envName]) {
      missing.push(envName);
    }
  }

  if (
    process.env.NODE_ENV === "production" &&
    parseAllowedOrigins().length === 0
  ) {
    missing.push("CORS_ORIGIN");
  }

  if (missing.length > 0) {
    console.error(
      `Configuração obrigatória ausente ou inválida: ${missing.join(", ")}`
    );
    process.exit(1);
  }
};
