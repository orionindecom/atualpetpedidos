import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAdminClientForm,
  buildAdminClientPayload,
  formatClientDocument,
  getApprovalStatus,
  getClientDocumentLabel,
  getClientDocumentType,
  getClientTableId,
  isAvailableDistributorTable,
  isClientAccountActive,
} from "../src/utils/clientAdmin.js";

const readSource = (relativePath) => (
  readFileSync(new URL(relativePath, import.meta.url), "utf8")
);

const tableA = "507f1f77bcf86cd799439011";
const tableB = "507f191e810c19729de860ea";
const persistedClient = {
  _id: "cliente-1",
  nomeResponsavel: "Ana Lima",
  razaoSocial: "Pet Comércio Ltda",
  nomeFantasia: "Pet Centro",
  telefone: "1133334444",
  whatsapp: "11999998888",
  email: "ana@example.com",
  cnpj: "12345678000199",
  tabelaPrecoId: { _id: tableA, nome: "Distribuidor A" },
  statusCadastro: "aprovado",
  ativo: true,
};

test("formulário administrativo nasce dos dados persistidos e da tabela populada", () => {
  assert.deepEqual(buildAdminClientForm(persistedClient), {
    nomeResponsavel: "Ana Lima",
    razaoSocial: "Pet Comércio Ltda",
    nomeFantasia: "Pet Centro",
    telefone: "1133334444",
    whatsapp: "11999998888",
    cidade: "",
    estado: "",
    nomeProfissional: "",
    instagram: "",
    tiktok: "",
    observacaoCadastro: "",
    tabelaPrecoId: tableA,
  });
  assert.equal(getClientTableId({ tabelaPrecoId: tableA }), tableA);
  assert.equal(getClientTableId({ tabelaPrecoId: null }), "");
});

test("helpers cadastrais tratam entradas ausentes de forma previsível", () => {
  assert.equal(getClientTableId(null), "");
  assert.equal(getClientTableId(undefined), "");
  assert.deepEqual(buildAdminClientForm(null), {
    nomeResponsavel: "",
    razaoSocial: "",
    nomeFantasia: "",
    telefone: "",
    whatsapp: "",
    cidade: "",
    estado: "",
    nomeProfissional: "",
    instagram: "",
    tiktok: "",
    observacaoCadastro: "",
    tabelaPrecoId: "",
  });
  assert.deepEqual(buildAdminClientPayload(null, null), {});
  assert.deepEqual(buildAdminClientPayload(null, persistedClient), {});
  assert.deepEqual(buildAdminClientPayload(buildAdminClientForm(persistedClient), null), {});
  assert.equal(isAvailableDistributorTable(null), false);
  assert.equal(getApprovalStatus(null), undefined);
});

test("Admin identifica e formata CPF ou CNPJ sem alterar o campo legado", () => {
  assert.equal(getClientDocumentType("52998224725"), "cpf");
  assert.equal(getClientDocumentLabel("52998224725"), "CPF");
  assert.equal(formatClientDocument("52998224725"), "529.982.247-25");
  assert.equal(getClientDocumentType("11222333000181"), "cnpj");
  assert.equal(getClientDocumentLabel("11222333000181"), "CNPJ");
  assert.equal(formatClientDocument("11222333000181"), "11.222.333/0001-81");
  assert.equal(getClientDocumentLabel(null), "CPF/CNPJ");
  assert.equal(formatClientDocument(null), "");
});

test("payload envia apenas campos realmente alterados e nunca dados sensíveis", () => {
  const form = buildAdminClientForm(persistedClient);
  form.nomeFantasia = "  Pet Centro Sul  ";
  form.tabelaPrecoId = tableB;
  form.email = "forjado@example.com";
  form.cnpj = "00000000000000";
  form.senha = "forjada";

  const payload = buildAdminClientPayload(form, persistedClient);
  assert.deepEqual(payload, {
    nomeFantasia: "Pet Centro Sul",
    tabelaPrecoId: tableB,
  });
  assert.equal(Object.hasOwn(payload, "email"), false);
  assert.equal(Object.hasOwn(payload, "cnpj"), false);
  assert.equal(Object.hasOwn(payload, "senha"), false);
});

