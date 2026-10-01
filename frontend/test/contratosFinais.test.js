import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyPortfolioChanges,
  buildAssignmentPayload,
  buildConflictDialog,
  groupResponsibles,
  planPortfolioChanges,
  readAssignmentConflict,
  responsibleScopeLabel,
  saveSellerAssignment,
} from "../src/utils/sellerAssignment.js";
import {
  ACCOUNT_DISABLED_DIALOG,
  classifyLoginError,
  PENDING_APPROVAL_DIALOG,
  REJECTED_REGISTRATION_DIALOG,
} from "../src/utils/accessFeedback.js";
import { canAccessClient, hasGlobalScope } from "../src/utils/permissionPolicy.js";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const sellerComponent = readSource("../src/components/ClientDetails/SellerAssignment.jsx");
const sellerUtils = readSource("../src/utils/sellerAssignment.js");

const conflictError = (currentSellerId, currentSellerName) => ({
  response: {
    status: 409,
    data: { code: "SELLER_ASSIGNMENT_CONFLICT", message: "O vendedor responsável foi alterado por outro usuário.", currentSellerId, currentSellerName },
  },
});

// API falsa que registra cada chamada e responde conforme o cenário.
const fakeApi = (responses = {}) => {
  const calls = [];
  return {
    calls,
    get: async (url) => { calls.push(["get", url]); return { data: responses[url] ?? [] }; },
    patch: async (url, body) => {
      calls.push(["patch", url, body]);
      const outcome = typeof responses.patch === "function" ? responses.patch(url, body) : null;
      if (outcome instanceof Error || outcome?.response) throw outcome;
      return { data: { _id: url.split("/")[2], vendedorResponsavelId: body.vendedorResponsavelId } };
    },
  };
};

// Concorrência atômica
test("primeira atribuição envia responsável esperado null", async () => {
  const api = fakeApi();
  await saveSellerAssignment(api, { clientId: "c1", expectedSellerId: "", nextSellerId: "joao" });
  assert.deepEqual(api.calls, [["patch", "/usuarios/c1/vendedor", { vendedorResponsavelId: "joao", vendedorResponsavelEsperadoId: null }]]);
});

test("troca envia o responsável anterior como esperado", async () => {
  const api = fakeApi();
  await saveSellerAssignment(api, { clientId: "c1", expectedSellerId: "joao", nextSellerId: "pedro" });
  assert.deepEqual(api.calls[0][2], { vendedorResponsavelId: "pedro", vendedorResponsavelEsperadoId: "joao" });
});

test("remoção envia o responsável anterior como esperado e novo null", async () => {
  const api = fakeApi();
  await saveSellerAssignment(api, { clientId: "c1", expectedSellerId: "joao", nextSellerId: "" });
  assert.deepEqual(api.calls[0][2], { vendedorResponsavelId: null, vendedorResponsavelEsperadoId: "joao" });
  assert.deepEqual(buildAssignmentPayload(undefined, undefined), { vendedorResponsavelId: null, vendedorResponsavelEsperadoId: null });
});

test("sem leitura preventiva: a comparação é do backend, em uma única escrita", async () => {
  const api = fakeApi();
  await saveSellerAssignment(api, { clientId: "c1", expectedSellerId: "joao", nextSellerId: "pedro" });
  assert.equal(api.calls.filter(([method]) => method === "get").length, 0);
  assert.doesNotMatch(sellerUtils, /\/carteira\/|readCurrentSeller/);
});

test("409 SELLER_ASSIGNMENT_CONFLICT não sobrescreve e não repete automaticamente", async () => {
  const api = fakeApi({ patch: () => conflictError("pedro", "Pedro Santos") });
  const result = await saveSellerAssignment(api, { clientId: "c1", expectedSellerId: "joao", nextSellerId: "leticia" });
  assert.deepEqual(result, { status: "conflict", currentSellerId: "pedro", currentSellerName: "Pedro Santos" });
  assert.equal(api.calls.length, 1, "nenhum retry automático nem segunda escrita");
});

