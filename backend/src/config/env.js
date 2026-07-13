const localDevelopmentOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const getConfiguredOrigins = () => [
  process.env.CORS_ORIGIN,
  process.env.FRONTEND_URL,
  process.env.CLIENT_URL,
];

const parseOriginsList = (origins) => (
  origins
    .filter(Boolean)
    .flatMap((origin) => origin.split(","))
    .map((origin) => origin.trim())
    .filter(Boolean)
);

const requiredCloudinaryVars = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

const numericEnvRules = [
  ["MONGO_MAX_POOL_SIZE", 1, 500],
  ["MONGO_MIN_POOL_SIZE", 0, 500],
  ["MONGO_MAX_IDLE_TIME_MS", 1000, 600000],
  ["MONGO_SERVER_SELECTION_TIMEOUT_MS", 1000, 120000],
  ["MONGO_CONNECT_TIMEOUT_MS", 1000, 120000],
  ["MONGO_SOCKET_TIMEOUT_MS", 1000, 600000],
];

export const parseAllowedOrigins = () => {
  const configuredOrigins = parseOriginsList(getConfiguredOrigins());

  if (process.env.NODE_ENV === "production") {
    return configuredOrigins;
  }

  return Array.from(
    new Set([...localDevelopmentOrigins, ...configuredOrigins])
  );
};

export const validateEnv = () => {
  const missing = [];

  if (
    process.env.MONGO_AUTO_INDEX !== undefined &&
    !["true", "false"].includes(process.env.MONGO_AUTO_INDEX)
  ) {
    missing.push("MONGO_AUTO_INDEX como true ou false");
  }

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

  for (const [envName, minimum, maximum] of numericEnvRules) {
    if (process.env[envName] === undefined) {
      continue;
    }

    const value = Number(process.env[envName]);

    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      missing.push(`${envName} entre ${minimum} e ${maximum}`);
    }
  }

  const minPoolSize = Number(process.env.MONGO_MIN_POOL_SIZE || 0);
  const maxPoolSize = Number(process.env.MONGO_MAX_POOL_SIZE || 10);

  if (minPoolSize > maxPoolSize) {
    missing.push("MONGO_MIN_POOL_SIZE menor ou igual a MONGO_MAX_POOL_SIZE");
  }

  if (
    process.env.NODE_ENV === "production" &&
    parseAllowedOrigins().length === 0
  ) {
    missing.push("CORS_ORIGIN ou FRONTEND_URL");
  }

  if (missing.length > 0) {
    throw new Error(
      `Configuração obrigatória ausente ou inválida: ${missing.join(", ")}`
    );
  }
};
