const DISTRIBUTOR_EDITABLE_FIELDS = Object.freeze([
  "nomeResponsavel",
  "razaoSocial",
  "nomeFantasia",
  "telefone",
  "whatsapp",
]);

const GROOMER_EDITABLE_FIELDS = Object.freeze([
  "nomeResponsavel",
  "whatsapp",
  "cidade",
  "estado",
  "nomeProfissional",
  "instagram",
  "tiktok",
  "observacaoCadastro",
]);

const normalizeClientDocument = (value) => String(value ?? "").replace(/\D/g, "");

export const getClientDocumentType = (value) => {
  const digits = normalizeClientDocument(value);
  if (digits.length === 11) return "cpf";
  if (digits.length === 14) return "cnpj";
  return null;
};

export const getClientDocumentLabel = (value) => {
  const type = getClientDocumentType(value);
  if (type === "cpf") return "CPF";
  if (type === "cnpj") return "CNPJ";
  return "CPF/CNPJ";
};

export const formatClientDocument = (value) => {
  const rawValue = String(value ?? "").trim();
  const digits = normalizeClientDocument(rawValue);
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  return rawValue;
};

export const getClientTableId = (client) => {
  if (!client || typeof client !== "object") return "";
  const table = client.tabelaPrecoId;
  if (!table) return "";
  return typeof table === "object" ? String(table._id || "") : String(table);
};

export const buildAdminClientForm = (client) => {
  const source = client && typeof client === "object" ? client : {};
  return {
    nomeResponsavel: source.nomeResponsavel || "",
    razaoSocial: source.razaoSocial || "",
    nomeFantasia: source.nomeFantasia || "",
    telefone: source.telefone || "",
    whatsapp: source.whatsapp || "",
    cidade: source.cidade || "",
    estado: source.estado || "",
    nomeProfissional: source.nomeProfissional || "",
    instagram: source.instagram || "",
    tiktok: source.tiktok || "",
    observacaoCadastro: source.observacaoCadastro || "",
    tabelaPrecoId: getClientTableId(source),
  };
};

export const buildAdminClientPayload = (form, persistedClient) => {
  if (
    !form ||
    typeof form !== "object" ||
    !persistedClient ||
    typeof persistedClient !== "object"
  ) return {};

  const formSource = form;
  const persistedSource = persistedClient;
  const payload = {};

  const editableFields = persistedSource.tipo === "groomer"
    ? GROOMER_EDITABLE_FIELDS
    : DISTRIBUTOR_EDITABLE_FIELDS;
  for (const field of editableFields) {
    const value = String(formSource[field] ?? "").trim();
    const persistedValue = String(persistedSource[field] ?? "").trim();
    if (value !== persistedValue) payload[field] = value;
  }

  if (persistedSource.tipo !== "groomer") {
    const tableId = String(formSource.tabelaPrecoId || "");
    if (tableId !== getClientTableId(persistedSource) && tableId) {
      payload.tabelaPrecoId = tableId;
    }
  }

  return payload;
};

export const isGroomerAccount = (client) => client?.tipo === "groomer";

export const getClientAccountTypeLabel = (client) => (
  isGroomerAccount(client) ? "Groomer" : "Distribuidor"
);

export const getClientDisplayName = (client) => {
  if (!client || typeof client !== "object") return "";
  return isGroomerAccount(client)
    ? client.nomeProfissional || client.nomeResponsavel || "Groomer"
    : client.nomeFantasia || client.nomeResponsavel || "Distribuidor";
};

export const isAvailableDistributorTable = (table) => Boolean(
  table &&
  typeof table === "object" &&
  table.ativa !== false &&
  (!table.tipo || table.tipo === "distribuidor")
);

export const isClientAccountActive = (client) => Boolean(
  client &&
  typeof client === "object" &&
  client.ativo !== false &&
  client.statusCadastro !== "inativo"
);

export const getApprovalStatus = (client) => {
  if (!client || typeof client !== "object") return undefined;
  return client.statusCadastro === "inativo" ? "aprovado" : client.statusCadastro;
};