test("outros 409 administrativos não são confundidos com conflito de atribuição", async () => {
  const api = fakeApi({ patch: () => ({ response: { status: 409, data: { message: "Restrição administrativa" } } }) });
  await assert.rejects(saveSellerAssignment(api, { clientId: "c1", expectedSellerId: "", nextSellerId: "joao" }));
  assert.equal(readAssignmentConflict({ response: { status: 409, data: {} } }), null);
});

test("conflito mostra o responsável atual em diálogo próprio", () => {
  const view = buildConflictDialog({ clientName: "Distribuidora ABC", currentSellerId: "pedro", currentSellerName: "Pedro Santos" });
  assert.equal(view.title, "Responsável alterado por outra pessoa");
  assert.equal(view.icon, "userSwitch");
  assert.equal(view.confirmLabel, "Atualizar");
  assert.deepEqual(view.details, [{ label: "Responsável atual", value: "Pedro Santos" }]);
  assert.match(view.message, /Sua alteração não foi aplicada/);
  assert.deepEqual(buildConflictDialog({ clientName: "ABC", currentSellerId: null, currentSellerName: null }).details[0].value, "Nenhum responsável");
  assert.deepEqual(buildConflictDialog({ clientName: "ABC", currentSellerId: "x", currentSellerName: null }).details[0].value, "Responsável sem acesso ativo");
  assert.match(sellerComponent, /await dialog\.alert\(buildConflictDialog\(\{ clientName, \.\.\.conflict \}\)\)/);
});