test("salvar sem mudanças produz payload vazio e trocar texto não reenvia a tabela", () => {
  assert.deepEqual(buildAdminClientPayload(
    buildAdminClientForm(persistedClient),
    persistedClient
  ), {});
  const form = buildAdminClientForm(persistedClient);
  form.telefone = "1144445555";
  assert.deepEqual(buildAdminClientPayload(form, persistedClient), { telefone: "1144445555" });
});

test("cancelar pode reconstruir o formulário e descartar mudanças locais", () => {
  const changed = buildAdminClientForm(persistedClient);
  changed.nomeResponsavel = "Alteração ainda não salva";
  changed.tabelaPrecoId = tableB;

  const restored = buildAdminClientForm(persistedClient);
  assert.equal(restored.nomeResponsavel, "Ana Lima");
  assert.equal(restored.tabelaPrecoId, tableA);
});

test("somente tabelas ativas de distribuidor ficam disponíveis", () => {
  assert.equal(isAvailableDistributorTable({ ativa: true, tipo: "distribuidor" }), true);
  assert.equal(isAvailableDistributorTable({ tipo: "distribuidor" }), true);
  assert.equal(isAvailableDistributorTable({ ativa: false, tipo: "distribuidor" }), false);
  assert.equal(isAvailableDistributorTable({ ativa: true, tipo: "final" }), false);
  assert.equal(isAvailableDistributorTable({ ativa: true }), true);
});

test("conta ausente é inativa sem lançar erro", () => {
  assert.doesNotThrow(() => isClientAccountActive(null));
  assert.doesNotThrow(() => isClientAccountActive(undefined));
  assert.equal(isClientAccountActive(null), false);
  assert.equal(isClientAccountActive(undefined), false);
});

test("flags explícitas de conta preservam sua semântica", () => {
  assert.equal(isClientAccountActive({ statusCadastro: "aprovado", ativo: false }), false);
  assert.equal(isClientAccountActive({ statusCadastro: "aprovado", ativo: true }), true);
});

test("cliente antigo sem ativo continua ativo e status legado inativo continua bloqueado", () => {
  assert.equal(isClientAccountActive({ statusCadastro: "aprovado" }), true);
  assert.equal(isClientAccountActive({ statusCadastro: "inativo", ativo: true }), false);
  assert.equal(getApprovalStatus({ statusCadastro: "inativo" }), "aprovado");
});

test("lista exibe tabela atual e abre detalhe sem select solto nos cartões", () => {
  const page = readSource("../src/pages/AdminClientes/AdminClientes.jsx");
  assert.match(page, /Tabela atual/);
  assert.match(page, /table\?\.nome \|\| "Não definida"/);
  assert.match(page, /Ver cadastro/);
  assert.match(page, /abrirCliente\(cliente\._id\)/);
  assert.match(page, /aria-label="Filtrar clientes por status"/);
  assert.match(page, /aria-label="Filtrar clientes por situação da conta"/);
  assert.match(page, /aria-label="Filtrar clientes por tabela de preços"/);
  assert.match(page, /aria-label="Filtrar cadastros por tipo"/);
  assert.doesNotMatch(page, /tabelasSelecionadas|selecionarTabela/);
});

