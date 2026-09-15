import test from "node:test";
import assert from "node:assert/strict";
import { notifyProductionDemandUpdate, subscribeProductionDemandUpdates } from "../src/utils/productionDemandUpdates.js";

function browserFixture() {
  const browser = new EventTarget();
  browser.document = new EventTarget();
  browser.document.visibilityState = "visible";
  browser.localStorage = { setItem(key, value) { browser.lastWrite = { key, value }; } };
  browser.setInterval = (callback, delay) => { browser.tick = callback; assert.equal(delay, 15000); return 1; };
  browser.clearInterval = (id) => { assert.equal(id, 1); browser.tick = null; };
  return browser;
}

test("alteração de pedido dispara recarga imediata e sinaliza outras abas; leituras não disparam", () => {
  const browser = browserFixture();
  let refreshes = 0;
  const unsubscribe = subscribeProductionDemandUpdates(() => refreshes++, browser);
  notifyProductionDemandUpdate({ method: "patch", url: "/logistica/pedidos/123" }, browser);
  assert.equal(refreshes, 1);
  assert.ok(browser.lastWrite.value);
  const storage = new Event("storage");
  storage.key = browser.lastWrite.key;
  browser.dispatchEvent(storage);
  assert.equal(refreshes, 2);
  notifyProductionDemandUpdate({ method: "get", url: "/logistica/necessidade-producao" }, browser);
  notifyProductionDemandUpdate({ method: "post", url: "/login" }, browser);
  assert.equal(refreshes, 2);
  unsubscribe();
  notifyProductionDemandUpdate({ method: "put", url: "/pedidos/123" }, browser);
  browser.dispatchEvent(storage);
  browser.dispatchEvent(new Event("focus"));
  assert.equal(refreshes, 2);
  assert.equal(browser.tick, null);
});

test("consulta periódica, foco e retorno à aba atualizam; aba oculta pausa consultas", () => {
  const browser = browserFixture();
  let refreshes = 0;
  const unsubscribe = subscribeProductionDemandUpdates(() => refreshes++, browser);
  browser.tick();
  browser.dispatchEvent(new Event("focus"));
  assert.equal(refreshes, 2);
  browser.document.visibilityState = "hidden";
  browser.tick();
  browser.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(refreshes, 2);
  browser.document.visibilityState = "visible";
  browser.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(refreshes, 3);
  unsubscribe();
});

test("armazenamento bloqueado não impede a resposta da operação nem atualização local", () => {
  const browser = browserFixture();
  browser.localStorage.setItem = () => { throw new Error("blocked"); };
  let refreshes = 0;
  const unsubscribe = subscribeProductionDemandUpdates(() => refreshes++, browser);
  assert.doesNotThrow(() => notifyProductionDemandUpdate({ method: "patch", url: "/logistica/pedidos/123" }, browser));
  assert.equal(refreshes, 1);
  unsubscribe();
});
