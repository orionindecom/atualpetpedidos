import test from "node:test";
import assert from "node:assert/strict";
import { planejarPreparacaoTabelas } from "../src/scripts/prepararTabelasDistribuidor.js";

const tabelasBase = () => [
  {
    _id: "6a30776bb1e48bd024a5db13",
    nome: "Distribuidor 2026",
    ativa: true,
  },
  {
    _id: "6a30777eb1e48bd024a5db14",
    nome: "Atacado 2026",
    ativa: true,
  },
  {
    _id: "6a4c21eeb31af597d4213701",
    nome: "Cliente Final - Internet",
    tipo: "cliente_final_internet",
    ativa: true,
  },
];

test("planeja somente tipo do Distribuidor e criacao de Cliente Final Loja", () => {
  const plano = planejarPreparacaoTabelas(tabelasBase());

  assert.deepEqual(plano.acoes, [
    {
      acao: "definir_tipo",
      tabelaId: "6a30776bb1e48bd024a5db13",
      nome: "Distribuidor 2026",
      tipo: "distribuidor",
    },
    {
      acao: "criar_cliente_final_loja",
      dados: {
        nome: "Cliente Final - Loja Física",
        descricao:
          "Tabela de preços sugeridos para venda ao cliente final em loja física",
        tipo: "cliente_final_loja",
        ativa: true,
      },
    },
  ]);
  assert.equal(plano.atacado.nome, "Atacado 2026");
});

test("reutiliza candidata unica de Loja e planeja somente seu tipo ausente", () => {
  const tabelas = tabelasBase();
  tabelas.push({
    _id: "6a5000000000000000000001",
    nome: "Cliente Final Loja Física",
    ativa: true,
  });

  const plano = planejarPreparacaoTabelas(tabelas);

  assert.equal(plano.clienteFinalLoja.nome, "Cliente Final Loja Física");
  assert.equal(
    plano.acoes.filter((acao) => acao.acao === "criar_cliente_final_loja").length,
    0
  );
  assert.equal(
    plano.acoes.some(
      (acao) =>
        acao.tabelaId === "6a5000000000000000000001" &&
        acao.tipo === "cliente_final_loja"
    ),
    true
  );
});

test("nunca considera Atacado como candidata a Cliente Final Loja", () => {
  const plano = planejarPreparacaoTabelas(tabelasBase());

  assert.notEqual(plano.clienteFinalLoja?._id, "6a30777eb1e48bd024a5db14");
  assert.equal(
    plano.acoes.some(
      (acao) => acao.tabelaId === "6a30777eb1e48bd024a5db14"
    ),
    false
  );

  const atacadoComTipoIncorreto = tabelasBase();
  atacadoComTipoIncorreto[1].tipo = "cliente_final_loja";
  assert.throws(
    () => planejarPreparacaoTabelas(atacadoComTipoIncorreto),
    /nao pode ser reutilizada/
  );
});

test("interrompe em conflitos de nome, tipo e duplicidade", () => {
  const nomeInvalido = tabelasBase();
  nomeInvalido[0].nome = "Outro nome";
  assert.throws(
    () => planejarPreparacaoTabelas(nomeInvalido),
    /Nome incompatível/
  );

  const distribuidorDuplicado = tabelasBase();
  distribuidorDuplicado.push({
    _id: "6a5000000000000000000002",
    nome: "Outro Distribuidor",
    tipo: "distribuidor",
    ativa: true,
  });
  assert.throws(
    () => planejarPreparacaoTabelas(distribuidorDuplicado),
    /outra tabela com tipo distribuidor/
  );

  const lojasDuplicadas = tabelasBase();
  lojasDuplicadas.push(
    {
      _id: "6a5000000000000000000003",
      nome: "Cliente Final Loja",
      ativa: true,
    },
    {
      _id: "6a5000000000000000000004",
      nome: "Loja Física",
      ativa: true,
    }
  );
  assert.throws(
    () => planejarPreparacaoTabelas(lojasDuplicadas),
    /Mais de uma candidata/
  );
});
