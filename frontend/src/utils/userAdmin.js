// Estado local do formulário de usuários. Nada aqui chama a API: seleções
// alteram somente o rascunho, que é enviado apenas ao salvar.
import { PERMISSIONS, resolvePermission } from "./permissionPolicy.js";

export const PROFILE_LABELS = {
  admin: "Admin",
  comercial: "Comercial",
  vendedor: "Vendedor",
  marketing: "Marketing",
  logistica: "Logística",
  cliente: "Distribuidor",
  groomer: "Groomer",
};

// Distribuidores e Groomers nascem pelo cadastro próprio, com CNPJ, tabela e aprovação.
export const INTERNAL_PROFILES = ["comercial", "vendedor", "marketing", "logistica", "admin"];
export const EXTERNAL_PROFILES = ["cliente", "groomer"];

export const profileLabel = (tipo) => PROFILE_LABELS[tipo] || tipo || "—";

// Agrupamento visual das chaves reais recebidas em /usuarios/presets.
const PERMISSION_GROUPS = [
  { id: "clientes", title: "Clientes e carteira", keys: ["clientes", "pedidosCarteira", "pedidosTodos"] },
  { id: "pedidos", title: "Pedidos", keys: ["criarPedidos", "editarPedidos", "aprovarPedidos", "excluirPedidos"] },
  { id: "comercial", title: "Preços e tabelas", keys: ["comercial"] },
  { id: "treinamentos", title: "Treinamentos", keys: ["treinamentos", "acompanharTreinamentos", "criarTreinamentos", "editarTreinamentos", "excluirTreinamentos"] },
  { id: "conteudo", title: "Marketing e conteúdo", keys: ["materiais", "conteudo"] },
  { id: "logistica", title: "Logística", keys: ["logistica", "producao", "conferencia", "faturamento"] },
  { id: "administracao", title: "Administração", keys: ["usuarios"] },
];

export function groupPermissions(catalog = {}) {
  const known = new Set(PERMISSION_GROUPS.flatMap((group) => group.keys));
  const groups = PERMISSION_GROUPS
    .map((group) => ({ ...group, keys: group.keys.filter((key) => Object.hasOwn(catalog, key)) }))
    .filter((group) => group.keys.length > 0);
  const others = Object.keys(catalog).filter((key) => !known.has(key));
  if (others.length) groups.push({ id: "outras", title: "Outras permissões", keys: others });
  return groups;
}

const presetIncludes = (presets, tipo, key) => Boolean(presets?.perfis?.[tipo]?.includes(key));

// Permissões que o perfil não permite alterar (ex.: Admin tem acesso total).
export function getLockedValue(tipo, key) {
  // Chave nova da API, ainda desconhecida pela cópia local: o backend decide.
  if (!Object.hasOwn(PERMISSIONS, key)) return undefined;
  const granted = resolvePermission({ tipo, permissoes: { [key]: true } }, key);
  const denied = resolvePermission({ tipo, permissoes: { [key]: false } }, key);
  return granted === denied ? granted : undefined;
}

export function getPermissionState(form, key, presets) {
  const presetValue = presetIncludes(presets, form.tipo, key);
  const lockedValue = getLockedValue(form.tipo, key);
  if (lockedValue !== undefined) {
    return { checked: lockedValue, locked: true, customized: false, presetValue };
  }
  const override = form.permissoes?.[key];
  const checked = typeof override === "boolean" ? override : presetValue;
  return { checked, locked: false, customized: checked !== presetValue, presetValue };
}

// Remove overrides redundantes (iguais ao perfil) ou sem efeito (bloqueados pelo perfil).
export function normalizeOverrides(permissoes = {}, tipo, presets) {
  return Object.fromEntries(Object.entries(permissoes || {}).filter(([key, value]) => (
    typeof value === "boolean" &&
    Object.hasOwn(presets?.permissoes || {}, key) &&
    getLockedValue(tipo, key) === undefined &&
    value !== presetIncludes(presets, tipo, key)
  )));
}

export function createUserForm(user, presets) {
  const tipo = user?.tipo || "comercial";
  return {
    _id: user?._id || null,
    nomeResponsavel: user?.nomeResponsavel || "",
    email: user?.email || "",
    tipo,
    ativo: user ? user.ativo !== false : true,
    permissoes: normalizeOverrides(user?.permissoes, tipo, presets),
    senha: "",
  };
}

const sortedEntries = (object = {}) => Object.entries(object).sort(([a], [b]) => a.localeCompare(b));

export function isUserFormDirty(form, initial) {
  if (!form || !initial) return false;
  return form.nomeResponsavel !== initial.nomeResponsavel ||
    form.email !== initial.email ||
    form.tipo !== initial.tipo ||
    form.ativo !== initial.ativo ||
    Boolean(form.senha) ||
    JSON.stringify(sortedEntries(form.permissoes)) !== JSON.stringify(sortedEntries(initial.permissoes));
}

export function togglePermission(form, key, checked, presets) {
  const permissoes = { ...form.permissoes };
  if (checked === presetIncludes(presets, form.tipo, key)) delete permissoes[key];
  else permissoes[key] = checked;
  return { ...form, permissoes };
}

export const countCustomizedPermissions = (form, presets) => Object.keys(
  normalizeOverrides(form.permissoes, form.tipo, presets)
).length;

// Troca de perfil mantém personalizações; aplicar o padrão é uma ação explícita.
export function changeUserProfile(form, tipo, presets) {
  const permissoes = normalizeOverrides(form.permissoes, tipo, presets);
  return { form: { ...form, tipo, permissoes }, keptCustomizations: Object.keys(permissoes).length };
}

export const applyProfileDefaults = (form) => ({ ...form, permissoes: {} });

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateUserForm(form) {
  const errors = {};
  const isNew = !form._id;
  if (!form.nomeResponsavel.trim()) errors.nomeResponsavel = "Informe o nome.";
  else if (form.nomeResponsavel.trim().length > 120) errors.nomeResponsavel = "Use até 120 caracteres.";
  if (!EMAIL_PATTERN.test(form.email.trim())) errors.email = "Informe um e-mail válido.";
  if (isNew && !form.senha) errors.senha = "Defina uma senha inicial.";
  else if (form.senha && (form.senha.length < 8 || form.senha.length > 128)) {
    errors.senha = "A senha precisa ter entre 8 e 128 caracteres.";
  }
  return errors;
}

export function buildUserPayload(form, presets) {
  const payload = {
    nomeResponsavel: form.nomeResponsavel.trim(),
    email: form.email.trim(),
    tipo: form.tipo,
    ativo: form.ativo,
    permissoes: normalizeOverrides(form.permissoes, form.tipo, presets),
  };
  if (form.senha) payload.senha = form.senha;
  return payload;
}

export function filterUsers(users = [], { busca = "", perfil = "", status = "" } = {}) {
  const term = busca.trim().toLocaleLowerCase("pt-BR");
  return users.filter((user) => {
    const text = [user.nomeResponsavel, user.nomeFantasia, user.email].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
    const matchesProfile = !perfil ||
      (perfil === "internos" ? !EXTERNAL_PROFILES.includes(user.tipo) : user.tipo === perfil);
    const matchesStatus = !status || (status === "ativo" ? user.ativo !== false : user.ativo === false);
    return (!term || text.includes(term)) && matchesProfile && matchesStatus;
  });
}
