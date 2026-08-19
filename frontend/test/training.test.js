import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  appendUniqueTrainings,
  buildTrainingAudiencePayload,
  buildTrainingWatermark,
  changeTrainingDistributorAudience,
  changeTrainingPublics,
  clampProgress,
  createProgressThrottle,
  extractYouTubeVideoId,
  getPlayerKind,
  getTrainingProgressState,
  getTrainingThumbnail,
  getYouTubePlayerOrigin,
  normalizeTrainingAudience,
  normalizeTrainingResponse,
} from "../src/utils/training.js";
import { createYouTubePlayerSession } from "../src/utils/youtubePlayerSession.js";

const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("extrai ID direto válido", () => {
  assert.equal(extractYouTubeVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extrai ID das URLs aceitas", () => {
  assert.equal(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(extractYouTubeVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(extractYouTubeVideoId("https://youtube.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("recusa URLs e entradas inseguras", () => {
  assert.equal(extractYouTubeVideoId("https://example.com/dQw4w9WgXcQ"), null);
  assert.equal(extractYouTubeVideoId("<script>alert(1)</script>"), null);
  assert.equal(extractYouTubeVideoId("http://youtube.com/watch?v=dQw4w9WgXcQ"), null);
});

test("origem do player acompanha localhost e produção sem valor fixo", () => {
  assert.equal(
    getYouTubePlayerOrigin({ origin: "http://localhost:5173" }),
    "http://localhost:5173"
  );
  assert.equal(
    getYouTubePlayerOrigin({ origin: "https://b2b.atualpet.com.br" }),
    "https://b2b.atualpet.com.br"
  );
  assert.equal(getYouTubePlayerOrigin({ origin: "file://treinamento" }), "");
  assert.equal(getYouTubePlayerOrigin({}), "");
});

test("sessão do YouTube mantém uma única instância ativa por host e destrói de forma idempotente", () => {
  let activePlayers = 0;
  let destroyedPlayers = 0;
  let mountSequence = 0;
  const host = {
    children: [],
    ownerDocument: {
      createElement: () => ({ id: ++mountSequence }),
    },
    replaceChildren(...children) {
      this.children = children;
    },
  };
  const YT = {
    Player: class FakePlayer {
      constructor(mountNode) {
        this.mountNode = mountNode;
        activePlayers += 1;
      }

      destroy() {
        activePlayers -= 1;
        destroyedPlayers += 1;
      }
    },
  };

  const first = createYouTubePlayerSession({ YT, host, options: {} });
  const second = createYouTubePlayerSession({ YT, host, options: {} });

  assert.equal(activePlayers, 1);
  assert.equal(destroyedPlayers, 1);
  assert.notEqual(first.player.mountNode, second.player.mountNode);
  assert.deepEqual(host.children, [second.player.mountNode]);

  second.destroy();
  second.destroy();
  assert.equal(activePlayers, 0);
  assert.equal(destroyedPlayers, 2);
  assert.deepEqual(host.children, []);
});

test("audiência de treinamento restaura edição e serializa Groomers com distribuidores específicos", () => {
  const restored = normalizeTrainingAudience({
    publicos: ["cliente", "groomer"],
    audienciaTipo: "especificos",
    distribuidoresIds: [{ _id: "dist-1" }, "dist-2"],
  });

  assert.deepEqual(restored, {
    publicos: ["cliente", "groomer"],
    audienciaTipo: "especificos",
    distribuidoresIds: ["dist-1", "dist-2"],
  });
  assert.deepEqual(buildTrainingAudiencePayload(restored), {
    publicos: '["cliente","groomer"]',
    audienciaTipo: "especificos",
    distribuidoresIds: '["dist-1","dist-2"]',
  });
  assert.deepEqual(normalizeTrainingAudience({}), {
    publicos: ["cliente"],
    audienciaTipo: "todos",
    distribuidoresIds: [],
  });
});

test("combinações de público mantêm a regra atual ao remover distribuidores", () => {
  const base = normalizeTrainingAudience({});
  const both = changeTrainingPublics(base, ["cliente", "groomer"]);
  const specific = changeTrainingDistributorAudience(both, {
    audienceType: "especificos",
    selectedIds: ["dist-1"],
  });
  assert.deepEqual(specific, {
    publicos: ["cliente", "groomer"],
    audienciaTipo: "especificos",
    distribuidoresIds: ["dist-1"],
  });

  const groomerOnly = changeTrainingPublics(specific, ["groomer"]);
  assert.deepEqual(groomerOnly, {
    publicos: ["groomer"],
    audienciaTipo: "todos",
    distribuidoresIds: [],
  });
  assert.deepEqual(changeTrainingPublics(groomerOnly, ["cliente", "groomer"]), {
    publicos: ["cliente", "groomer"],
    audienciaTipo: "todos",
    distribuidoresIds: [],
  });
});

test("gera thumbnail padrão somente para provider conhecido", () => {
  assert.equal(
    getTrainingThumbnail({ provider: "youtube", videoId: "dQw4w9WgXcQ" }),
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
  );
  assert.equal(
    getTrainingThumbnail({ provider: "bunny", videoId: "dQw4w9WgXcQ" }),
    ""
  );
});

test("player genérico seleciona YouTube", () => {
  assert.equal(getPlayerKind("youtube"), "youtube");
  const source = readSource("../src/components/VideoPlayer/VideoPlayer.jsx");
  assert.match(source, /return <YouTubePlayer/);
});

test("provider desconhecido seleciona fallback seguro", () => {
  assert.equal(getPlayerKind("vimeo"), "unsupported");
  assert.equal(getPlayerKind(undefined), "unsupported");
  const source = readSource("../src/components/VideoPlayer/VideoPlayer.jsx");
  assert.match(source, /UnsupportedVideoProvider/);
});

test("botão de treinamento não iniciado é correto", () => {
  assert.deepEqual(getTrainingProgressState({}), {
    key: "nao_iniciado",
    label: "Não iniciado",
    action: "Começar treinamento",
  });
});

test("botão de treinamento em andamento é correto", () => {
  assert.equal(getTrainingProgressState({ percentualAssistido: 45 }).action, "Continuar");
});

test("botão de treinamento concluído é correto", () => {
  assert.equal(getTrainingProgressState({ concluido: true }).action, "Assistir novamente");
});

test("barra de progresso permanece entre zero e cem", () => {
  assert.equal(clampProgress(-20), 0);
  assert.equal(clampProgress(120), 100);
  assert.equal(clampProgress("inválido"), 0);
});

test("normaliza listagem e acrescenta páginas sem duplicar", () => {
  const normalized = normalizeTrainingResponse({
    treinamentos: [{ id: "1" }],
    paginacao: { totalItens: 2, temProximaPagina: true },
  });
  assert.equal(normalized.treinamentos.length, 1);
  assert.equal(normalized.paginacao.temProximaPagina, true);
  assert.deepEqual(
    appendUniqueTrainings([{ id: "1" }], [{ id: "1" }, { id: "2" }]),
    [{ id: "1" }, { id: "2" }]
  );
});

test("marca d'água limita e sanitiza dados exibidos", () => {
  const watermark = buildTrainingWatermark({
    nomeResponsavel: "  Maria\nSilva  ",
    nomeFantasia: "Pet Center",
    _id: "507f1f77bcf86cd799439011",
  });
  assert.equal(watermark.nome, "Maria Silva");
  assert.equal(watermark.cliente, "Pet Center");
  assert.equal(watermark.sessao, "439011");
  assert.equal(Object.hasOwn(watermark, "email"), false);
});

test("throttle envia imediatamente, reduz atualizações e permite flush", () => {
  let currentTime = 1000;
  const calls = [];
  const throttle = createProgressThrottle((payload) => calls.push(payload), {
    interval: 15000,
    now: () => currentTime,
  });

  assert.equal(throttle.run({ position: 1 }), true);
  currentTime = 15000;
  assert.equal(throttle.run({ position: 14 }), false);
  currentTime = 16000;
  assert.equal(throttle.run({ position: 15 }), true);
  currentTime = 17000;
  assert.equal(throttle.run({ position: 16 }), false);
  assert.equal(throttle.run({ position: 16 }, { force: true }), true);
  assert.equal(calls.length, 3);
});

test("páginas do cliente não exibem link ou ID do YouTube", () => {
  const listSource = readSource("../src/pages/Treinamentos/Treinamentos.jsx");
  const detailSource = readSource("../src/pages/TreinamentoDetalhe/TreinamentoDetalhe.jsx");

  assert.doesNotMatch(listSource, /videoId/);
  assert.doesNotMatch(`${listSource}\n${detailSource}`, /Link ou ID do YouTube/);
  assert.equal((detailSource.match(/treinamento\.videoId/g) || []).length, 1);
  assert.match(detailSource, /videoId=\{treinamento\.videoId\}/);
});

test("player não oferece link público ou botão próprio de download", () => {
  const source = readSource("../src/components/VideoPlayer/YouTubePlayer.jsx");

  assert.doesNotMatch(source, /\bdownload\b/i);
  assert.doesNotMatch(source, /youtube\.com\/watch|youtu\.be/i);
  assert.match(source, /youtube\.com\/iframe_api/);
});

test("IFrame API usa a origem hospedeira sem ampliar Permissions Policy", () => {
  const source = readSource("../src/components/VideoPlayer/YouTubePlayer.jsx");
  const adminSource = readSource("../src/pages/AdminTreinamentos/AdminTreinamentos.jsx");
  const detailSource = readSource("../src/pages/TreinamentoDetalhe/TreinamentoDetalhe.jsx");

  assert.match(source, /enablejsapi:\s*1/);
  assert.match(source, /origin:\s*getYouTubePlayerOrigin\(\)/);
  assert.doesNotMatch(source, /origin:\s*["']https:\/\/www\.youtube\.com/);
  assert.doesNotMatch(source, /origin:\s*["']http:\/\/localhost/);
  assert.doesNotMatch(source, /compute-pressure/i);
  assert.match(source, /getCurrentTime/);
  assert.match(source, /seekTo/);
  assert.match(source, /createYouTubePlayerSession/);
  assert.match(source, /session\?\.destroy\(\)/);
  assert.match(source, /\}, \[videoId\]\);/);
  assert.doesNotMatch(source, /new YT\.Player\(hostRef\.current/);
  assert.match(adminSource, /<VideoPlayer provider="youtube"/);
  assert.match(detailSource, /<VideoPlayer[\s\S]*?provider=\{treinamento\.provider\}/);
});

test("rotas de treinamentos exigem o perfil correto", () => {
  const source = readSource("../src/App.jsx");

  assert.match(
    source,
    /path="\/treinamentos"[\s\S]*?<RoleRoute roles=\{\["cliente", "groomer"\]\}>[\s\S]*?<Treinamentos \/>/
  );
  assert.match(
    source,
    /path="\/treinamentos\/:id"[\s\S]*?<RoleRoute roles=\{\["cliente", "groomer"\]\}>[\s\S]*?<TreinamentoDetalhe \/>/
  );
  assert.match(
    source,
    /path="\/admin\/treinamentos"[\s\S]*?<RoleRoute role="admin">[\s\S]*?<AdminTreinamentos \/>/
  );
});

test("listagem possui fallback quando a thumbnail falha ou não existe", () => {
  const source = readSource("../src/pages/Treinamentos/Treinamentos.jsx");

  assert.match(source, /onError=\{\(\) => setImagensComErro/);
  assert.match(source, /className=\{styles\.placeholder\}/);
  assert.match(source, /loading="lazy"/);
  assert.match(source, /decoding="async"/);
});

test("erros da API são convertidos em mensagens seguras", () => {
  const listSource = readSource("../src/pages/Treinamentos/Treinamentos.jsx");
  const detailSource = readSource("../src/pages/TreinamentoDetalhe/TreinamentoDetalhe.jsx");

  assert.match(listSource, /Não foi possível carregar os treinamentos/);
  assert.match(detailSource, /Este treinamento não está disponível/);
  assert.match(detailSource, /Sua conta não possui acesso a este treinamento/);
  assert.doesNotMatch(`${listSource}\n${detailSource}`, /error\.stack|erro\.stack/);
});
