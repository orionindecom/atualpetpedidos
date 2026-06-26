import cloudinary from "../config/cloudinary.js";

export const uploadImageBuffer = (file) => (
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "atualpet/produtos",
        resource_type: "image",
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }

        return resolve(result.secure_url);
      }
    );

    stream.end(file.buffer);
  })
);

