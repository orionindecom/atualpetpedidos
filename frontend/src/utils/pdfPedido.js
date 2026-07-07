import api from "../api/axios";

const isMobileDevice = () => (
  window.matchMedia?.("(max-width: 768px)").matches ||
  /Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent)
);

const sanitizeFileName = (value) => (
  String(value || "pedido")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
);

const downloadBlob = (blobUrl, fileName) => {
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
};

export const abrirOuBaixarPdfPedido = async ({ pedidoId, numeroPedido }) => {
  const response = await api.get(`/pedidos/${pedidoId}/pdf`, {
    responseType: "blob",
  });

  const pdfBlob = new Blob([response.data], {
    type: "application/pdf",
  });
  const blobUrl = URL.createObjectURL(pdfBlob);
  const fileName = `pedido-${sanitizeFileName(numeroPedido || pedidoId)}.pdf`;

  try {
    if (isMobileDevice()) {
      downloadBlob(blobUrl, fileName);
      return;
    }

    const openedWindow = window.open(blobUrl, "_blank");

    if (!openedWindow) {
      downloadBlob(blobUrl, fileName);
    } else {
      openedWindow.opener = null;
    }
  } finally {
    window.setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
    }, 30000);
  }
};
