/**
 * Teste rápido de uma API JÁ RODANDO (local ou na Vercel).
 * Cria um jogador temporário, percorre o fluxo do jogo e o apaga no final.
 *
 *   npm run test:smoke                                   (http://localhost:3333/api)
 *   API_URL=https://SEU-BACKEND.vercel.app/api npm run test:smoke
 */
const API_URL = (process.env.API_URL || "http://localhost:3333/api").replace(/\/$/, "");

let failures = 0;
let playerId = null;

async function call(method, path, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });

  const type = response.headers.get("content-type") || "";
  const data = type.includes("json") ? await response.json() : await response.arrayBuffer();

  return { status: response.status, data, type };
}

async function step(name, run) {
  try {
    await run();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FALHOU ${name}: ${error.message}`);
  }
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

console.log(`Testando ${API_URL}\n`);

await step("health (com banco)", async () => {
  const res = await call("GET", "/health?deep=1");
  expect(res.status === 200, `status ${res.status} ${JSON.stringify(res.data)}`);
  console.log(`         armazenamento: ${res.data.storage}`);
});

await step("criar jogador", async () => {
  const res = await call("POST", "/players", {
    nickname: `smoke_${Math.random().toString(36).slice(2, 8)}`,
    avatar: "ae"
  });
  expect(res.status === 201, `status ${res.status} ${JSON.stringify(res.data)}`);
  playerId = res.data.id;
});

await step("trocar avatar (PATCH)", async () => {
  const res = await call("PATCH", `/players/${playerId}`, { avatar: "onca" });
  expect(res.status === 200 && res.data.avatar === "onca", `status ${res.status}`);
});

await step("salvar progresso", async () => {
  const res = await call("POST", "/progress", {
    playerId,
    currentPhase: 2,
    score: 40,
    stars: 4,
    completedPhases: [1]
  });
  expect(res.status === 200 && res.data.score === 40, `status ${res.status} ${JSON.stringify(res.data)}`);
});

await step("registrar resultado da fase", async () => {
  const res = await call("POST", "/progress/phases", {
    playerId,
    phase: 1,
    score: 40,
    stars: 3,
    completed: true,
    errors: 0,
    attempts: 4,
    timeSeconds: 30
  });
  expect(res.status === 201, `status ${res.status} ${JSON.stringify(res.data)}`);
});

await step("ler progresso", async () => {
  const res = await call("GET", `/players/${playerId}/progress`);
  expect(res.status === 200 && res.data.completedPhases.includes(1), `status ${res.status}`);
});

await step("ranking", async () => {
  const res = await call("GET", "/ranking?limit=5");
  expect(res.status === 200 && Array.isArray(res.data), `status ${res.status}`);
});

await step("estatísticas por fase", async () => {
  const res = await call("GET", "/stats/phases");
  expect(res.status === 200 && Array.isArray(res.data.phases), `status ${res.status}`);
});

await step("relatório PDF", async () => {
  const res = await call("GET", `/reports/${playerId}/pdf`);
  expect(res.status === 200 && res.type.includes("pdf"), `status ${res.status}`);
});

await step("remover jogador de teste", async () => {
  if (!playerId) {
    return;
  }

  const res = await call("DELETE", `/players/${playerId}`);
  expect(res.status === 204, `status ${res.status}`);
});

console.log(failures ? `\n${failures} etapa(s) falharam.` : "\nTudo certo!");
process.exit(failures ? 1 : 0);
