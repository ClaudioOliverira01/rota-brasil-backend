"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  defaultProgress,
  mergeProgress,
  rowToProgress,
  progressToRow
} = require("../src/progressMerge");

const ID = "6e6e973a-dd1c-43fc-9e02-e772fd5d2877";

test("progresso parcial não apaga o que já estava salvo", () => {
  const saved = {
    ...defaultProgress(ID),
    currentPhase: 3,
    score: 120,
    stars: 6,
    completedPhases: [1, 2],
    totalTimeSeconds: 300
  };

  const merged = mergeProgress(saved, { playerId: ID, stars: 2, completedPhases: [3] });

  assert.equal(merged.score, 120);
  assert.equal(merged.stars, 6);
  assert.equal(merged.currentPhase, 3);
  assert.deepEqual(merged.completedPhases, [1, 2, 3]);
  assert.equal(merged.totalTimeSeconds, 300);
});

test("reset: true ignora o progresso salvo", () => {
  const saved = { ...defaultProgress(ID), score: 500, completedPhases: [1, 2, 3, 4], bonusCompleted: true, bonusSeal: "gold" };
  const merged = mergeProgress(saved, { playerId: ID, reset: true });

  assert.equal(merged.score, 0);
  assert.deepEqual(merged.completedPhases, []);
  assert.equal(merged.bonusCompleted, false);
  assert.equal(merged.bonusSeal, null);
});

test("bônus nunca regride e o selo dourado vence o prateado", () => {
  const gold = mergeProgress(null, { playerId: ID, bonusCompleted: true, bonusSeal: "gold" });
  const later = mergeProgress(gold, { playerId: ID, bonusCompleted: false, bonusSeal: "silver" });

  assert.equal(later.bonusCompleted, true);
  assert.equal(later.bonusSeal, "gold");
});

test("fases fora de 1..4 e datas inválidas são descartadas", () => {
  const merged = mergeProgress(null, {
    playerId: ID,
    completedPhases: [0, 1, "2", 9, "x"],
    metrics: { gameStartedAt: "não é data", totalTimeSeconds: 12.7 }
  });

  assert.deepEqual(merged.completedPhases, [1, 2]);
  assert.equal(merged.gameStartedAt, null);
  assert.equal(merged.totalTimeSeconds, 12);
});

test("conversão linha do banco <-> API preserva os campos", () => {
  const progress = mergeProgress(null, {
    playerId: ID,
    currentPhase: 2,
    score: 40,
    stars: 3,
    completedPhases: [1],
    accessibility: { narration: false, dyslexiaFont: true },
    bonusCompleted: true,
    bonusSeal: "silver"
  });

  const roundTrip = rowToProgress(progressToRow(progress));

  assert.deepEqual(roundTrip, progress);
});
