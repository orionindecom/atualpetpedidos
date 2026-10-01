// Atribuição de vendedor responsável. Selecionar altera apenas o rascunho;
// estas funções só são chamadas depois do "Salvar" e da confirmação.
const sameId = (a, b) => String(a || "") === String(b || "");

export const getClientName = (client) =>
  client?.nomeFantasia || client?.razaoSocial || client?.nomeResponsavel || "Cliente";

export function describeSellerChange({ currentId, nextId, clientName, nameOf }) {
  const current = currentId ? nameOf(currentId) : "";
  const next = nextId ? nameOf(nextId) : "";
  if (sameId(currentId, nextId)) return { kind: "none", needsConfirmation: false };
  if (!currentId) {
    return {
      kind: "assign",
      needsConfirmation: false,
      success: `${next} agora é o vendedor responsável por ${clientName}.`,
    };
  }
  if (!nextId) {
    return {
      kind: "remove",
      needsConfirmation: true,
      title: "Remover vendedor responsável?",
      message: `${clientName} deixará de aparecer na carteira de ${current}. Os pedidos já registrados não são alterados.`,
      confirmLabel: "Remover vendedor",
      success: `${clientName} ficou sem vendedor responsável.`,
    };
  }
  return {
    kind: "change",
    needsConfirmation: true,
    title: "Alterar vendedor responsável?",
    message: `Este cliente deixará de estar atribuído a ${current} e passará para ${next}.`,
    confirmLabel: "Confirmar alteração",
    success: `${next} agora é o vendedor responsável por ${clientName}.`,
  };
}

export const SELLER_ASSIGNMENT_CONFLICT = "SELLER_ASSIGNMENT_CONFLICT";

// Payload do contrato: o estado esperado é a relação observada quando a edição começou.
// O backend compara e grava atomicamente; o frontend não relê nem substitui esse valor.
export const buildAssignmentPayload = (nextSellerId, expectedSellerId) => ({
  vendedorResponsavelId: nextSellerId || null,
  vendedorResponsavelEsperadoId: expectedSellerId || null,
});

export function readAssignmentConflict(error) {
  const data = error?.response?.data;
  if (error?.response?.status !== 409 || data?.code !== SELLER_ASSIGNMENT_CONFLICT) return null;
  return {
    currentSellerId: data.currentSellerId ? String(data.currentSellerId) : null,
    currentSellerName: data.currentSellerName || null,
  };
}

// Uma única escrita por intenção confirmada. Conflito não é repetido automaticamente:
// a interface mostra o responsável atual e pede uma nova decisão.
export async function saveSellerAssignment(api, { clientId, expectedSellerId, nextSellerId }) {
  try {
    const { data } = await api.patch(`/usuarios/${clientId}/vendedor`, buildAssignmentPayload(nextSellerId, expectedSellerId));
    return { status: "saved", client: data };
  } catch (error) {
    const conflict = readAssignmentConflict(error);
    if (!conflict) throw error;
    return { status: "conflict", ...conflict };
  }
}

// Diferenças entre a carteira salva de um vendedor e a seleção em edição.
export function planPortfolioChanges({ sellerId, clients = [], selectedIds }) {
  const selected = new Set([...selectedIds].map(String));
  const add = [];
  const remove = [];
  for (const client of clients) {
    const assigned = sameId(client.vendedorResponsavelId, sellerId);
    const wanted = selected.has(String(client._id));
    if (wanted && !assigned) add.push(client);
    if (!wanted && assigned) remove.push(client);
  }
  const transfers = add.filter((client) => client.vendedorResponsavelId);
  return { add, remove, transfers, total: add.length + remove.length };
}

// Aplica as mudanças uma a uma (o backend não possui escrita em lote). Cada PATCH leva
// o responsável que aquele cliente tinha quando a carteira foi aberta.
export async function applyPortfolioChanges(api, { sellerId, plan }) {
  const result = { saved: [], conflicts: [], failed: [] };
  const operations = [
    ...plan.add.map((client) => ({ client, next: sellerId })),
    ...plan.remove.map((client) => ({ client, next: null })),
  ];
  for (const { client, next } of operations) {
    try {
      await api.patch(`/usuarios/${client._id}/vendedor`, buildAssignmentPayload(next, client.vendedorResponsavelId));
      result.saved.push(client);
    } catch (error) {
      const conflict = readAssignmentConflict(error);
      if (conflict) result.conflicts.push({ ...client, ...conflict });
      else result.failed.push({ client, error });
    }
  }
  return result;
}

// Responsáveis vêm de GET /usuarios/responsaveis: Vendedor e Comercial ativos.
// Ser responsável não muda escopo: Vendedor atua pela carteira; Comercial segue global.
export const RESPONSIBLE_PROFILE_LABELS = { vendedor: "Vendedor", comercial: "Comercial" };

export const responsibleScopeLabel = (tipo) => (
  tipo === "comercial"
    ? "Comercial (visão global de clientes)"
    : tipo === "vendedor"
      ? "Vendedor (atende pela carteira)"
      : ""
);

export function groupResponsibles(list = []) {
  const valid = Array.isArray(list) ? list : [];
  return {
    vendedores: valid.filter((item) => item.tipo === "vendedor"),
    comerciais: valid.filter((item) => item.tipo === "comercial"),
  };
}

// Conflito 409: explica o que mudou, mostra o responsável atual e não refaz a escrita.
export function buildConflictDialog({ clientName, currentSellerId, currentSellerName }) {
  const atual = currentSellerId
    ? currentSellerName || "Responsável sem acesso ativo"
    : "Nenhum responsável";
  return {
    variant: "warning",
    icon: "userSwitch",
    title: "Responsável alterado por outra pessoa",
    message: `Enquanto você estava editando, ${clientName} passou a ter outro responsável. Sua alteração não foi aplicada.`,
    details: [{ label: "Responsável atual", value: atual }],
    confirmLabel: "Atualizar",
  };
}
