const stores = new Map();

const getClientKey = (req) => {
  const forwardedFor = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor?.split(",")[0]?.trim();

  return ip || req.ip || req.socket?.remoteAddress || "unknown";
};

export const rateLimit = ({
  windowMs,
  max,
  message = "Muitas requisições. Tente novamente mais tarde.",
  keyPrefix = "global",
}) => {
  if (!stores.has(keyPrefix)) {
    stores.set(keyPrefix, new Map());
  }

  const store = stores.get(keyPrefix);

  return (req, res, next) => {
    const now = Date.now();
    const key = getClientKey(req);
    const current = store.get(key);

    if (!current || current.resetAt <= now) {
      store.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });

      return next();
    }

    current.count += 1;

    if (current.count > max) {
      const retryAfter = Math.ceil((current.resetAt - now) / 1000);

      res.setHeader("Retry-After", String(retryAfter));

      return res.status(429).json({
        message,
      });
    }

    return next();
  };
};

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  keyPrefix: "general",
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: "Muitas tentativas de login. Tente novamente mais tarde.",
  keyPrefix: "login",
});

export const cadastroLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: "Muitos cadastros a partir desta origem. Tente novamente mais tarde.",
  keyPrefix: "cadastro",
});

export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyPrefix: "admin",
});

export const pedidoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: "Muitos pedidos enviados. Tente novamente mais tarde.",
  keyPrefix: "pedido",
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: "Muitos uploads enviados. Tente novamente mais tarde.",
  keyPrefix: "upload",
});

