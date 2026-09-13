export const getOrderItemQuantities = (item = {}, separatedValue = item.quantidadeSeparada) => {
  const requested = Number(item.quantidade ?? item.quantidadeSolicitada ?? 0);
  const hasSeparation = separatedValue !== null && separatedValue !== undefined &&
    separatedValue !== "" && Number.isFinite(Number(separatedValue));
  const separated = hasSeparation ? Number(separatedValue) : null;

  return {
    requested,
    separated,
    // Vazio continua pendente; somente o cálculo considera zero separado.
    missing: requested - (separated ?? 0),
    excess: Math.max((separated ?? 0) - requested, 0),
  };
};
