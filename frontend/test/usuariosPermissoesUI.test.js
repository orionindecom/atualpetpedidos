import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyProfileDefaults,
  buildUserPayload,
  changeUserProfile,
  countCustomizedPermissions,
  createUserForm,
  filterUsers,
  getPermissionState,
  groupPermissions,
  INTERNAL_PROFILES,
  isUserFormDirty,
  togglePermission,
  validateUserForm,
} from "../src/utils/userAdmin.js";
import { describeSellerChange } from "../src/utils/sellerAssignment.js";
import { getApiErrorMessage } from "../src/utils/apiErrors.js";
import { canAccessClient, hasGlobalScope, hasPermission, PERMISSIONS, ROLE_PERMISSIONS } from "../src/utils/permissionPolicy.js";
import { canOpenRoute } from "../src/utils/permissions.js";
import { summarizeOrders } from "../src/pages/ContaDashboard/orderSummary.js";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const presets = { permissoes: PERMISSIONS, perfis: ROLE_PERMISSIONS };

test("modal de criação começa vazio, com perfil interno e status ativo", () => {
  const form = createUserForm(null, presets);
  assert.deepEqual(
    { nome: form.nomeResponsavel, email: form.email, tipo: form.tipo, ativo: form.ativo, permissoes: form.permissoes, senha: form.senha },
    { nome: "", email: "", tipo: "comercial", ativo: true, permissoes: {}, senha: "" }
  );
  assert.ok(INTERNAL_PROFILES.includes(form.tipo));
  const source = readSource("../src/components/UserForm/UserFormModal.jsx");
  assert.match(source, /"Novo usuário"/);
  assert.match(source, /"Criar usuário"/);
  assert.match(readSource("../src/pages/AdminUsuarios/AdminUsuarios.jsx"), /\+ Novo usuário/);
});

test("modal de edição reutiliza o componente e carrega os dados atuais sem senha", () => {
  const user = { _id: "u1", nomeResponsavel: "Ana", email: "ana@x.test", tipo: "vendedor", ativo: false, permissoes: { treinamentos: true, clientes: true } };
  const form = createUserForm(user, presets);
  assert.equal(form.nomeResponsavel, "Ana");
  assert.equal(form.ativo, false);
  assert.equal(form.senha, "");
  // Override igual ao padrão do perfil é redundante e não conta como personalização.
  assert.deepEqual(form.permissoes, { treinamentos: true });
  assert.match(readSource("../src/components/UserForm/UserFormModal.jsx"), /"Salvar alterações"/);
});

