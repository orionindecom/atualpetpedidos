import multer from "multer";
import path from "path";

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, "src/uploads/produtos");
  },

  filename(req, file, cb) {
    const extensao = path.extname(file.originalname);

    cb(
      null,
      `${Date.now()}${extensao}`
    );
  },
});

const upload = multer({
  storage,
});

export default upload;