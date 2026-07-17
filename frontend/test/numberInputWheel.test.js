import test from "node:test";
import assert from "node:assert/strict";
import {
  bloquearRodaEmInputNumerico,
  registrarBloqueioRodaInputsNumericos,
} from "../src/utils/numberInputWheel.js";

class InputTeste {
  constructor(type) {
    this.type = type;
    this.value = "10";
    this.min = "0";
    this.max = "100";
    this.step = "0.01";
    this.blurChamado = 0;
    this.ownerDocument = {
      defaultView: { HTMLInputElement: InputTeste },
    };
  }

  blur() {
    this.blurChamado += 1;
  }
}

test("roda desfoca input numerico sem alterar valor ou validacoes", () => {
  const input = new InputTeste("number");
  let preventDefaultChamado = 0;

  const bloqueado = bloquearRodaEmInputNumerico({
    target: input,
    preventDefault: () => {
      preventDefaultChamado += 1;
    },
  });

  assert.equal(bloqueado, true);
  assert.equal(input.blurChamado, 1);
  assert.equal(input.value, "10");
  assert.equal(input.min, "0");
  assert.equal(input.max, "100");
  assert.equal(input.step, "0.01");
  assert.equal(preventDefaultChamado, 0);
});

test("campos de texto comuns nao sao afetados", () => {
  const input = new InputTeste("text");

  assert.equal(bloquearRodaEmInputNumerico({ target: input }), false);
  assert.equal(input.blurChamado, 0);
});

test("elementos que nao sao input nao sao afetados", () => {
  const elemento = {
    type: "number",
    blur() {
      throw new Error("Nao deve desfocar");
    },
    ownerDocument: {
      defaultView: { HTMLInputElement: InputTeste },
    },
  };

  assert.equal(bloquearRodaEmInputNumerico({ target: elemento }), false);
});

test("listener global e passivo e possui limpeza correta", () => {
  const chamadas = [];
  const documentTarget = {
    addEventListener(...args) {
      chamadas.push(["add", ...args]);
    },
    removeEventListener(...args) {
      chamadas.push(["remove", ...args]);
    },
  };

  const limpar = registrarBloqueioRodaInputsNumericos(documentTarget);

  assert.deepEqual(chamadas[0], [
    "add",
    "wheel",
    bloquearRodaEmInputNumerico,
    { capture: true, passive: true },
  ]);

  limpar();

  assert.deepEqual(chamadas[1], [
    "remove",
    "wheel",
    bloquearRodaEmInputNumerico,
    true,
  ]);
});
