const stores = new Map();
const MAX_KEYS_PER_STORE = 100000;

const getClientKey = (req) => req.ip || req.socket?.remoteAddress || "unknown";

const cleanupExpiredEntries = () => {
  const now = Date.now();

  for (const store of stores.values()) {
    for (const [key, entry] of store.entries()) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }
};

const cleanupTimer = setInterval(cleanupExpiredEntries, 60 * 1000);
cleanupTimer.unref();

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

    if (!current && store.size >= MAX_KEYS_PER_STORE) {
      cleanupExpiredEntries();

      if (store.size >= MAX_KEYS_PER_STORE) {
        store.delete(store.keys().next().value);
      }
    }

    if (!current || current.resetAt <= now) {
      const entry = {
        count: 1,
        resetAt: now + windowMs,
      };

      store.set(key, entry);
      res.setHeader("RateLimit-Limit", String(max));
      res.setHeader("RateLimit-Remaining", String(Math.max(max - 1, 0)));
      res.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

      return next();
    }

    current.count += 1;
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader(
      "RateLimit-Remaining",
      String(Math.max(max - current.count, 0))
    );
    res.setHeader("RateLimit-Reset", String(Math.ceil(current.resetAt / 1000)));

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
