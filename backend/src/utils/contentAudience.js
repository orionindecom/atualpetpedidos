import mongoose from "mongoose";
import Usuario from "../models/Usuario.js";

export const AUDIENCIA_TODOS = "todos";
export const AUDIENCIA_ESPECIFICOS = "especificos";
export const AUDIENCIA_TIPOS = [AUDIENCIA_TODOS, AUDIENCIA_ESPECIFICOS];
export const PUBLICOS_CONTEUDO = ["cliente", "groomer"];

const normalizeIds = (value) => {
  if (value === undefined) return undefined;

  let source = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      source = JSON.parse(trimmed);
    } catch {
      source = trimmed.split(",");
    }
  }

  if (!Array.isArray(source)) return null;

  const ids = [...new Set(source.map((item) => String(item).trim()).filter(Boolean))];
  return ids.every((id) => mongoose.isValidObjectId(id)) ? ids : null;
};

const normalizePublicos = (value) => {
  if (value === undefined) return undefined;

  let source = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      source = JSON.parse(trimmed);
    } catch {
      source = trimmed.split(",");
    }
  }

  if (!Array.isArray(source)) return null;
  const publicos = [...new Set(source.map((item) => String(item).trim()).filter(Boolean))];
  return publicos.every((item) => PUBLICOS_CONTEUDO.includes(item))
    ? publicos
    : null;
};

export const validateAudiencePayload = (
  source = {},
  { partial = false } = {}
) => {
  const data = {};
  const errors = {};
  const hasType = Object.hasOwn(source, "audienciaTipo");
  const hasIds = Object.hasOwn(source, "distribuidoresIds");

  if (!partial && !hasType) {
    data.audienciaTipo = AUDIENCIA_TODOS;
    data.distribuidoresIds = [];
    return { data, errors };
  }

  if (hasType) {
    const type = typeof source.audienciaTipo === "string"
      ? source.audienciaTipo.trim()
      : "";

    if (!AUDIENCIA_TIPOS.includes(type)) {
      errors.audienciaTipo = "Selecione uma audiência válida";
    } else {
      data.audienciaTipo = type;
    }
  }

  if (hasIds) {
    const ids = normalizeIds(source.distribuidoresIds);
    if (ids === null) {
      errors.distribuidoresIds = "Selecione distribuidores válidos";
    } else {
      data.distribuidoresIds = ids;
    }
  }

  const type = data.audienciaTipo;
  if (type === AUDIENCIA_TODOS) {
    data.distribuidoresIds = [];
  } else if (type === AUDIENCIA_ESPECIFICOS && !hasIds) {
    errors.distribuidoresIds = "Selecione ao menos um distribuidor";
  } else if (type === AUDIENCIA_ESPECIFICOS && data.distribuidoresIds?.length === 0) {
    errors.distribuidoresIds = "Selecione ao menos um distribuidor";
  }

  return { data, errors };
};

export const validateContentAudiencePayload = (
  source = {},
  { partial = false } = {}
) => {
  const hasPublicos = Object.hasOwn(source, "publicos");
  const publicos = hasPublicos ? normalizePublicos(source.publicos) : undefined;
  const publicErrors = {};

  if (publicos === null || (hasPublicos && publicos.length === 0)) {
    publicErrors.publicos = "Selecione ao menos um público válido";
  }

  const effectivePublicos = publicos === null
    ? []
    : publicos ?? (partial ? undefined : ["cliente"]);
  const hasCliente = effectivePublicos?.includes("cliente") ?? true;
  const audienceSource = hasCliente ? source : {
    ...source,
    audienciaTipo: AUDIENCIA_TODOS,
    distribuidoresIds: [],
  };
  const audience = validateAudiencePayload(audienceSource, { partial });

  if (effectivePublicos) audience.data.publicos = effectivePublicos;
  return {
    data: audience.data,
    errors: { ...audience.errors, ...publicErrors },
  };
};

export const validateAudienceDistributors = async ({
  publicos,
  audienciaTipo,
  distribuidoresIds = [],
}) => {
  if (Array.isArray(publicos) && !publicos.includes("cliente")) return true;
  if (audienciaTipo !== AUDIENCIA_ESPECIFICOS) return true;
  if (!Array.isArray(distribuidoresIds) || distribuidoresIds.length === 0) {
    return false;
  }

  const total = await Usuario.countDocuments({
    _id: { $in: distribuidoresIds },
    tipo: "cliente",
    ativo: true,
    statusCadastro: "aprovado",
  });

  return total === distribuidoresIds.length;
};

export const buildAudienceFilter = (usuarioId) => ({
  $or: [
    { audienciaTipo: AUDIENCIA_TODOS },
    { audienciaTipo: { $exists: false } },
    { audienciaTipo: null },
    {
      audienciaTipo: AUDIENCIA_ESPECIFICOS,
      distribuidoresIds: usuarioId,
    },
  ],
});

export const buildContentAudienceFilter = (usuario) => {
  // Contas internas autorizadas estudam o conteúdo publicado para apoiar distribuidores.
  if (["admin", "comercial", "vendedor", "marketing", "logistica"].includes(usuario?.tipo)) return {};
  if (usuario?.tipo === "groomer") {
    return { publicos: "groomer" };
  }

  const legacyOrClientProfile = {
    $or: [
      { publicos: "cliente" },
      { publicos: { $exists: false } },
      { publicos: null },
      { publicos: { $size: 0 } },
    ],
  };

  return {
    $and: [
      legacyOrClientProfile,
      buildAudienceFilter(usuario?._id ?? usuario),
    ],
  };
};
