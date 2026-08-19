import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAdminClientForm,
  buildAdminClientPayload,
  getClientAccountTypeLabel,
  getClientDisplayName,
  isGroomerAccount,
} from "../src/utils/clientAdmin.js";
import {
  formatRegistrationDocument,
  validateGroomerRegistrationForm,
} from "../src/utils/registrationValidation.js";

const readSource = (relativePath) => readFileSync(
  new URL(relativePath, import.meta.url),
  "utf8"
);

const groomer = {
  _id: "groomer-1",
  tipo: "groomer",
  nomeResponsavel: "Marina Souza",
  nomeProfissional: "Marina Grooming",
  whatsapp: "11987654321",
  cidade: "São Paulo",
  estado: "SP",
  instagram: "@marina",
  tiktok: "@marina",
  observacaoCadastro: "Atendimento especializado",
  statusCadastro: "pendente",
};

test("formulário Groomer aplica obrigatórios, máscara compartilhada e documento opcional", () => {
  const valid = {
    ...groomer,
    email: "marina@example.com",
    cnpj: "",
    senha: "senha-segura",
    confirmarSenha: "senha-segura",
  };
  assert.deepEqual(validateGroomerRegistrationForm(valid), {});
  assert.equal(formatRegistrationDocument("52998224725"), "529.982.247-25");

  const invalid = validateGroomerRegistrationForm({
    ...valid,
    whatsapp: "",
    cidade: "",
    estado: "",
  });
  assert.ok(invalid.whatsapp);
  assert.ok(invalid.cidade);
  assert.ok(invalid.estado);
});

test("rota pública Groomer é direta e envia ao endpoint próprio", () => {
  const app = readSource("../src/App.jsx");
  const page = readSource("../src/pages/CadastroGroomer/CadastroGroomer.jsx");
  const navbar = readSource("../src/components/Navbar/Navbar.jsx");
  assert.match(app, /path="\/cadastro-groomer" element=\{<CadastroGroomer \/>\}/);
  assert.match(page, /api\.post\("\/auth\/cadastro-groomer", form\)/);
  assert.match(page, /CPF ou CNPJ/);
  assert.match(page, /WhatsApp \*/);
  assert.doesNotMatch(navbar, /cadastro-groomer/);
});

test("área Groomer possui somente início, treinamentos e materiais", () => {
  const app = readSource("../src/App.jsx");
  const navbar = readSource("../src/components/Navbar/Navbar.jsx");
  const guards = readSource("../src/components/RouteGuards/RouteGuards.jsx");
  assert.match(app, /path="\/groomer"[\s\S]*?<RoleRoute role="groomer">/);
  assert.match(guards, /groomer: "\/groomer"/);
  assert.match(navbar, /const groomerLinks = \[[\s\S]*?\/groomer[\s\S]*?\/treinamentos[\s\S]*?\/materiais-marketing[\s\S]*?\];/);
  const groomerLinksBlock = navbar.match(/const groomerLinks = \[([\s\S]*?)\];/)?.[1] || "";
  assert.doesNotMatch(groomerLinksBlock, /catalogo|pedidos|precos|clientes|logistica|admin/);
});

test("rotas comerciais permanecem exclusivas de cliente e conteúdos aceitam Groomer", () => {
  const app = readSource("../src/App.jsx");
  for (const path of ["catalogo", "meus-pedidos", "precos-cliente-final"]) {
    assert.match(app, new RegExp(`path="/${path}"[\\s\\S]*?<RoleRoute role="cliente">`));
  }
  for (const path of ["materiais-marketing", "treinamentos"]) {
    assert.match(app, new RegExp(`path="/${path}"[\\s\\S]*?<RoleRoute roles=\\{\\["cliente", "groomer"\\]\\}>`));
  }
});

test("Admin diferencia Groomer, não envia tabela e permite editar dados profissionais", () => {
  assert.equal(isGroomerAccount(groomer), true);
  assert.equal(getClientAccountTypeLabel(groomer), "Groomer");
  assert.equal(getClientDisplayName(groomer), "Marina Grooming");

  const form = buildAdminClientForm(groomer);
  assert.equal(form.cidade, "São Paulo");
  assert.equal(form.tabelaPrecoId, "");
  form.cidade = "Campinas";
  form.tabelaPrecoId = "tabela-forjada";
  assert.deepEqual(buildAdminClientPayload(form, groomer), { cidade: "Campinas" });

  const page = readSource("../src/pages/AdminClientes/AdminClientes.jsx");
  const modal = readSource("../src/components/ClientDetails/ClientDetailModal.jsx");
  assert.match(page, /Filtrar cadastros por tipo/);
  assert.match(page, /getClientAccountTypeLabel\(cliente\)/);
  assert.match(modal, /!groomer && <label>[\s\S]*?Tabela de preços/);
  assert.match(modal, /name="nomeProfissional"/);
  assert.match(modal, /name="cidade"/);
  assert.match(modal, /onReject/);
});

test("materiais e treinamentos enviam públicos e preservam fallback de distribuidor", () => {
  const selector = readSource("../src/components/AudienceSelector/AudienceSelector.jsx");
  const materials = readSource("../src/pages/AdminMateriaisMarketing/AdminMateriaisMarketing.jsx");
  const trainings = readSource("../src/pages/AdminTreinamentos/AdminTreinamentos.jsx");
  const trainingUtils = readSource("../src/utils/training.js");
  assert.match(selector, /Distribuidores/);
  assert.match(selector, /Groomers/);
  assert.match(materials, /publicos: JSON\.stringify\(form\.publicos\)/);
  assert.match(trainings, /buildTrainingAudiencePayload\(form\)/);
  assert.match(trainingUtils, /publicos: JSON\.stringify\(form\.publicos\)/);
  assert.match(materials, /: \["cliente"\]/);
  assert.match(trainings, /: \["cliente"\]/);
});

test("Marketing gerencia também as audiências de treinamento", () => {
  const app = readSource("../src/App.jsx");
  const navbar = readSource("../src/components/Navbar/Navbar.jsx");
  const trainingAdmin = readSource("../src/pages/AdminTreinamentos/AdminTreinamentos.jsx");
  assert.match(app, /path="\/marketing\/treinamentos"[\s\S]*?apiBase="\/marketing\/treinamentos"/);
  assert.match(navbar, /\/marketing\/treinamentos/);
  assert.match(trainingAdmin, /apiBase = "\/admin\/treinamentos"/);
});

test("cadastro e home Groomer mantêm layout responsivo", () => {
  const registrationCss = readSource("../src/pages/Cadastro/Cadastro.module.css");
  const homeCss = readSource("../src/pages/GroomerHome/GroomerHome.module.css");
  assert.match(registrationCss, /@media \(max-width: 768px\)/);
  assert.match(registrationCss, /\.grid select/);
  assert.match(homeCss, /@media \(max-width: 760px\)/);
  assert.match(homeCss, /grid-template-columns: 1fr/);
});
