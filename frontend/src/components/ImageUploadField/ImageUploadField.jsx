import { useEffect, useId, useRef, useState } from "react";
import {
  IMAGE_UPLOAD_ACCEPT,
  validateImageFile,
} from "../../utils/imageUpload";
import styles from "./ImageUploadField.module.css";

function ImageUploadField({
  currentUrl = "",
  error = "",
  fallbackUrl = "",
  file,
  label,
  name,
  onFileChange,
  onRemoveChange,
  removed = false,
}) {
  const generatedId = useId().replaceAll(":", "");
  const inputId = `${name}-${generatedId}`;
  const [localError, setLocalError] = useState("");
  const [objectUrl, setObjectUrl] = useState("");
  const [failedUrls, setFailedUrls] = useState(new Set());
  const objectUrlRef = useRef("");

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const previewCandidates = [
    objectUrl,
    !removed && currentUrl,
    fallbackUrl,
  ].filter(Boolean);
  const previewUrl = previewCandidates.find((url) => !failedUrls.has(url)) || "";

  const selectFile = (event) => {
    const nextFile = event.target.files?.[0];
    const validation = validateImageFile(nextFile);

    if (!validation.valid) {
      setLocalError(validation.message);
      event.target.value = "";
      return;
    }

    setLocalError("");
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(nextFile);
    setObjectUrl(objectUrlRef.current);
    onFileChange(nextFile);
    onRemoveChange(false);
  };

  const remove = () => {
    setLocalError("");
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = "";
    setObjectUrl("");
    onFileChange(null);
    onRemoveChange(Boolean(currentUrl));
  };

  const hasCustomImage = Boolean(file || (!removed && currentUrl));

  return (
    <div className={styles.field}>
      <div className={styles.heading}>
        <div>
          <label htmlFor={inputId}>{label}</label>
          <p>JPG, PNG ou WEBP. Máximo de 5 MB.</p>
        </div>
        <div className={styles.actions}>
          <label className={styles.selectButton} htmlFor={inputId}>
            {hasCustomImage ? "Trocar imagem" : "Selecionar imagem"}
          </label>
          {hasCustomImage && (
            <button type="button" className={styles.removeButton} onClick={remove}>
              Remover
            </button>
          )}
        </div>
      </div>

      <input
        id={inputId}
        className={styles.fileInput}
        name={name}
        type="file"
        accept={IMAGE_UPLOAD_ACCEPT}
        onChange={selectFile}
      />

      <div className={styles.preview}>
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Prévia da imagem selecionada"
            onError={() => setFailedUrls((current) => new Set(current).add(previewUrl))}
          />
        ) : (
          <span>Prévia institucional indisponível</span>
        )}
      </div>

      {(localError || error) && (
        <small className={styles.error} role="alert">
          {localError || error}
        </small>
      )}
    </div>
  );
}

export default ImageUploadField;
