import multer from "multer";
import { NATAL_2026 } from "../config/natalPremiado2026.js";
import { COMPROVANTE_MIME_TYPES } from "../services/natalComprovanteService.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: NATAL_2026.comprovante.maxBytes,
    files: 1,
    fields: 20,
    fieldSize: 4 * 1024,
    parts: 25,
  },
  fileFilter(req, file, callback) {
    if (!Object.hasOwn(COMPROVANTE_MIME_TYPES, file.mimetype)) {
      const error = new Error("tipo");
      error.code = "TIPO_NAO_PERMITIDO";
      return callback(error);
    }
    return callback(null, true);
  },
});

const MENSAGENS = {
  LIMIT_FILE_SIZE: "O comprovante deve ter no máximo 10 MB.",
  LIMIT_FILE_COUNT: "Envie apenas um comprovante por cadastro.",
  LIMIT_UNEXPECTED_FILE: "Envie apenas um comprovante por cadastro.",
  TIPO_NAO_PERMITIDO: "Envie o comprovante em JPG, PNG, WEBP ou PDF.",
};

// Recebe um único arquivo no campo "comprovante" com mensagens próprias do formulário.
export const receberComprovante = (req, res, next) => {
  upload.single("comprovante")(req, res, (error) => {
    if (!error) return next();
    return res.status(400).json({
      message: MENSAGENS[error.code] || "Não foi possível ler os dados enviados. Tente novamente.",
      errors: { comprovante: MENSAGENS[error.code] || "Arquivo inválido." },
    });
  });
};
