"use strict";

/**
 * Testes de integração da API (rotas + validação + armazenamento).
 *
 * Por padrão usam o armazenamento em memória. Para rodar os MESMOS testes
 * contra um banco Supabase/PostgREST de verdade (com as migrations
 * aplicadas), defina:
 *   TEST_SUPABASE_URL=...  TEST_SUPABASE_KEY=...  npm test
 * ATENÇÃO: os testes criam e depois apagam jogadores com apelido "t_...".
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("crypto");

const { loadConfig } = require("../src/config");
const { createStore } = require("../src/storage");
const { createApp } = require("../src/app");

const useSupabase = Boolean(process.env.TEST_SUPABASE_URL && process.env.TEST_SUPABASE_KEY);

const config = loadConfig({
  NODE_ENV: "test",
  FRONTEND_URL: "https://rota-brasil.example.com",
  ...(useSupabase
    ? {
        SUPABASE_URL: process.env.TEST_SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: process.env.TEST_SUPABASE_KEY
      }
    : {})
});

const loggedErrors = [];
const logger = { error: (...args) => loggedErrors.push(args) };

const app = createApp({ config, store: createStore(config), logger });

let server;
let baseUrl;
const createdIds = new Set();

function nickname(prefix = "t") {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

async function api(path, { method = "GET", body, raw, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined
  });

  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json")
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());

  return { status: response.status, headers: response.headers, data };
}

async function createPlayer(data = {}) {
  const res = await api("/api/players", { method: "POST", body: { nickname: nickname(), ...data } });

  assert.equal(res.status, 201, JSON.stringify(res.data));
  createdIds.add(res.data.id);

  return res.data;
}

test.before(async () => {
  await new Promise(resolve => {
    server = app.listen(0, "127.0.0.1", resolve);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  for (const id of createdIds) {
    await api(`/api/players/${id}`, { method: "DELETE" });
  }

  await new Promise(resolve => server.close(resolve));

  assert.deepEqual(loggedErrors, [], "a API registrou erros 500 durante os testes");
});

test(`armazenamento em uso: ${config.storage}`, async () => {
  const res = await api("/api/health?deep=1");

  assert.equal(res.status, 200);
  assert.equal(res.data.storage, useSupabase ? "supabase" : "memory");
  assert.equal(res.data.database, "ok");
});

test("cria jogador e impede apelido repetido (sem diferenciar maiúsculas)", async () => {
  const name = nickname("Dup");
  const player = await createPlayer({ nickname: name, avatar: "onca" });

  assert.match(player.id, /^[0-9a-f-]{36}$/);
  assert.equal(player.nickname, name);
  assert.equal(player.avatar, "onca");

  const again = await api("/api/players", { method: "POST", body: { nickname: name.toUpperCase() } });

  assert.equal(again.status, 409);
  assert.equal(again.data.error, "Esse apelido já está sendo utilizado. Tente outro.");
});

test("rejeita dados inválidos com 400", async () => {
  const cases = [
    { nickname: "a" },
    { nickname: "<b>oi</b>" },
    { nickname: nickname(), avatar: "pinguim" }
  ];

  for (const body of cases) {
    const res = await api("/api/players", { method: "POST", body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok(res.data.error);
  }

  const malformed = await api("/api/players", { method: "POST", raw: "{nickname:" });
  assert.equal(malformed.status, 400);
});

test("busca por apelido devolve o progresso inicial", async () => {
  const player = await createPlayer();
  const res = await api(`/api/players/by-nickname/${encodeURIComponent(player.nickname.toUpperCase())}`);

  assert.equal(res.status, 200);
  assert.equal(res.data.id, player.id);
  assert.equal(res.data.progress.currentPhase, 1);
  assert.deepEqual(res.data.progress.completedPhases, []);
  assert.equal(res.data.progress.bonusCompleted, false);

  const missing = await api("/api/players/by-nickname/ninguem_aqui_x");
  assert.equal(missing.status, 404);

  const search = await api(`/api/players?nickname=${encodeURIComponent(player.nickname)}`);
  assert.equal(search.status, 200);
  assert.equal(search.data.length, 1);
  assert.equal(search.data[0].id, player.id);
  assert.equal(search.data[0].progress.currentPhase, 1);

  const free = await api("/api/players?nickname=ninguem_aqui_x");
  assert.equal(free.status, 200);
  assert.deepEqual(free.data, []);

  assert.equal((await api("/api/players")).status, 400);
});

test("PATCH altera o avatar (que aparece no ranking)", async () => {
  const player = await createPlayer();
  const res = await api(`/api/players/${player.id}`, { method: "PATCH", body: { avatar: "tartaruga" } });

  assert.equal(res.status, 200);
  assert.equal(res.data.avatar, "tartaruga");

  const read = await api(`/api/players/${player.id}`);
  assert.equal(read.data.avatar, "tartaruga");

  const invalid = await api(`/api/players/${player.id}`, { method: "PATCH", body: { avatar: "x" } });
  assert.equal(invalid.status, 400);

  const empty = await api(`/api/players/${player.id}`, { method: "PATCH", body: {} });
  assert.equal(empty.status, 400);

  const unknown = await api(`/api/players/${randomUUID()}`, { method: "PATCH", body: { avatar: "ae" } });
  assert.equal(unknown.status, 404);
});

test("progresso: salva, consolida sem regredir e guarda o bônus", async () => {
  const player = await createPlayer();

  const first = await api("/api/progress", {
    method: "POST",
    body: {
      playerId: player.id,
      currentPhase: 3,
      score: 90,
      stars: 6,
      completedPhases: [1, 2],
      accessibility: { narration: false, dyslexiaFont: true },
      metrics: { gameStartedAt: "2026-10-01T12:00:00.000Z", totalTimeSeconds: 200 }
    }
  });

  assert.equal(first.status, 200, JSON.stringify(first.data));

  // envio parcial/atrasado não pode apagar nada
  await api("/api/progress", { method: "POST", body: { playerId: player.id, score: 10, completedPhases: [] } });

  await api("/api/progress", {
    method: "POST",
    body: { playerId: player.id, completedPhases: [1, 2, 3, 4], bonusCompleted: true, bonusSeal: "gold" }
  });

  // selo prateado depois do dourado não rebaixa
  await api("/api/progress", { method: "POST", body: { playerId: player.id, bonusCompleted: true, bonusSeal: "silver" } });

  const res = await api(`/api/players/${player.id}/progress`);

  assert.equal(res.status, 200);
  assert.equal(res.data.score, 90);
  assert.equal(res.data.stars, 6);
  assert.equal(res.data.currentPhase, 3);
  assert.deepEqual(res.data.completedPhases, [1, 2, 3, 4]);
  assert.equal(res.data.accessibility.narration, false);
  assert.equal(res.data.accessibility.dyslexiaFont, true);
  assert.equal(res.data.bonusCompleted, true);
  assert.equal(res.data.bonusSeal, "gold");
  assert.equal(res.data.totalTimeSeconds, 200);
  assert.equal(new Date(res.data.gameStartedAt).toISOString(), "2026-10-01T12:00:00.000Z");
});

test("progresso: playerId inválido = 400, inexistente = 404", async () => {
  assert.equal((await api("/api/progress", { method: "POST", body: { score: 1 } })).status, 400);
  assert.equal((await api("/api/progress", { method: "POST", body: { playerId: "local-1" } })).status, 400);
  assert.equal((await api("/api/progress", { method: "POST", body: { playerId: randomUUID() } })).status, 404);
  assert.equal((await api(`/api/players/${randomUUID()}/progress`)).status, 404);
  assert.equal((await api("/api/players/nao-e-uuid/progress")).status, 400);
});

test("resultados de fase, estatísticas e relatório PDF", async () => {
  const player = await createPlayer({ nickname: nickname("Pdf") });

  const result = await api("/api/progress/phases", {
    method: "POST",
    body: { playerId: player.id, phase: 2, score: 60, stars: 2, completed: true, errors: 2, attempts: 8, timeSeconds: 75 }
  });

  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.playerId, player.id);
  assert.equal(result.data.timeSeconds, 75);

  const bad = await api("/api/progress/phases", { method: "POST", body: { playerId: player.id, phase: 7 } });
  assert.equal(bad.status, 400);

  const nan = await api("/api/progress/phases", { method: "POST", body: { playerId: player.id, phase: 1, score: "abc" } });
  assert.equal(nan.status, 400);

  const ghost = await api("/api/progress/phases", { method: "POST", body: { playerId: randomUUID(), phase: 1 } });
  assert.equal(ghost.status, 404);

  const stats = await api("/api/stats/phases");
  const phase2 = stats.data.phases.find(item => item.phase === 2);

  assert.equal(stats.status, 200);
  assert.ok(phase2.totalErrors >= 2);
  assert.ok(phase2.totalAttempts >= 8);
  assert.ok(phase2.completedCount >= 1);
  assert.ok(Number.isInteger(stats.data.mostErrorsPhase));

  const pdf = await api(`/api/reports/${player.id}/pdf`);

  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(pdf.headers.get("content-disposition"), /relatorio-rota-brasil-pdf_/);
  assert.equal(pdf.data.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.data.length > 1000);

  assert.equal((await api(`/api/reports/${randomUUID()}/pdf`)).status, 404);
});

test("ranking: ordenado por pontos, com avatar e limite", async () => {
  const low = await createPlayer({ avatar: "onca" });
  const high = await createPlayer({ avatar: "tartaruga" });

  await api("/api/progress", { method: "POST", body: { playerId: low.id, score: 999990, stars: 1 } });
  await api("/api/progress", { method: "POST", body: { playerId: high.id, score: 999999, stars: 1, completedPhases: [1] } });

  const res = await api("/api/ranking?limit=2");

  assert.equal(res.status, 200);
  assert.equal(res.data.length, 2);
  assert.deepEqual(res.data.map(row => row.id), [high.id, low.id]);
  assert.equal(res.data[0].avatar, "tartaruga");
  assert.deepEqual(res.data[0].completedPhases, [1]);

  const all = await api("/api/ranking?limit=999");
  assert.ok(all.data.length <= 50);
});

test("DELETE /progress (começar do zero) zera progresso e resultados", async () => {
  const player = await createPlayer();

  await api("/api/progress", { method: "POST", body: { playerId: player.id, score: 50, completedPhases: [1], bonusCompleted: true, bonusSeal: "gold" } });
  await api("/api/progress/phases", { method: "POST", body: { playerId: player.id, phase: 1, completed: true } });

  const reset = await api(`/api/players/${player.id}/progress`, { method: "DELETE" });

  assert.equal(reset.status, 200);
  assert.equal(reset.data.score, 0);
  assert.deepEqual(reset.data.completedPhases, []);
  assert.equal(reset.data.bonusCompleted, false);

  const progress = await api(`/api/players/${player.id}/progress`);
  assert.equal(progress.data.score, 0);

  // o jogador continua existindo (e no ranking), só o progresso zerou
  assert.equal((await api(`/api/players/${player.id}`)).status, 200);
});

test("DELETE /players remove o jogador e tudo dele", async () => {
  const player = await createPlayer();

  await api("/api/progress/phases", { method: "POST", body: { playerId: player.id, phase: 1, completed: true } });

  assert.equal((await api(`/api/players/${player.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await api(`/api/players/${player.id}`)).status, 404);
  assert.equal((await api(`/api/players/${player.id}`, { method: "DELETE" })).status, 404);

  createdIds.delete(player.id);
});

test("rota inexistente responde 404 em JSON", async () => {
  const res = await api("/api/nao-existe");

  assert.equal(res.status, 404);
  assert.equal(res.data.error, "Rota não encontrada");
});

test("CORS: libera o frontend configurado e localhost; bloqueia outros", async () => {
  const allowed = await api("/api/health", { headers: { Origin: "https://rota-brasil.example.com" } });
  const local = await api("/api/health", { headers: { Origin: "http://localhost:5173" } });
  const blocked = await api("/api/health", { headers: { Origin: "https://site-estranho.com" } });

  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://rota-brasil.example.com");
  assert.equal(local.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(blocked.headers.get("access-control-allow-origin"), null);
});
