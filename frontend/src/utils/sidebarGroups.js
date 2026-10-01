// Grupos recolhíveis da navegação lateral. Atua somente sobre os links que a
// Navbar já filtrou por permissão; não decide o que o usuário pode ver.

// Painéis cujas subpáginas têm item próprio no menu (NavLink com `end`).
export const EXACT_ROUTES = new Set(["/pedidos", "/admin", "/marketing", "/logistica"]);

// "Visão geral" é o ponto de entrada (Dashboard) e permanece sempre visível.
export const FIXED_GROUPS = new Set(["Visão geral"]);

export const sidebarStorageKey = (tipo) => `atualpet:sidebar:grupos:${tipo || "anonimo"}`;

const slug = (text) => String(text)
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

export const sectionId = (group) => `sidebar-grupo-${slug(group)}`;

// Agrupa links consecutivos do mesmo grupo. Grupo sem link visível não existe.
export function buildSections(links = []) {
  const sections = [];
  for (const link of links) {
    const last = sections.at(-1);
    if (last && last.group === link.group) last.links.push(link);
    else sections.push({ group: link.group, id: sectionId(link.group), links: [link] });
  }
  return sections.map((section) => ({ ...section, collapsible: !FIXED_GROUPS.has(section.group) }));
}

export function linkMatchesPath(to, pathname = "") {
  if (EXACT_ROUTES.has(to)) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

// Grupo da rota atual: o link mais específico que corresponde ao caminho.
export function findActiveGroup(sections, pathname) {
  let best = null;
  for (const section of sections) {
    for (const link of section.links) {
      if (linkMatchesPath(link.to, pathname) && (!best || link.to.length > best.length)) {
        best = { group: section.group, length: link.to.length };
      }
    }
  }
  return best?.group || null;
}

// Estado efetivo: fixos e o grupo da rota atual sempre abertos;
// os demais seguem a preferência salva (fechados por padrão).
export function resolveOpenGroups({ sections, stored = {}, activeGroup }) {
  return Object.fromEntries(sections.map((section) => [
    section.group,
    !section.collapsible || section.group === activeGroup || stored[section.group] === true,
  ]));
}

export function toggleStoredGroup(stored = {}, group, currentlyOpen) {
  return { ...stored, [group]: !currentlyOpen };
}

export function readStoredGroups(storage, key) {
  try {
    const value = JSON.parse(storage?.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function writeStoredGroups(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Preferência visual apenas: falha de armazenamento não afeta a navegação.
  }
}
