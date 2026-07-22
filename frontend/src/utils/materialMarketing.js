const emptyFilters = {
  categorias: [],
  tipos: [],
  marcas: [],
  linhas: [],
};

export function normalizeMaterialResponse(data, { pagina = 1, limite = 12 } = {}) {
  if (Array.isArray(data)) {
    return {
      materiais: data,
      paginacao: {
        paginaAtual: pagina,
        totalPaginas: 1,
        totalItens: data.length,
        limite,
        temProximaPagina: false,
      },
      filtros: emptyFilters,
    };
  }

  const materiais = Array.isArray(data?.materiais) ? data.materiais : [];
  const paginacao = data?.paginacao || {};
  const filtros = data?.filtros || {};

  return {
    materiais,
    paginacao: {
      paginaAtual: Number(paginacao.paginaAtual) || pagina,
      totalPaginas: Number(paginacao.totalPaginas) || 0,
      totalItens: Number(paginacao.totalItens) || 0,
      limite: Number(paginacao.limite) || limite,
      temProximaPagina: Boolean(paginacao.temProximaPagina),
    },
    filtros: {
      categorias: Array.isArray(filtros.categorias) ? filtros.categorias : [],
      tipos: Array.isArray(filtros.tipos) ? filtros.tipos : [],
      marcas: Array.isArray(filtros.marcas) ? filtros.marcas : [],
      linhas: Array.isArray(filtros.linhas) ? filtros.linhas : [],
    },
  };
}

export function appendUniqueMaterials(current, next) {
  const ids = new Set(current.map((material) => material._id));
  return [
    ...current,
    ...next.filter((material) => !ids.has(material._id)),
  ];
}

export function isSafeMaterialLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function openMaterialLink(value, openWindow = window.open) {
  if (!isSafeMaterialLink(value)) return false;

  const openedWindow = openWindow(value, "_blank", "noopener,noreferrer");
  if (openedWindow) openedWindow.opener = null;
  return true;
}

export async function copyMaterialLink(
  value,
  { clipboard = navigator.clipboard, documentRef = document } = {}
) {
  if (!isSafeMaterialLink(value)) return false;

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      // Browsers can expose the API but deny it outside a secure context.
    }
  }

  const textarea = documentRef.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  documentRef.body.appendChild(textarea);
  textarea.select();
  const copied = typeof documentRef.execCommand === "function"
    ? documentRef.execCommand("copy")
    : false;
  documentRef.body.removeChild(textarea);
  return copied;
}
