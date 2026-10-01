import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSingleFlight,
  createToast,
  normalizeDialogOptions,
  pushToast,
  runDialogAction,
  TOAST_DURATIONS,
  TOAST_LIMIT,
  validateDialogField,
} from "../src/components/Feedback/feedbackCore.js";
import {
  GROOMER_REGISTRATION_SENT_DIALOG,
  REGISTRATION_SENT_DIALOG,
} from "../src/utils/accessFeedback.js";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const provider = readSource("../src/components/Feedback/FeedbackProvider.jsx");
const dialogComponent = readSource("../src/components/Feedback/FeedbackDialog.jsx");

const listSourceFiles = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? listSourceFiles(full) : /\.(jsx?|mjs)$/.test(name) ? [full] : [];
});
const srcDir = fileURLToPath(new URL("../src", import.meta.url));

test("abrir diálogo: confirmações têm Cancelar e avisos têm uma única ação", () => {
  const confirm = normalizeDialogOptions("confirm", { title: "Excluir?" });
  assert.equal(confirm.variant, "confirm");
  assert.equal(confirm.cancelLabel, "Cancelar");
  assert.equal(confirm.confirmLabel, "Confirmar");
  const alert = normalizeDialogOptions("alert", { title: "Cadastro enviado!" });
  assert.equal(alert.cancelLabel, null);
  assert.equal(alert.confirmLabel, "Entendi");
  assert.match(provider, /confirm: \(options\) => openDialog\("confirm", options\)/);
  assert.match(provider, /alert: \(options\) => openDialog\("alert", options\)/);
  assert.match(dialogComponent, /createPortal/);
});

