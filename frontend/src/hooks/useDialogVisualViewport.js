import { useEffect } from "react";

// Teclados móveis podem reduzir a visualViewport sem alterar 100dvh.
// As variáveis são usadas somente pelo breakpoint mobile do diálogo.
export function useDialogVisualViewport(dialogRef, open) {
  useEffect(() => {
    if (!open || !window.visualViewport) return undefined;
    const overlay = dialogRef.current?.parentElement;
    if (!overlay) return undefined;
    const viewport = window.visualViewport;
    const update = () => {
      overlay.style.setProperty("--edit-viewport-height", `${viewport.height}px`);
      overlay.style.setProperty("--edit-viewport-top", `${viewport.offsetTop}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      overlay.style.removeProperty("--edit-viewport-height");
      overlay.style.removeProperty("--edit-viewport-top");
    };
  }, [dialogRef, open]);
}
