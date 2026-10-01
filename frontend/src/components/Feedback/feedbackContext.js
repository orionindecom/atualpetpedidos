import { createContext, useContext } from "react";

export const FeedbackContext = createContext(null);

// Acesso ao sistema de feedback: dialog.confirm/alert e toast.success/error/warning/info.
export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error("useFeedback precisa estar dentro de FeedbackProvider");
  return context;
}
