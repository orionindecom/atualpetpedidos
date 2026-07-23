import cloudinary from "../config/cloudinary.js";

export class ImageUploadError extends Error {
  constructor(message, statusCode = 502, cause = null) {
    super(message);
    this.name = "ImageUploadError";
    this.statusCode = statusCode;
    this.cause = cause;
  }
}

const logCloudinaryFailure = (operation, error) => {
  console.error(`[cloudinary] Falha em ${operation}`, {
    name: error?.name,
    code: error?.http_code || error?.code,
  });
};

export const uploadImageBufferDetails = (
  file,
  {
    errorMessage = "Não foi possível enviar a imagem",
    folder = "atualpet/produtos",
    requirePublicId = false,
  } = {}
) => (
  new Promise((resolve, reject) => {
    if (!file?.buffer || file.buffer.length === 0) {
      return reject(new ImageUploadError("Arquivo de imagem inválido", 400));
    }

    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
      },
      (error, result) => {
        if (error) {
          logCloudinaryFailure("upload", error);
          return reject(
            new ImageUploadError(
              errorMessage,
              502,
              error
            )
          );
        }

        if (!result?.secure_url || (requirePublicId && !result.public_id)) {
          logCloudinaryFailure("validar resposta de upload");
          return reject(
            new ImageUploadError(
              errorMessage,
              502
            )
          );
        }

        return resolve({
          secureUrl: result.secure_url,
          publicId: result.public_id || "",
        });
      }
    );

    stream.on("error", (error) => {
      logCloudinaryFailure("stream de upload", error);
      reject(
        new ImageUploadError(
          errorMessage,
          502,
          error
        )
      );
    });

    stream.end(file.buffer);
  })
);

export const uploadImageBuffer = async (file) => {
  const result = await uploadImageBufferDetails(file, {
    errorMessage: "Não foi possível enviar a imagem do produto",
  });
  return result.secureUrl;
};

export const deleteImageByPublicId = async (
  publicId,
  { allowedFolder, suppressNotFound = true } = {}
) => {
  if (!publicId) return false;

  const normalizedFolder = String(allowedFolder || "").replace(/\/+$/, "");
  if (!normalizedFolder || !String(publicId).startsWith(`${normalizedFolder}/`)) {
    return false;
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      invalidate: true,
      resource_type: "image",
    });

    if (
      result?.result === "ok" ||
      (suppressNotFound && result?.result === "not found")
    ) {
      return true;
    }

    throw new Error("Cloudinary não confirmou a remoção");
  } catch (error) {
    logCloudinaryFailure("remoção", error);
    throw new ImageUploadError("Não foi possível remover a imagem anterior", 502, error);
  }
};