test("conflito atualiza a interface e permite nova tentativa consciente", () => {
  const showConflict = sellerComponent.slice(sellerComponent.indexOf("const showConflict"), sellerComponent.indexOf("const persist"));
  assert.match(showConflict, /setCurrentId\(latest\)/, "passa a exibir o responsável atual");
  assert.match(showConflict, /setEditing\(false\)/, "descarta a intenção conflitante");
  assert.match(showConflict, /setDraft\(""\)/);
  assert.match(showConflict, /onChange\?\.\(\{ \.\.\.cliente, vendedorResponsavelId: latest \|\| null \}\)/);
  assert.doesNotMatch(showConflict, /saveSellerAssignment|persist\(/, "não regrava sozinho");
  // Nova edição parte do estado atualizado.
  assert.match(sellerComponent, /const startEdit = \(\) => \{\s*setExpectedId\(currentId\);/);
});

test("estado esperado é o observado ao abrir a edição, não o mais recente", () => {
  const persist = sellerComponent.slice(sellerComponent.indexOf("const persist"), sellerComponent.indexOf("const requestSave"));
  assert.match(persist, /const baseId = editing \? expectedId : currentId;/);
  assert.match(persist, /expectedSellerId: baseId \|\| null/);
});

test("carteira envia o estado esperado individual de cada cliente", async () => {
  const clients = [
    { _id: "a", vendedorResponsavelId: null },
    { _id: "b", vendedorResponsavelId: "pedro" },
    { _id: "c", vendedorResponsavelId: "joao" },
  ];
  const plan = planPortfolioChanges({ sellerId: "joao", clients, selectedIds: new Set(["a", "b"]) });
  const api = fakeApi();
  await applyPortfolioChanges(api, { sellerId: "joao", plan });
  assert.deepEqual(api.calls, [
    ["patch", "/usuarios/a/vendedor", { vendedorResponsavelId: "joao", vendedorResponsavelEsperadoId: null }],
    ["patch", "/usuarios/b/vendedor", { vendedorResponsavelId: "joao", vendedorResponsavelEsperadoId: "pedro" }],
    ["patch", "/usuarios/c/vendedor", { vendedorResponsavelId: null, vendedorResponsavelEsperadoId: "joao" }],
  ], "sem leitura prévia de /usuarios e sem lote");
});

test("carteira: sucesso parcial com conflito é preservado e informado", async () => {
  const clients = [
    { _id: "a", nomeFantasia: "Cliente A", vendedorResponsavelId: null },
    { _id: "b", nomeFantasia: "Cliente B", vendedorResponsavelId: null },
    { _id: "c", nomeFantasia: "Cliente C", vendedorResponsavelId: "joao" },
  ];
  const plan = planPortfolioChanges({ sellerId: "joao", clients, selectedIds: new Set(["a", "b"]) });
  const api = fakeApi({
    patch: (url) => (url === "/usuarios/b/vendedor" ? conflictError("pedro", "Pedro Santos")
      : url === "/usuarios/c/vendedor" ? { response: { status: 500, data: {} } } : null),
  });
  const result = await applyPortfolioChanges(api, { sellerId: "joao", plan });
  assert.deepEqual(result.saved.map((client) => client._id), ["a"]);
  assert.deepEqual(result.conflicts.map((client) => [client._id, client.currentSellerName]), [["b", "Pedro Santos"]]);
  assert.deepEqual(result.failed.map(({ client }) => client._id), ["c"]);
  assert.equal(api.calls.length, 3, "cada cliente uma única vez");
  const modal = readSource("../src/components/UserForm/PortfolioModal.jsx");
  assert.match(modal, /alteração salva", "alterações salvas"/);
  assert.match(modal, /\(agora \$\{atual\(conflict\)\}\)/, "mostra o responsável atual do conflito");
  assert.match(modal, /const freshClients = await reload\(\);/, "recarrega os dados após resultado parcial");
});

// Responsáveis
test("seleção de responsável consulta /usuarios/responsaveis e não a lista completa", () => {
  assert.match(sellerComponent, /api\.get\("\/usuarios\/responsaveis"\)/);
  assert.doesNotMatch(sellerComponent, /api\.get\("\/usuarios"\)/, "workaround via /usuarios removido");
  assert.doesNotMatch(sellerComponent, /\/usuarios\/vendedores/);
});

test("Vendedor e Comercial aparecem separados e identificados", () => {
  const list = [
    { _id: "1", nomeResponsavel: "João da Silva", tipo: "vendedor" },
    { _id: "2", nomeResponsavel: "Letícia Souza", tipo: "comercial" },
  ];
  const { vendedores, comerciais } = groupResponsibles(list);
  assert.deepEqual(vendedores.map((item) => item.nomeResponsavel), ["João da Silva"]);
  assert.deepEqual(comerciais.map((item) => item.nomeResponsavel), ["Letícia Souza"]);
  assert.match(sellerComponent, /<optgroup label="Vendedores">/);
  assert.match(sellerComponent, /<optgroup label="Comercial \(visão global\)">/);
  assert.deepEqual(groupResponsibles(null), { vendedores: [], comerciais: [] });
});

test("seleção de Comercial e de Vendedor gera o mesmo contrato de atribuição", async () => {
  for (const next of ["leticia-comercial", "joao-vendedor"]) {
    const api = fakeApi();
    const result = await saveSellerAssignment(api, { clientId: "c1", expectedSellerId: "x", nextSellerId: next });
    assert.equal(result.status, "saved");
    assert.equal(api.calls[0][2].vendedorResponsavelId, next);
  }
});

test("Comercial responsável continua global; Vendedor continua restrito", () => {
  assert.equal(responsibleScopeLabel("comercial"), "Comercial (visão global de clientes)");
  assert.equal(responsibleScopeLabel("vendedor"), "Vendedor (atende pela carteira)");
  const leticia = { _id: "l", tipo: "comercial" };
  assert.equal(hasGlobalScope(leticia), true);
  assert.equal(canAccessClient(leticia, { _id: "outro", vendedorResponsavelId: "joao" }), true);
  const joao = { _id: "joao", tipo: "vendedor" };
  assert.equal(canAccessClient(joao, { _id: "x", vendedorResponsavelId: "l" }), false);
});

// Login
test("REGISTRATION_PENDING abre o feedback de análise", () => {
  const result = classifyLoginError({ response: { status: 403, data: { code: "REGISTRATION_PENDING", status: "pendente", message: "Cadastro ainda não aprovado." } } });
  assert.equal(result.dialog, PENDING_APPROVAL_DIALOG);
  assert.equal(PENDING_APPROVAL_DIALOG.icon, "hourglass");
  assert.equal(PENDING_APPROVAL_DIALOG.title, "Cadastro em análise");
});

test("REGISTRATION_REJECTED abre o feedback de cadastro não aprovado com textos diferentes", () => {
  const result = classifyLoginError({ response: { status: 403, data: { code: "REGISTRATION_REJECTED", status: "reprovado", message: "Cadastro não aprovado." } } });
  assert.equal(result.dialog, REJECTED_REGISTRATION_DIALOG);
  assert.equal(REJECTED_REGISTRATION_DIALOG.icon, "fileX");
  assert.equal(REJECTED_REGISTRATION_DIALOG.title, "Cadastro não aprovado");
  assert.equal(REJECTED_REGISTRATION_DIALOG.message, "Seu cadastro não foi aprovado para acesso à Central Atual Pet.");
  assert.notEqual(REJECTED_REGISTRATION_DIALOG.title, PENDING_APPROVAL_DIALOG.title);
  assert.notEqual(REJECTED_REGISTRATION_DIALOG.message, PENDING_APPROVAL_DIALOG.message);
});

test("classificação usa o code, não o texto da mensagem", () => {
  const swapped = classifyLoginError({ response: { status: 403, data: { code: "REGISTRATION_REJECTED", message: "Cadastro ainda não aprovado." } } });
  assert.equal(swapped.dialog, REJECTED_REGISTRATION_DIALOG);
  const noCode = classifyLoginError({ response: { status: 403, data: { message: "Cadastro ainda não aprovado pelo administrador" } } });
  assert.notEqual(noCode.dialog, PENDING_APPROVAL_DIALOG, "sem code não infere pendência pelo texto");
  assert.equal(noCode.dialog.title, "Acesso não liberado");
});

test("credenciais inválidas continuam inline e sem enumeração de contas", () => {
  const invalid = classifyLoginError({ response: { status: 401, data: { message: "E-mail ou senha inválidos" } } });
  assert.equal(invalid.dialog, undefined);
  assert.equal(invalid.message, "E-mail ou senha inválidos. Confira os dados e tente novamente.");
  const login = readSource("../src/pages/Login/Login.jsx");
  assert.match(login, /setErroLogin\(acesso\.message\)/);
});

test("conta desativada preserva o popup existente", () => {
  const disabled = classifyLoginError({ response: { status: 403, data: { message: "Usuário desativado" } } });
  assert.equal(disabled.dialog, ACCOUNT_DISABLED_DIALOG);
  assert.equal(ACCOUNT_DISABLED_DIALOG.icon, "lock");
});

test("usuário aprovado entra normalmente, sem popup", () => {
  const login = readSource("../src/pages/Login/Login.jsx");
  const success = login.slice(login.indexOf("const response = await api.post"), login.indexOf("} catch (error)"));
  assert.match(success, /navigate\(homeByRole\[response\.data\.usuario\.tipo\]/);
  assert.doesNotMatch(success, /dialog\.|toast\./);
});

test("motivo interno de reprovação não é exibido nem prometido", () => {
  const result = classifyLoginError({ response: { status: 403, data: { code: "REGISTRATION_REJECTED", motivo: "Documento divergente", motivoInterno: "x" } } });
  assert.equal(JSON.stringify(result.dialog).includes("Documento divergente"), false);
  assert.doesNotMatch(REJECTED_REGISTRATION_DIALOG.message, /motivo|contato|reavalia|entraremos/i);
  assert.doesNotMatch(PENDING_APPROVAL_DIALOG.message, /avisaremos|e-mail|notifica/i);
});

test("recusa no admin continua respeitosa", () => {
  const admin = readSource("../src/pages/AdminClientes/AdminClientes.jsx");
  assert.match(admin, /variant: "warning",\s*icon: "fileX",\s*title: "Recusar cadastro\?"/);
});
