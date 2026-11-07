// Gera os PDFs dos manuais do Natal Premiado 2026 a partir dos HTML desta pasta.
// Usa o Chrome (ou Edge) instalado, em modo headless, pelo protocolo DevTools.
// O sumário (<!--SUMARIO-->) é montado a partir das seções com data-titulo, com o
// número da página em que cada seção começa.
//
// Uso (a partir desta pasta):  node gerar-pdfs.mjs
// Opcional: CHROME_PATH=<caminho do executável>

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pasta = path.dirname(fileURLToPath(import.meta.url));
const destino = path.resolve(pasta, "..");
const MANUAIS = [
  ["manual-distribuidor.html", "Manual-Distribuidor-Natal-Premiado-2026.pdf"],
  ["manual-leticia.html", "Manual-Leticia-Natal-Premiado-2026.pdf"],
  ["guia-rapido-leticia.html", "Guia-Rapido-Leticia-Natal-Premiado-2026.pdf"],
];

const CANDIDATOS = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean);
const executavel = CANDIDATOS.find((item) => fs.existsSync(item));
if (!executavel) throw new Error("Chrome ou Edge não encontrado. Informe CHROME_PATH.");

const porta = 9300 + Math.floor(Math.random() * 500);
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "manuais-natal-"));
const chrome = spawn(executavel, [
  "--headless=new", `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`,
  "--no-first-run", "--no-default-browser-check", "--allow-file-access-from-files", "about:blank",
], { stdio: "ignore" });

const esperar = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const conectar = async () => {
  for (let tentativa = 0; tentativa < 50; tentativa += 1) {
    try {
      const resposta = await fetch(`http://127.0.0.1:${porta}/json/new?about:blank`, { method: "PUT" });
      if (resposta.ok) return (await resposta.json()).webSocketDebuggerUrl;
    } catch {
      // Chrome ainda abrindo.
    }
    await esperar(200);
  }
  throw new Error("Não foi possível conectar ao Chrome.");
};

const criarSessao = async () => {
  const socket = new WebSocket(await conectar());
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequencia = 0;
  const pendentes = new Map();
  const ouvintes = new Map();
  socket.onmessage = (evento) => {
    const mensagem = JSON.parse(evento.data);
    if (mensagem.id && pendentes.has(mensagem.id)) {
      const { resolve, reject } = pendentes.get(mensagem.id);
      pendentes.delete(mensagem.id);
      if (mensagem.error) reject(new Error(mensagem.error.message));
      else resolve(mensagem.result);
    } else if (mensagem.method && ouvintes.has(mensagem.method)) {
      ouvintes.get(mensagem.method)(mensagem.params);
      ouvintes.delete(mensagem.method);
    }
  };
  const enviar = (method, params = {}) => new Promise((resolve, reject) => {
    sequencia += 1;
    pendentes.set(sequencia, { resolve, reject });
    socket.send(JSON.stringify({ id: sequencia, method, params }));
  });
  const aguardarEvento = (method) => new Promise((resolve) => { ouvintes.set(method, resolve); });
  return { enviar, aguardarEvento, fechar: () => socket.close() };
};

const avaliar = async (sessao, expressao) => {
  const { result, exceptionDetails } = await sessao.enviar("Runtime.evaluate", { expression: expressao, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
};

const imprimir = async (sessao) => {
  const { data } = await sessao.enviar("Page.printToPDF", { preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
  return Buffer.from(data, "base64");
};

const contarPaginas = (pdf) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;

const gerar = async (sessao, origem, nomePdf) => {
  const carregado = sessao.aguardarEvento("Page.loadEventFired");
  await sessao.enviar("Page.navigate", { url: pathToFileURL(path.join(pasta, origem)).href });
  await carregado;
  await avaliar(sessao, "document.fonts.ready.then(() => Promise.all([...document.images].map((img) => img.complete ? 0 : new Promise((r) => { img.onload = img.onerror = r; })))).then(() => true)");

  // Sumário provisório (mesma altura do final) para medir as páginas.
  const titulos = await avaliar(sessao, `(() => {
    const secoes = [...document.querySelectorAll("section[data-titulo]")];
    secoes.forEach((secao, indice) => { secao.id = secao.id || "secao-" + (indice + 1); });
    const lista = document.querySelector(".sumario ol");
    if (lista) lista.innerHTML = secoes.map((secao) => '<li><a href="#' + secao.id + '"><span class="letra">' + secao.dataset.letra + '</span>' + secao.dataset.titulo + '<span class="num">00</span></a></li>').join("");
    return secoes.map((secao) => secao.id);
  })()`);

  // Página de início de cada seção: imprime o documento até o título da seção.
  const paginas = [];
  for (const id of titulos) {
    await avaliar(sessao, `(() => {
      const alvo = document.getElementById(${JSON.stringify(id)});
      const titulo = alvo.querySelector("h1") || alvo.firstElementChild;
      let depois = false;
      for (const elemento of document.querySelectorAll("body *")) {
        if (elemento === titulo) { depois = true; continue; }
        if (depois && !elemento.contains(titulo) && !titulo.contains(elemento)) elemento.dataset.ocultoMedicao = elemento.style.display || "x", elemento.style.display = "none";
      }
      return true;
    })()`);
    paginas.push(contarPaginas(await imprimir(sessao)));
    await avaliar(sessao, `(() => {
      for (const elemento of document.querySelectorAll("[data-oculto-medicao]")) {
        elemento.style.display = elemento.dataset.ocultoMedicao === "x" ? "" : elemento.dataset.ocultoMedicao;
        delete elemento.dataset.ocultoMedicao;
      }
      return true;
    })()`);
  }

  await avaliar(sessao, `(() => {
    const numeros = ${JSON.stringify(paginas)};
    document.querySelectorAll(".sumario .num").forEach((item, indice) => { item.textContent = numeros[indice]; });
    return true;
  })()`);
  const pdf = await imprimir(sessao);
  fs.writeFileSync(path.join(destino, nomePdf), pdf);
  console.log(`${nomePdf}: ${contarPaginas(pdf)} páginas; seções nas páginas ${paginas.join(", ")}`);
};

try {
  const sessao = await criarSessao();
  await sessao.enviar("Page.enable");
  await sessao.enviar("Runtime.enable");
  const filtro = process.argv[2];
  for (const [origem, nomePdf] of MANUAIS) {
    if (filtro && !origem.includes(filtro)) continue;
    await gerar(sessao, origem, nomePdf);
  }
  sessao.fechar();
} finally {
  chrome.kill();
  await esperar(300);
  fs.rmSync(perfil, { recursive: true, force: true });
}
