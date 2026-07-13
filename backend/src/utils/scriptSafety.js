const MUTATION_ENVIRONMENTS = new Set(["test", "staging"]);

export const assertMutationAllowed = ({
  action = "alterar dados",
  confirmationVariable = "CONFIRM_DATA_MUTATION",
} = {}) => {
  const environment = (process.env.NODE_ENV || "").trim().toLowerCase();
  const explicitlyConfirmed = process.env[confirmationVariable] === "true";

  if (MUTATION_ENVIRONMENTS.has(environment) || explicitlyConfirmed) {
    return;
  }

  throw new Error(
    `Operacao bloqueada: ${action} exige NODE_ENV=test/staging ou ` +
      `${confirmationVariable}=true.`
  );
};
