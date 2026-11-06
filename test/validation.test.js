"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parsePlayerId,
  parseLimit,
  validatePlayerCreate,
  validatePhaseResult,
  validateProgressPayload
} = require("../src/validation");

const ID = "6e6e973a-dd1c-43fc-9e02-e772fd5d2877";

function assertStatus(fn, status) {
  assert.throws(fn, error => error.status === status);
}

test("apelido: 2 a 15 caracteres, sem símbolos", () => {
  assert.equal(validatePlayerCreate({ nickname: "  João 2  " }).nickname, "João 2");
  assert.equal(validatePlayerCreate({ nickname: "AnA" }).nicknameNormalized, "ana");
  assertStatus(() => validatePlayerCreate({ nickname: "a" }), 400);
  assertStatus(() => validatePlayerCreate({ nickname: "x".repeat(16) }), 400);
  assertStatus(() => validatePlayerCreate({ nickname: "<script>" }), 400);
  assertStatus(() => validatePlayerCreate({}), 400);
});

test("avatar precisa ser um dos personagens do jogo", () => {
  assert.equal(validatePlayerCreate({ nickname: "Ana" }).avatar, "ae");
  assert.equal(validatePlayerCreate({ nickname: "Ana", avatar: "onca" }).avatar, "onca");
  assertStatus(() => validatePlayerCreate({ nickname: "Ana", avatar: "pinguim" }), 400);
});

test("playerId precisa ser UUID", () => {
  assert.equal(parsePlayerId(ID), ID);
  assertStatus(() => parsePlayerId("local-123"), 400);
  assertStatus(() => parsePlayerId(""), 400);
});

test("resultado de fase: números válidos e fase de 1 a 4", () => {
  const ok = validatePhaseResult({ playerId: ID, phase: 2, score: "30", stars: 3, completed: true, errors: 1, attempts: 5, timeSeconds: 42.9 });

  assert.equal(ok.score, 30);
  assert.equal(ok.timeSeconds, 42);
  assert.equal(ok.completed, true);

  assertStatus(() => validatePhaseResult({ playerId: ID, phase: 5 }), 400);
  assertStatus(() => validatePhaseResult({ playerId: ID }), 400);
  assertStatus(() => validatePhaseResult({ playerId: ID, phase: 1, score: "abc" }), 400);
  assertStatus(() => validatePhaseResult({ playerId: ID, phase: 1, stars: 4 }), 400);
  assertStatus(() => validatePhaseResult({ playerId: ID, phase: 1, errors: -1 }), 400);
});

test("progresso: tipos conferidos", () => {
  assert.equal(validateProgressPayload({ playerId: ID, score: 10 }).playerId, ID);
  assertStatus(() => validateProgressPayload({ playerId: ID, completedPhases: "1,2" }), 400);
  assertStatus(() => validateProgressPayload({ playerId: ID, accessibility: [] }), 400);
  assertStatus(() => validateProgressPayload({ playerId: ID, bonusSeal: "bronze" }), 400);
  assertStatus(() => validateProgressPayload({ playerId: ID, score: "muito" }), 400);
  assertStatus(() => validateProgressPayload([]), 400);
});

test("limite do ranking fica entre 1 e 50", () => {
  assert.equal(parseLimit(undefined), 10);
  assert.equal(parseLimit("abc"), 10);
  assert.equal(parseLimit(0), 1);
  assert.equal(parseLimit(500), 50);
});
