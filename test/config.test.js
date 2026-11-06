"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { loadConfig } = require("../src/config");
const { createOriginCheck } = require("../src/app");

const PRODUCTION_SITE = "https://rota-brasil-lemon.vercel.app";

test("CORS: o site publicado é aceito mesmo sem FRONTEND_URL", () => {
  const config = loadConfig({ NODE_ENV: "production" });
  const isAllowed = createOriginCheck(config);

  assert.equal(isAllowed(PRODUCTION_SITE), true);
  assert.equal(isAllowed("http://localhost:5173"), true);
  assert.equal(isAllowed("https://site-estranho.com"), false);
});

test("CORS: FRONTEND_URL acrescenta origens e não remove as padrão", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    FRONTEND_URL: "https://meu-dominio.com.br/, https://outro.com"
  });
  const isAllowed = createOriginCheck(config);

  assert.equal(isAllowed("https://meu-dominio.com.br"), true);
  assert.equal(isAllowed("https://outro.com"), true);
  assert.equal(isAllowed(PRODUCTION_SITE), true);
});

test("CORS: previews da Vercel só com ALLOW_VERCEL_PREVIEWS=true", () => {
  const off = createOriginCheck(loadConfig({ NODE_ENV: "production" }));
  const on = createOriginCheck(
    loadConfig({ NODE_ENV: "production", ALLOW_VERCEL_PREVIEWS: "true" })
  );

  assert.equal(off("https://rota-brasil-git-teste.vercel.app"), false);
  assert.equal(on("https://rota-brasil-git-teste.vercel.app"), true);
});