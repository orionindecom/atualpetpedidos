const obterConstrutorInput = (target) =>
  target?.ownerDocument?.defaultView?.HTMLInputElement ||
  globalThis.HTMLInputElement;

export const bloquearRodaEmInputNumerico = (event) => {
  const target = event.target;
  const InputElement = obterConstrutorInput(target);

  if (
    typeof InputElement !== "function" ||
    !(target instanceof InputElement) ||
    target.type !== "number"
  ) {
    return false;
  }

  target.blur();
  return true;
};

export const registrarBloqueioRodaInputsNumericos = (
  documentTarget = globalThis.document
) => {
  if (!documentTarget?.addEventListener) {
    return () => {};
  }

  documentTarget.addEventListener("wheel", bloquearRodaEmInputNumerico, {
    capture: true,
    passive: true,
  });

  return () => {
    documentTarget.removeEventListener(
      "wheel",
      bloquearRodaEmInputNumerico,
      true
    );
  };
};
