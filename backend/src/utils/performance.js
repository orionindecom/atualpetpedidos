import { performance } from "node:perf_hooks";

const performanceEnabled = () => process.env.PERF_LOG_ENABLED === "true";
const roundMs = (value) => Math.round(value * 100) / 100;

export const sanitizePerformancePath = (originalUrl = "") =>
  originalUrl
    .split("?", 1)[0]
    .replace(/\/[a-f\d]{24}(?=\/|$)/gi, "/:id");

const registerStage = (req, name, startedAt) => {
  if (!req.performanceMetrics) {
    return;
  }

  req.performanceMetrics.stages.push({
    name,
    durationMs: roundMs(performance.now() - startedAt),
  });
};

export const measureStage = async (req, name, operation) => {
  if (!req.performanceMetrics) {
    return operation();
  }

  const startedAt = performance.now();

  try {
    return await operation();
  } finally {
    registerStage(req, name, startedAt);
  }
};

export const measureStageSync = (req, name, operation) => {
  if (!req.performanceMetrics) {
    return operation();
  }

  const startedAt = performance.now();

  try {
    return operation();
  } finally {
    registerStage(req, name, startedAt);
  }
};

export const performanceMiddleware = (req, res, next) => {
  if (!performanceEnabled()) {
    return next();
  }

  const startedAt = performance.now();
  req.performanceMetrics = { stages: [] };

  res.on("finish", () => {
    const path = sanitizePerformancePath(req.originalUrl || req.path);

    console.log(
      `[perf] ${JSON.stringify({
        method: req.method,
        path,
        status: res.statusCode,
        totalMs: roundMs(performance.now() - startedAt),
        stages: req.performanceMetrics.stages,
      })}`
    );
  });

  return next();
};
