const EVENT = "atualpet:pedidos-atualizados";
const STORAGE_KEY = "atualpet:pedidos-atualizados";

export function notifyProductionDemandUpdate(config, browser = window) {
  if (!["post", "put", "patch", "delete"].includes(config?.method?.toLowerCase())) return;
  if (!/^\/(?:logistica\/)?pedidos(?:\/|$)/.test(config.url || "")) return;
  browser.dispatchEvent(new Event(EVENT));
  try {
    // Apenas um sinal; nenhum dado do pedido é compartilhado entre abas.
    browser.localStorage.setItem(STORAGE_KEY, `${Date.now()}-${Math.random()}`);
  } catch { /* A atualização periódica continua se o armazenamento estiver indisponível. */ }
}

export function subscribeProductionDemandUpdates(refresh, browser = window) {
  const refreshVisible = () => {
    if (browser.document.visibilityState !== "hidden") refresh();
  };
  const onStorage = (event) => {
    if (event.key === STORAGE_KEY) refreshVisible();
  };
  browser.addEventListener(EVENT, refreshVisible);
  browser.addEventListener("storage", onStorage);
  browser.addEventListener("focus", refreshVisible);
  browser.document.addEventListener("visibilitychange", refreshVisible);
  // Alterações feitas em outros dispositivos também chegam à página aberta.
  const timer = browser.setInterval(refreshVisible, 15000);
  return () => {
    browser.clearInterval(timer);
    browser.removeEventListener(EVENT, refreshVisible);
    browser.removeEventListener("storage", onStorage);
    browser.removeEventListener("focus", refreshVisible);
    browser.document.removeEventListener("visibilitychange", refreshVisible);
  };
}
