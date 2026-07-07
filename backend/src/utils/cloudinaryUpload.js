import cloudinary from "../config/cloudinary.js";

export class ImageUploadError extends Error {
  constructor(message, statusCode = 502, cause = null) {
    super(message);
    this.name = "ImageUploadError";
    this.statusCode = statusCode;
    this.cause = cause;
  }
}

export const uploadImageBuffer = (file) => (
  new Promise((resolve, reject) => {
    if (!file?.buffer || file.buffer.length === 0) {
      return reject(new ImageUploadError("Arquivo de imagem inválido", 400));
    }

    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "atualpet/produtos",
        resource_type: "image",
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
      },
      (error, result) => {
        if (error) {
          console.error("Erro ao enviar imagem para o Cloudinary", error);
          return reject(
            new ImageUploadError(
              "Não foi possível enviar a imagem do produto",
              502,
              error
            )
          );
        }

        if (!result?.secure_url) {
          console.error("Cloudinary não retornou secure_url", result);
          return reject(
            new ImageUploadError(
              "Não foi possível enviar a imagem do produto",
              502
            )
          );
        }

        return resolve(result.secure_url);
      }
    );

    stream.on("error", (error) => {
      console.error("Erro no stream de upload para o Cloudinary", error);
      reject(
        new ImageUploadError(
          "Não foi possível enviar a imagem do produto",
          502,
          error
        )
      );
    });

    stream.end(file.buffer);
  })
);