test("fechar e cancelar resolvem como não confirmado e ficam bloqueados durante a requisição", () => {
  assert.match(provider, /const handleCancel = useCallback\(\(\) => \{\s*if \(flight\.running\) return;\s*finish\(false\);/);
  assert.match(dialogComponent, /closeDisabled: busy \|\| !dismissible/);
  assert.match(dialogComponent, /if \(event\.target === event\.currentTarget && dismissible && !busy\) close\?\.\(\);/);
  assert.equal(normalizeDialogOptions("alert", { dismissible: false }).dismissible, false);
});

test("confirmar sem ação conclui imediatamente", async () => {
  assert.deepEqual(await runDialogAction(normalizeDialogOptions("confirm", {})), { status: "done" });
});

test("loading: a ação só termina com a resposta e o diálogo mostra o texto de carregamento", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const options = normalizeDialogOptions("confirm", { action: () => pending, busyLabel: "Confirmando recebimento..." });
  let settled = false;
  const run = runDialogAction(options).then((outcome) => { settled = true; return outcome; });
  await Promise.resolve();
  assert.equal(settled, false, "o diálogo não fecha antes da resposta");
  release();
  assert.equal((await run).status, "done");
  assert.match(dialogComponent, /\{busy \? \(busyLabel \|\| "Aguarde\.\.\."\) : confirmLabel\}/);
  assert.match(dialogComponent, /disabled=\{busy\}/);
  assert.match(provider, /phase: "busy"/);
});

test("erro mantém o diálogo aberto com mensagem segura", async () => {
  const conflict = await runDialogAction(normalizeDialogOptions("confirm", {
    action: async () => { throw { response: { status: 409, data: { message: "Este pedido não está mais aguardando recebimento." } } }; },
  }));
  assert.deepEqual(conflict, { status: "error", message: "Este pedido não está mais aguardando recebimento." });
  const crash = await runDialogAction(normalizeDialogOptions("confirm", {
    errorFallback: "Não foi possível excluir o pedido.",
    action: async () => { throw { response: { status: 500, data: { message: "TypeError: x is undefined at /src" } } }; },
  }));
  assert.equal(crash.message, "Ocorreu um erro no servidor. Tente novamente em instantes.", "mensagem técnica não chega ao usuário");
  assert.match(provider, /phase: "idle", error: outcome\.message/);
  assert.match(dialogComponent, /\{error && <p className=\{styles\.error\} role="alert">\{error\}<\/p>\}/);
});

test("sucesso pode transformar o diálogo ou virar toast", async () => {
  const inPlace = await runDialogAction(normalizeDialogOptions("confirm", {
    action: async () => ({ numero: "PED-1" }),
    success: (result) => ({ title: "Recebimento confirmado!", message: result.numero }),
  }));
  assert.deepEqual(inPlace, { status: "success", view: { title: "Recebimento confirmado!", message: "PED-1" } });
  const toToast = await runDialogAction(normalizeDialogOptions("confirm", {
    action: async () => ({ message: "Banner excluído" }),
    successToast: (data) => ({ title: data.message }),
  }));
  assert.deepEqual(toToast, { status: "done", toast: { title: "Banner excluído" } });
  assert.match(provider, /phase: "success", view: outcome\.view/);
  assert.match(provider, /confirmLabel=\{view\.confirmLabel \|\| "Concluir"\}/);
});

test("toast tem variantes, tempo de leitura, limite e anúncio acessível", () => {
  const toast = createToast("error", "Não foi possível abrir o PDF", { description: "Tente novamente." }, 1);
  assert.deepEqual(toast, { id: 1, variant: "error", title: "Não foi possível abrir o PDF", description: "Tente novamente.", duration: TOAST_DURATIONS.error });
  assert.ok(TOAST_DURATIONS.error > TOAST_DURATIONS.success, "erro permanece mais tempo");
  assert.equal(createToast("desconhecido", "x", {}, 2).variant, "info");
  let list = [];
  for (let index = 0; index < 6; index += 1) list = pushToast(list, createToast("success", `t${index}`, {}, index));
  assert.equal(list.length, TOAST_LIMIT);
  assert.equal(list.at(-1).title, "t5");
  assert.match(provider, /aria-live="polite"/);
  assert.match(provider, /role=\{toast\.variant === "error" \? "alert" : undefined\}/);
  assert.match(provider, /onMouseEnter=\{\(\) => setPaused\(true\)\}/, "pausa ao passar o mouse");
  assert.match(provider, /onFocus=\{\(\) => setPaused\(true\)\}/, "pausa ao receber foco");
  assert.match(provider, /aria-label="Fechar notificação"/);
  const css = readSource("../src/components/Feedback/Toast.module.css");
  assert.match(css, /pointer-events: none/, "região não bloqueia a página");
  assert.match(css, /prefers-reduced-motion/);
});

test("confirmação de recebimento usa o diálogo próprio com ícone de pacote e sucesso no mesmo popup", () => {
  const page = readSource("../src/pages/MeusPedidos/MeusPedidos.jsx");
  assert.doesNotMatch(page, /window\.(alert|confirm)|\balert\(/);
  assert.match(page, /icon: "package"/);
  assert.match(page, /title: "Você recebeu seu pedido\?"/);
  assert.match(page, /details: \[\{ label: "Pedido", value: pedido\.numeroPedido \}\]/);
  assert.match(page, /confirmLabel: "Confirmar recebimento"/);
  assert.match(page, /busyLabel: "Confirmando recebimento\.\.\."/);
  assert.match(page, /api\.patch\(`\/pedidos\/\$\{pedido\._id\}\/confirmar-recebimento`\)/);
  assert.match(page, /icon: "packageCheck",\s*title: "Recebimento confirmado!"/);
  assert.match(page, /confirmLabel: "Concluir"/);
});

test("cadastro enviado mostra sucesso e só então segue para o login", () => {
  assert.equal(REGISTRATION_SENT_DIALOG.variant, "success");
  assert.equal(REGISTRATION_SENT_DIALOG.icon, "userCheck");
  assert.equal(REGISTRATION_SENT_DIALOG.title, "Cadastro enviado!");
  assert.equal(GROOMER_REGISTRATION_SENT_DIALOG.title, "Cadastro enviado!");
  assert.doesNotMatch(REGISTRATION_SENT_DIALOG.message, /avisaremos|e-mail/i, "não promete notificação que o backend não faz");
  assert.match(readSource("../src/pages/CadastroGroomer/CadastroGroomer.jsx"), /await dialog\.alert\(GROOMER_REGISTRATION_SENT_DIALOG\);\s*navigate\("\/login"\)/);
});

test("exclusões usam variante destrutiva com ação descrita e requisição dentro do diálogo", () => {
  const cases = [
    ["../src/pages/AdminPedidos/AdminPedidos.jsx", "Excluir pedido"],
    ["../src/pages/AdminTreinamentos/AdminTreinamentos.jsx", "Excluir treinamento"],
    ["../src/pages/AdminBanners/AdminBanners.jsx", "Excluir banner"],
    ["../src/pages/AdminMateriaisMarketing/AdminMateriaisMarketing.jsx", "Excluir material"],
  ];
  for (const [file, label] of cases) {
    const source = readSource(file);
    assert.match(source, /variant: "danger",\s*icon: "trash"/, file);
    assert.match(source, new RegExp(`confirmLabel: "${label}"`), file);
    assert.match(source, /action: /, file);
  }
  const css = readSource("../src/components/Feedback/FeedbackDialog.module.css");
  assert.match(css, /\.dangerButton \{[\s\S]*background: var\(--danger\)/, "só o botão destrutivo recebe o vermelho cheio");
  assert.match(css, /\.dialog \{[\s\S]*background: var\(--surface-primary\)/);
});

test("descarte de alterações usa o mesmo diálogo com ícone de edição", () => {
  const wrapper = readSource("../src/components/ConfirmDialog/ConfirmDialog.jsx");
  assert.match(wrapper, /<FeedbackDialog/);
  for (const file of ["../src/components/UserForm/UserFormModal.jsx", "../src/components/ClientDetails/ClientDetailModal.jsx", "../src/components/UserForm/PortfolioModal.jsx"]) {
    assert.match(readSource(file), /icon="edit"\s*title="Descartar alterações\?"/, file);
  }
});

test("foco: decisões começam em Cancelar, sucesso foca a ação e campos recebem o foco", () => {
  assert.match(dialogComponent, /initialFocusRef: focusContent \? undefined : hasCancel \? cancelRef : confirmRef/);
  assert.match(dialogComponent, /confirmRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(dialogComponent, /role=\{ALERT_VARIANTS\.has\(variant\) \? "alertdialog" : "dialog"\}/);
  assert.match(dialogComponent, /aria-labelledby=\{`\$\{id\}-title`\}/);
  assert.match(dialogComponent, /aria-describedby=\{`\$\{id\}-message`\}/);
  assert.match(provider, /if \(error && options\.field\) inputRef\.current\?\.focus\(\);/);
  const hook = readSource("../src/hooks/useModalDialog.js");
  assert.match(hook, /previouslyFocused\.focus/, "foco volta ao elemento de origem");
  assert.match(hook, /alertdialog/);
});

test("cliques repetidos não disparam requisições duplicadas", async () => {
  const flight = createSingleFlight();
  let calls = 0;
  let release;
  const task = () => { calls += 1; return new Promise((resolve) => { release = resolve; }); };
  const first = flight.run(task);
  const second = await flight.run(task);
  assert.deepEqual(second, { skipped: true });
  assert.equal(flight.running, true);
  release("ok");
  assert.deepEqual(await first, { skipped: false, value: "ok" });
  assert.equal(calls, 1);
  assert.equal(flight.running, false);
});

test("campo do diálogo valida antes de chamar a API", () => {
  const field = { label: "Nova senha", minLength: 8, requiredMessage: "Informe a nova senha." };
  assert.equal(validateDialogField(field, ""), "Informe a nova senha.");
  assert.equal(validateDialogField(field, "123"), "Use pelo menos 8 caracteres.");
  assert.equal(validateDialogField(field, "SenhaForte1"), "");
  assert.equal(validateDialogField(null, ""), "");
});

test("nenhum alert, confirm ou prompt nativo nos fluxos da Central", () => {
  const offenders = listSourceFiles(srcDir).flatMap((file) => {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    return lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /(^|[^.\w])(window\.)?(alert|confirm|prompt)\s*\(/.test(line))
      .map(({ line, index }) => `${file}:${index + 1}: ${line.trim()}`);
  });
  assert.deepEqual(offenders, []);
});

test("provedor envolve a aplicação inteira", () => {
  const main = readSource("../src/main.jsx");
  assert.match(main, /<FeedbackProvider>\s*<App \/>\s*<\/FeedbackProvider>/);
});
