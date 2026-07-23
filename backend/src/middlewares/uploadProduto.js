import multer from "multer";

export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

export const allowedImageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const allowedImageExtensions = new Set(["jpg", "jpeg", "png", "webp"]);

export const hasAllowedImageExtension = (filename = "") => {
  const normalized = String(filename).trim().toLowerCase();
  if (!normalized.includes(".")) return true;
  return allowedImageExtensions.has(normalized.split(".").pop());
};

export const hasImageSignature = (file) => {
  const buffer = file?.buffer;

  if (!buffer || buffer.length < 12) {
    return false;
  }

  if (file.mimetype === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (file.mimetype === "image/png") {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }

  if (file.mimetype === "image/webp") {
    return (
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    );
  }

  return false;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: IMAGE_UPLOAD_MAX_BYTES,
    files: 1,
  },
  fileFilter(req, file, callback) {
    if (
      !allowedImageMimeTypes.has(file.mimetype) ||
      !hasAllowedImageExtension(file.originalname)
    ) {
      return callback(new Error("Tipo de arquivo não permitido"));
    }

    return callback(null, true);
  },
});

export const validarAssinaturaImagem = (req, res, next) => {
  if (!req.file) {
    return next();
  }

  if (
    req.file.size > IMAGE_UPLOAD_MAX_BYTES ||
    req.file.buffer?.length > IMAGE_UPLOAD_MAX_BYTES
  ) {
    return res.status(400).json({
      message: "Arquivo muito grande. Envie uma imagem de até 5MB.",
    });
  }

  if (!hasImageSignature(req.file)) {
    return res.status(400).json({
      message: "Tipo de arquivo não permitido",
    });
  }

  return next();
};

export default upload;