test("busca e filtros usam a lista carregada sem novas requisições por cliente", () => {
  const page = readSource("../src/pages/AdminClientes/AdminClientes.jsx");
  assert.match(page, /camposTexto\.includes\(termo\)/);
  assert.match(page, /matchesStatus/);
  assert.match(page, /matchesAccount/);
  assert.match(page, /matchesTable/);
  assert.match(page, /getClientTableId\(cliente\) === tabelaFiltro/);
  assert.match(page, /Promise\.all\(\[[\s\S]*?api\.get\("\/clientes"\)[\s\S]*?api\.get\("\/tabelas"\)/);
  assert.doesNotMatch(page, /clientes\.map\([\s\S]*?api\.get/);
});

test("indicadores usam somente os dados disponíveis na listagem", () => {
  const page = readSource("../src/pages/AdminClientes/AdminClientes.jsx");
  assert.match(page, /const indicators = useMemo/);
  assert.match(page, /Total de cadastros/);
  assert.match(page, /Distribuidores/);
  assert.match(page, /Groomers/);
  assert.match(page, /Pendentes/);
});

test("status, acesso, tabela e cadastro aparecem como informação no card", () => {
  const page = readSource("../src/pages/AdminClientes/AdminClientes.jsx");
  assert.match(page, /data-status=\{getApprovalStatus\(cliente\)\}/);
  assert.match(page, /data-active=\{accountActive\}/);
  assert.match(page, /table\?\.nome \|\| "Não definida"/);
  assert.match(page, /formatDate\(cliente\.createdAt\)/);
});

test("detalhe começa em visualização e oferece Editar, Salvar e Cancelar", () => {
  const page = readSource("../src/pages/AdminClientes/AdminClientes.jsx");
  const detail = readSource("../src/components/ClientDetails/ClientDetailModal.jsx");
  assert.match(page, /useState\(false\).*editing|\[editing, setEditing\] = useState\(false\)/);
  assert.match(detail, /!editing &&/);
  assert.match(detail, />\s*Editar\s*</);
  assert.match(detail, />\s*Cancelar\s*</);
  assert.match(detail, /Salvar alterações/);
  assert.match(detail, /onSubmit=\{onSubmit\}/);
});

test("detalhe suporta client nulo durante carregamento e falha sem acessar seus campos", () => {
  const detail = readSource("../src/components/ClientDetails/ClientDetailModal.jsx");
  assert.match(detail, /const hasClient = Boolean\(client && typeof client === "object"\)/);
  assert.match(detail, /const accountActive = hasClient \? isClientAccountActive\(client\) : false/);
  assert.match(detail, /\{loading && <p[^>]*>Carregando dados do cadastro/);
  assert.match(detail, /\{!loading && !hasClient && \(/);
  assert.match(detail, /\{!loading && hasClient && \(/);
});

test("detalhe válido continua renderizando consulta, edição e tabela", () => {
  const detail = readSource("../src/components/ClientDetails/ClientDetailModal.jsx");
  assert.match(detail, /client\.nomeResponsavel/);
  assert.match(detail, /safeForm\.nomeResponsavel/);
  assert.match(detail, /safeForm\.tabelaPrecoId/);
  assert.match(detail, /Tabela atual/);
  assert.match(detail, /onFieldChange/);
});

test("fechamento invalida carregamento pendente e desmonta o modal", () => {
  const page = readSource("../src/pages/AdminClientes/AdminClientes.jsx");
  assert.match(page, /const detailRequestRef = useRef\(0\)/);
  assert.match(page, /detailRequestRef\.current \+= 1;[\s\S]*?setSelectedClientId\(""\)/);
  assert.match(page, /setClientDetail\(null\)/);
  assert.match(page, /\{selectedClientId && \([\s\S]*?<ClientDetailModal/);
  assert.match(page, /if \(requestId !== detailRequestRef\.current\) return/);
});

test("edição oferece campos de Distribuidor e Groomer e mantém identificadores somente leitura", () => {
  const detail = readSource("../src/components/ClientDetails/ClientDetailModal.jsx");
  for (const field of [
    "nomeResponsavel",
    "razaoSocial",
    "nomeFantasia",
    "telefone",
    "whatsapp",
    "tabelaPrecoId",
  ]) {
    assert.match(detail, new RegExp(`name="${field}"`));
  }
  for (const field of ["nomeProfissional", "cidade", "estado", "instagram", "tiktok"]) {
    assert.match(detail, new RegExp(`name="${field}"`));
  }
  assert.match(detail, /const formattedDocument = hasClient \? formatClientDocument\(client\.cnpj\) : ""/);
  assert.match(detail, /value=\{formattedDocument\} readOnly/);
  assert.match(detail, /\{documentLabel\}/);
  assert.match(detail, /value=\{client\.email \|\| ""\} readOnly/);
  assert.doesNotMatch(detail, /endereco|name="senha"/i);
});

test("tela usa GET de detalhe e PATCH real, confirmando sucesso só após a resposta", () => {
  const page = readSource("../src/pages/AdminClientes/AdminClientes.jsx");
  assert.match(page, /await api\.get\(`\/clientes\/\$\{clientId\}`\)/);
  assert.match(page, /await api\.patch\(`\/clientes\/\$\{selectedClientId\}`, payload\)/);
  assert.match(page, /atualizarClienteLocal\(response\.data\.cliente\)/);
  assert.match(page, /setFeedback\(\{ type: "success", message: response\.data\.message \}\)/);
  assert.match(page, /getErrorMessage\(error, "Erro ao salvar cliente\."\)/);
});

test("aprovação usa a tabela já persistida e exige salvá-la antes", () => {
  const page = readSource("../src/pages/AdminClientes/AdminClientes.jsx");
  assert.match(page, /const tabelaPrecoId = getClientTableId\(clientDetail\)/);
  assert.match(page, /Selecione e salve uma tabela de preços antes de aprovar/);
  assert.match(page, /isGroomer \? \{\} : \{ tabelaPrecoId \}/);
  assert.match(page, /!isGroomer && !tabelaPrecoId/);
});

test("ativar, desativar e redefinir senha permanecem ações separadas da edição", () => {
  const page = readSource("../src/pages/AdminClientes/AdminClientes.jsx");
  const detail = readSource("../src/components/ClientDetails/ClientDetailModal.jsx");
  assert.match(page, /const action = active \? "desativar" : "reativar"/);
  assert.match(page, /`\/clientes\/\$\{selectedClientId\}\/\$\{action\}`/);
  assert.match(page, /\/redefinir-senha/);
  assert.match(detail, /Aprovação cadastral e acesso ao sistema são controles independentes/);
  assert.match(detail, /Desativar acesso/);
  assert.match(detail, /Reativar acesso/);
});

test("rota e interface restringem a gestão de clientes ao Admin", () => {
  const app = readSource("../src/App.jsx");
  assert.match(app, /path="\/clientes"[\s\S]*?<RoleRoute role="admin">/);
  const detail = readSource("../src/components/ClientDetails/ClientDetailModal.jsx");
  assert.match(detail, /role="dialog"/);
  assert.match(detail, /aria-modal="true"/);
});

test("detalhe e cartões possuem adaptação explícita para telas menores", () => {
  const modalCss = readSource("../src/components/ClientDetails/ClientDetailModal.module.css");
  const pageCss = readSource("../src/pages/AdminClientes/AdminClientes.module.css");
  assert.match(modalCss, /@media \(max-width: 760px\)/);
  assert.match(modalCss, /max-height: calc\(100dvh - 16px\)/);
  assert.match(modalCss, /overscroll-behavior: contain/);
  assert.match(modalCss, /grid-template-columns: 1fr/);
  assert.match(pageCss, /@media \(max-width: 980px\)/);
  assert.match(pageCss, /overflow-x: hidden/);
  assert.match(pageCss, /flex-direction: column/);
});

test("clientes e pedidos compartilham tokens, cards, badges e estrutura de modal", () => {
  const clientPageCss = readSource("../src/pages/AdminClientes/AdminClientes.module.css");
  const orderPageCss = readSource("../src/pages/AdminPedidos/AdminPedidos.module.css");
  const clientModalCss = readSource("../src/components/ClientDetails/ClientDetailModal.module.css");
  const orderModalCss = readSource("../src/components/OrderDetails/OrderDetails.module.css");
  for (const pattern of [/border-radius: 18px/, /box-shadow: 0 10px 24px/, /#174e4b/]) {
    assert.match(clientPageCss, pattern);
    assert.match(orderPageCss, pattern);
  }
  for (const pattern of [/max-height: calc\(100dvh - 48px\)/, /border-radius: 10px/, /var\(--surface-primary\)/]) {
    assert.match(clientModalCss, pattern);
    assert.match(orderModalCss, pattern);
  }
});
