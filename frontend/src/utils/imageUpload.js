export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp";

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const allowedExtensions = new Set(["jpg", "jpeg", "png", "webp"]);

export const validateImageFile = (file) => {
  if (!file || typeof file !== "object") {
    return { valid: false, message: "Selecione uma imagem válida." };
  }

  if (!allowedMimeTypes.has(file.type)) {
    return { valid: false, message: "Use uma imagem JPG, PNG ou WEBP." };
  }

  const extension = String(file.name || "").split(".").pop()?.toLowerCase();
  if (!extension || !allowedExtensions.has(extension)) {
    return { valid: false, message: "A extensão do arquivo não é permitida." };
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { valid: false, message: "O arquivo selecionado está vazio." };
  }

  if (file.size > IMAGE_UPLOAD_MAX_BYTES) {
    return { valid: false, message: "A imagem deve ter no máximo 5 MB." };
  }

  return { valid: true, message: "" };
};

export const buildImageFormData = (
  fields,
  {
    file,
    fileField,
    formData = new FormData(),
    remove = false,
    removeField,
  }
) => {
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    formData.append(field, value === null ? "" : String(value));
  }

  if (file) {
    formData.append(fileField, file);
  } else if (remove && removeField) {
    formData.append(removeField, "true");
  }

  return formData;
};