test("alterações locais não chamam a API antes de salvar", () => {
  const initial = createUserForm({ _id: "u1", nomeResponsavel: "Ana", email: "ana@x.test", tipo: "vendedor", ativo: true }, presets);
  const changed = togglePermission(initial, "treinamentos", true, presets);
  assert.deepEqual(initial.permissoes, {}, "o estado salvo não é mutado");
  assert.deepEqual(changed.permissoes, { treinamentos: true });
  const source = readSource("../src/components/UserForm/UserFormModal.jsx");
  const submitStart = source.indexOf("const submit = async");
  const submitEnd = source.indexOf("const fieldProps");
  const apiCalls = [...source.matchAll(/api\.(post|patch|put|delete)\(/g)].map((match) => match.index);
  assert.ok(apiCalls.length === 2 && apiCalls.every((index) => index > submitStart && index < submitEnd),
    "as únicas escritas ficam dentro do envio do formulário");
});

test("cancelar e fechar não persistem: sem mudanças fecha direto, com mudanças pede confirmação", () => {
  const source = readSource("../src/components/UserForm/UserFormModal.jsx");
  const requestClose = source.slice(source.indexOf("const requestClose"), source.indexOf("const dialogRef"));
  assert.doesNotMatch(requestClose, /api\./);
  assert.match(requestClose, /if \(dirty\) setConfirmDiscard\(true\);\s*else onClose\(\);/);
});

test("estado dirty reflete diferenças reais e volta a limpo ao desfazer", () => {
  const initial = createUserForm({ _id: "u1", nomeResponsavel: "Ana", email: "ana@x.test", tipo: "vendedor", ativo: true }, presets);
  assert.equal(isUserFormDirty(initial, initial), false);
  const inactive = { ...initial, ativo: false };
  assert.equal(isUserFormDirty(inactive, initial), true);
  assert.equal(isUserFormDirty({ ...inactive, ativo: true }, initial), false);
  assert.equal(isUserFormDirty({ ...initial, senha: "NovaSenha1" }, initial), true);
  const toggled = togglePermission(initial, "materiais", true, presets);
  assert.equal(isUserFormDirty(toggled, initial), true);
  assert.equal(isUserFormDirty(togglePermission(toggled, "materiais", false, presets), initial), false);
  assert.match(readSource("../src/components/UserForm/UserFormModal.jsx"), /Alterações não salvas/);
});

test("descarte usa o diálogo da Central, sem window.confirm", () => {
  for (const file of [
    "../src/components/UserForm/UserFormModal.jsx",
    "../src/components/UserForm/PortfolioModal.jsx",
    "../src/components/ClientDetails/SellerAssignment.jsx",
    "../src/components/ClientDetails/ClientDetailModal.jsx",
    "../src/pages/AdminTreinamentos/AdminTreinamentos.jsx",
  ]) {
    assert.doesNotMatch(readSource(file), /window\.confirm/, file);
  }
  const source = readSource("../src/components/UserForm/UserFormModal.jsx");
  assert.match(source, /title="Descartar alterações\?"/);
  assert.match(source, /message="As alterações realizadas ainda não foram salvas\."/);
  assert.match(source, /cancelLabel="Continuar editando"/);
  assert.match(source, /confirmLabel="Descartar"/);
  const dialog = readSource("../src/components/Feedback/FeedbackDialog.jsx");
  assert.match(dialog, /"alertdialog"/);
  assert.match(readSource("../src/components/ConfirmDialog/ConfirmDialog.jsx"), /<FeedbackDialog/);
  assert.match(dialog, /useModalDialog/);
  assert.match(readSource("../src/hooks/useModalDialog.js"), /alertdialog/, "o diálogo aninhado passa a ser o topo da pilha");
});

test("presets e rótulos vêm da API e não da cópia local", () => {
  const apiPresets = {
    permissoes: { clientes: "Ver clientes", novaCapacidade: "Capacidade futura" },
    perfis: { comercial: ["novaCapacidade"] },
  };
  const form = createUserForm(null, apiPresets);
  assert.equal(getPermissionState(form, "novaCapacidade", apiPresets).checked, true);
  assert.equal(getPermissionState(form, "clientes", apiPresets).checked, false);
  const groups = groupPermissions(apiPresets.permissoes);
  assert.deepEqual(groups.map((group) => group.id), ["clientes", "outras"]);
  const source = readSource("../src/components/UserForm/UserFormModal.jsx");
  assert.match(source, /presets\.permissoes\[state\.key\]/, "rótulo exibido é o da API");
  assert.doesNotMatch(readSource("../src/pages/AdminUsuarios/AdminUsuarios.jsx"), /ROLE_PERMISSIONS/);
});

test("troca de perfil não sobrescreve personalizações em silêncio", () => {
  let form = createUserForm(null, presets);
  form = { ...form, tipo: "vendedor", permissoes: {} };
  form = togglePermission(form, "materiais", true, presets);
  const { form: comercial, keptCustomizations } = changeUserProfile(form, "comercial", presets);
  assert.equal(keptCustomizations, 1);
  assert.deepEqual(comercial.permissoes, { materiais: true });
  assert.equal(countCustomizedPermissions(comercial, presets), 1);
  assert.deepEqual(applyProfileDefaults(comercial).permissoes, {});
  const source = readSource("../src/components/UserForm/UserFormModal.jsx");
  assert.match(source, /Aplicar permissões padrão do perfil/);
  assert.match(source, /O perfil define as permissões iniciais\. Você pode personalizá-las abaixo\./);
});

test("permissões bloqueadas pelo perfil não viram overrides no payload", () => {
  const vendedor = { ...createUserForm(null, presets), tipo: "vendedor", nomeResponsavel: "V", email: "v@x.test", senha: "12345678" };
  assert.equal(getPermissionState(vendedor, "pedidosTodos", presets).locked, true);
  assert.equal(getPermissionState({ ...vendedor, tipo: "admin" }, "usuarios", presets).checked, true);
  const payload = buildUserPayload({ ...vendedor, permissoes: { pedidosTodos: true, materiais: true } }, presets);
  assert.deepEqual(payload.permissoes, { materiais: true });
  assert.equal(payload.senha, "12345678");
  assert.equal("senha" in buildUserPayload({ ...vendedor, _id: "u1", senha: "" }, presets), false);
  assert.deepEqual(Object.keys(validateUserForm({ ...vendedor, nomeResponsavel: " ", email: "x", senha: "" })).sort(), ["email", "nomeResponsavel", "senha"]);
});

test("interface usa as permissões efetivas retornadas pelo backend", () => {
  const comercial = { tipo: "comercial", permissoesEfetivas: { materiais: true, acompanharTreinamentos: false } };
  assert.equal(hasPermission(comercial, "materiais"), true);
  assert.equal(hasPermission(comercial, "acompanharTreinamentos"), false);
  assert.equal(canOpenRoute(comercial, "/materiais-marketing"), true);
  assert.equal(canOpenRoute(comercial, "/admin/treinamentos"), false);
  assert.equal(hasPermission({ tipo: "comercial", ativo: false, permissoesEfetivas: { clientes: true } }, "clientes"), false);
});

test("Comercial tem visão global mesmo sem pedidosTodos e sem carteira", () => {
  const leticia = { _id: "c", tipo: "comercial", permissoes: { pedidosTodos: false } };
  assert.equal(hasGlobalScope(leticia), true);
  assert.equal(canAccessClient(leticia, { _id: "x", vendedorResponsavelId: "outro" }), true);
  assert.equal(canAccessClient(leticia, { _id: "y", vendedorResponsavelId: null }), true);
  const carteira = readSource("../src/pages/Carteira/Carteira.jsx");
  assert.match(carteira, /api\.get\("\/carteira"\)/);
  assert.doesNotMatch(carteira, /vendedorResponsavelId/, "a lista exibida é exatamente a devolvida pela API");
  assert.match(carteira, /global \? "Clientes" : "Minha carteira"/);
  assert.match(readSource("../src/components/Navbar/Navbar.jsx"), /globalLabel: "Clientes"/);
});

test("Vendedor respeita a carteira e nunca recebe escopo global", () => {
  const vendedor = { _id: "v", tipo: "vendedor", permissoes: { pedidosTodos: true } };
  assert.equal(hasGlobalScope(vendedor), false);
  assert.equal(canAccessClient(vendedor, { _id: "a", vendedorResponsavelId: "v" }), true);
  assert.equal(canAccessClient(vendedor, { _id: "b", vendedorResponsavelId: "outro" }), false);
  assert.equal(canAccessClient(vendedor, { _id: "c", vendedorResponsavelId: null }), false);
});

test("Vendedor sem clientes vê estado vazio, sem fallback para todos", () => {
  const source = readSource("../src/pages/Carteira/Carteira.jsx");
  assert.match(source, /clientes && clientes\.length === 0/);
  assert.match(source, /"Nenhum cliente atribuído"/);
  assert.equal([...source.matchAll(/api\.get\(/g)].length, 2, "somente /carteira e o detalhe /carteira/:id");
  assert.doesNotMatch(source, /api\.get\("\/(clientes|usuarios)/);
  const dashboard = readSource("../src/pages/ContaDashboard/ContaDashboard.jsx");
  assert.match(dashboard, /const semCarteira = !global && clientes\?\.length === 0;/);
});

test("acompanhamento de treinamentos consulta iniciados e não iniciados", () => {
  const source = readSource("../src/pages/AdminTreinamentos/AdminTreinamentos.jsx");
  assert.match(source, /\/progresso`/);
  assert.match(source, /\/nao-iniciados`/);
  assert.match(source, /Não iniciaram/);
  assert.match(source, /Média assistida/);
  assert.match(source, /Público elegível/);
  assert.equal(canOpenRoute({ tipo: "comercial" }, "/admin/treinamentos"), true);
  assert.equal(canOpenRoute({ tipo: "vendedor" }, "/admin/treinamentos"), false);
  assert.equal(canOpenRoute({ tipo: "cliente" }, "/admin/treinamentos"), false);
  assert.equal(canOpenRoute({ tipo: "marketing" }, "/admin/treinamentos"), true);
});

test("ações de criar, editar e excluir treinamentos dependem de permissão", () => {
  const comercial = { tipo: "comercial" };
  assert.equal(hasPermission(comercial, "acompanharTreinamentos"), true);
  for (const key of ["criarTreinamentos", "editarTreinamentos", "excluirTreinamentos"]) {
    assert.equal(hasPermission(comercial, key), false, key);
  }
  assert.equal(hasPermission({ tipo: "comercial", permissoes: { criarTreinamentos: true } }, "criarTreinamentos"), true);
  const source = readSource("../src/pages/AdminTreinamentos/AdminTreinamentos.jsx");
  assert.match(source, /action=\{canCreate \? <button/);
  assert.match(source, /\{canEdit \? \(\s*<button className=\{styles\.editButton\} onClick=\{\(\) => setFormTraining\(training\)\}>Editar<\/button>/);
  assert.match(source, /\{canEdit && <button disabled=\{actionId === training\._id\}/);
  assert.match(source, /\{canDelete && <button className=\{styles\.deleteButton\}/);
  assert.doesNotMatch(source, /Letícia|leticia/i);
});

test("Material de Marketing fica oculto sem a permissão", () => {
  const comercial = { tipo: "comercial" };
  assert.equal(hasPermission(comercial, "materiais"), false);
  assert.equal(canOpenRoute(comercial, "/materiais-marketing"), false);
  assert.equal(canOpenRoute({ tipo: "comercial", permissoes: { materiais: true } }, "/materiais-marketing"), true);
  const navbar = readSource("../src/components/Navbar/Navbar.jsx");
  assert.match(navbar, /canOpenRoute\(usuario, link\.to, \[usuario\?\.tipo\]\)/);
  const dashboard = readSource("../src/pages/ContaDashboard/ContaDashboard.jsx");
  assert.match(dashboard, /filter\(\(item\) => canOpenRoute\(usuario, item\.to/);
  for (const file of ["../src/components/Navbar/Navbar.jsx", "../src/pages/ContaDashboard/ContaDashboard.jsx", "../src/utils/permissionPolicy.js"]) {
    assert.doesNotMatch(readSource(file), /Letícia|leticia|@atualpet/i, file);
  }
});

test("selecionar vendedor altera somente o rascunho local", () => {
  const source = readSource("../src/components/ClientDetails/SellerAssignment.jsx");
  assert.match(source, /onChange=\{\(event\) => setDraft\(event\.target\.value\)\}/);
  const persistIndex = source.indexOf("const persist = async");
  const calls = [...source.matchAll(/saveSellerAssignment\(api/g)].map((match) => match.index);
  assert.equal(calls.length, 1);
  assert.ok(calls[0] > persistIndex);
  assert.match(source, /"Salvar alteração"/);
  assert.match(source, /Alteração ainda não salva\./);
  assert.doesNotMatch(source, /api\.patch/);
});

test("cancelar a troca não chama a API", () => {
  const source = readSource("../src/components/ClientDetails/SellerAssignment.jsx");
  const cancelEdit = source.slice(source.indexOf("const cancelEdit"), source.indexOf("const persist"));
  assert.doesNotMatch(cancelEdit, /api|persist/);
  assert.match(source, /onCancel=\{\(\) => setPending\(null\)\}/);
});

test("troca e remoção exigem confirmação; primeira atribuição não", () => {
  const nameOf = (id) => ({ v1: "João da Silva", v2: "Pedro Santos" })[id];
  const change = describeSellerChange({ currentId: "v1", nextId: "v2", clientName: "ABC", nameOf });
  assert.equal(change.needsConfirmation, true);
  assert.equal(change.title, "Alterar vendedor responsável?");
  assert.equal(change.message, "Este cliente deixará de estar atribuído a João da Silva e passará para Pedro Santos.");
  assert.equal(change.confirmLabel, "Confirmar alteração");
  const removal = describeSellerChange({ currentId: "v1", nextId: "", clientName: "ABC", nameOf });
  assert.equal(removal.kind, "remove");
  assert.equal(removal.needsConfirmation, true);
  assert.match(removal.message, /deixará de aparecer na carteira de João da Silva/);
  assert.equal(describeSellerChange({ currentId: "", nextId: "v2", clientName: "ABC", nameOf }).needsConfirmation, false);
  assert.equal(describeSellerChange({ currentId: "v1", nextId: "v1", clientName: "ABC", nameOf }).kind, "none");
});

test("feedback traduz erros da API sem esconder mensagens de validação", () => {
  assert.equal(getApiErrorMessage({ response: { status: 409, data: { message: "E-mail já cadastrado" } } }), "E-mail já cadastrado");
  assert.equal(getApiErrorMessage({ response: { status: 400, data: { message: "Dados inválidos", errors: { titulo: "Informe o título" } } } }), "Informe o título");
  assert.equal(getApiErrorMessage({ response: { status: 403, data: { message: "Acesso negado" } } }), "Você não tem permissão para realizar esta ação.");
  assert.match(getApiErrorMessage({ response: { status: 404, data: {} } }), /não encontrado/);
  assert.match(getApiErrorMessage({ response: { status: 500, data: { message: "Erro interno" } } }), /servidor/);
  assert.match(getApiErrorMessage({ request: {} }), /conectar ao servidor/);
  const page = readSource("../src/pages/AdminUsuarios/AdminUsuarios.jsx");
  assert.match(page, /toast\.success\("Alterações salvas"/);
  const modal = readSource("../src/components/UserForm/UserFormModal.jsx");
  assert.match(modal, /setSubmitting\(false\);/, "falha mantém o modal aberto e reabilita o envio");
  assert.match(modal, /disabled=\{submitting \|\| \(!isNew && !dirty\)\}/);
});

test("dashboards resumem pedidos existentes e o distribuidor usa o catálogo atual", () => {
  const resumo = summarizeOrders([
    { _id: "1", status: "enviado", createdAt: "2026-09-01" },
    { _id: "2", status: "separando", createdAt: "2026-09-10" },
    { _id: "3", status: "entregue", createdAt: "2026-08-01" },
    { _id: "4", status: "aguardando_aprovacao", createdAt: "2026-09-20" },
    { _id: "5", status: "cancelado", createdAt: "2026-07-01" },
  ]);
  assert.deepEqual(
    [resumo.emAndamento, resumo.aguardandoRecebimento, resumo.concluidos, resumo.aguardandoAprovacao, resumo.recentes[0]._id],
    [2, 1, 1, 1, "4"]
  );
  const dashboard = readSource("../src/pages/ContaDashboard/ContaDashboard.jsx");
  assert.match(dashboard, /to="\/catalogo">Fazer novo pedido</);
  assert.match(dashboard, /to="\/meus-pedidos">Ver meus pedidos</);
  assert.doesNotMatch(dashboard, /import Catalogo/);
});

test("lista de usuários filtra por texto, perfil e status", () => {
  const users = [
    { nomeResponsavel: "Ana", email: "ana@x.test", tipo: "vendedor", ativo: true },
    { nomeResponsavel: "Beto", nomeFantasia: "Loja Beto", email: "b@x.test", tipo: "cliente", ativo: false },
  ];
  assert.equal(filterUsers(users, { busca: "loja" }).length, 1);
  assert.equal(filterUsers(users, { perfil: "internos" }).length, 1);
  assert.equal(filterUsers(users, { status: "inativo" })[0].nomeResponsavel, "Beto");
});
