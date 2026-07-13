import test from "node:test";
import assert from "node:assert/strict";
import { assertMutationAllowed } from "../src/utils/scriptSafety.js";

const withEnvironment = (values, fn) => {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  );

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

test("bloqueia mutacao fora de test ou staging", () => {
  withEnvironment(
    { NODE_ENV: "production", CONFIRM_DATA_MUTATION: undefined },
    () => assert.throws(() => assertMutationAllowed(), /Operacao bloqueada/)
  );
});

test("permite mutacao em test e staging", () => {
  for (const environment of ["test", "staging"]) {
    withEnvironment({ NODE_ENV: environment }, () => {
      assert.doesNotThrow(() => assertMutationAllowed());
    });
  }
});

test("permite confirmacao explicita com variavel nominal", () => {
  withEnvironment(
    { NODE_ENV: "production", CONFIRM_MUTATING_TESTS: "true" },
    () => {
      assert.doesNotThrow(() =>
        assertMutationAllowed({
          confirmationVariable: "CONFIRM_MUTATING_TESTS",
        })
      );
    }
  );
});
