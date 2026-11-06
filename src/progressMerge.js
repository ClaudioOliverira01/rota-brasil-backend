"use strict";

/**
 * Regras de consolidação do progresso do jogador.
 *
 * Problema que isto resolve: algumas telas enviavam um progresso PARCIAL
 * e o servidor sobrescrevia a linha inteira, zerando as fases concluídas,
 * trocando o total de estrelas pelas da fase e apagando o tempo total.
 *
 * Regra: o progresso NUNCA regride.
 *  - fases concluídas: união
 *  - pontos, estrelas, fase atual e tempo: o maior valor
 *  - bônus: uma vez concluído, continua concluído; selo dourado > prateado
 *  - campos ausentes: mantêm o que já estava salvo
 *  - EXCEÇÃO: reset: true ("começar do zero") ignora o que estava salvo
 */

const MAX_PHASE = 4;

const SEAL_RANK = { silver: 1, gold: 2 };

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function pickMetric(body, key) {
  return body?.metrics?.[key] ?? body?.[key] ?? null;
}

/** Data ISO válida ou null (texto inválido quebraria a coluna timestamptz). */
function toIsoDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizePhases(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .map(Number)
    .filter(phase => Number.isInteger(phase) && phase >= 1 && phase <= MAX_PHASE);
}

function normalizeAccessibility(source = {}) {
  return {
    narration: source.narration !== false,
    highContrast: Boolean(source.highContrast),
    reducedMotion: Boolean(source.reducedMotion),
    dyslexiaFont: Boolean(source.dyslexiaFont)
  };
}

function normalizeSeal(value) {
  return SEAL_RANK[value] ? value : null;
}

function bestSeal(a, b) {
  const sealA = normalizeSeal(a);
  const sealB = normalizeSeal(b);

  return (SEAL_RANK[sealB] || 0) > (SEAL_RANK[sealA] || 0) ? sealB : sealA;
}

/** Progresso de quem ainda não jogou. */
function defaultProgress(playerId = "") {
  return {
    playerId: String(playerId || ""),
    currentPhase: 1,
    score: 0,
    stars: 0,
    completedPhases: [],
    accessibility: normalizeAccessibility(),
    bonusCompleted: false,
    bonusSeal: null,
    gameStartedAt: null,
    gameCompletedAt: null,
    totalTimeSeconds: 0
  };
}

/**
 * Junta o progresso já salvo (existing, no formato camelCase) com o
 * que chegou na requisição (body).
 */
function mergeProgress(existing, body) {
  const incoming = body || {};

  // "Começar do zero": o progresso salvo não conta.
  const base = incoming.reset === true ? {} : existing || {};

  const completedPhases = [
    ...new Set([
      ...normalizePhases(base.completedPhases),
      ...normalizePhases(incoming.completedPhases)
    ])
  ].sort((a, b) => a - b);

  const bonusCompleted = Boolean(base.bonusCompleted) || incoming.bonusCompleted === true;

  return {
    playerId: String(incoming.playerId || base.playerId || ""),

    currentPhase: Math.max(
      1,
      Math.min(
        MAX_PHASE,
        Math.max(toNumber(base.currentPhase), toNumber(incoming.currentPhase)) || 1
      )
    ),

    score: Math.max(0, toNumber(base.score), toNumber(incoming.score)),

    stars: Math.max(0, toNumber(base.stars), toNumber(incoming.stars)),

    completedPhases,

    accessibility: normalizeAccessibility({
      ...(base.accessibility || {}),
      ...(incoming.accessibility || {})
    }),

    bonusCompleted,

    bonusSeal: bonusCompleted ? bestSeal(base.bonusSeal, incoming.bonusSeal) : null,

    gameStartedAt:
      toIsoDate(base.gameStartedAt) || toIsoDate(pickMetric(incoming, "gameStartedAt")),

    gameCompletedAt:
      toIsoDate(pickMetric(incoming, "gameCompletedAt")) ||
      toIsoDate(base.gameCompletedAt) ||
      null,

    totalTimeSeconds: Math.floor(
      Math.max(
        0,
        toNumber(base.totalTimeSeconds),
        toNumber(pickMetric(incoming, "totalTimeSeconds"))
      )
    )
  };
}

const PROGRESS_COLUMNS =
  "player_id,current_phase,score,stars,completed_phases,accessibility,bonus_completed,bonus_seal,game_started_at,game_completed_at,total_time_seconds";

/**
 * Linha do banco (snake_case) -> formato da API (camelCase).
 */
function rowToProgress(row) {
  if (!row) {
    return null;
  }

  return {
    playerId: row.player_id,
    currentPhase: row.current_phase || 1,
    score: row.score || 0,
    stars: row.stars || 0,
    completedPhases: normalizePhases(row.completed_phases),
    accessibility: normalizeAccessibility(row.accessibility || {}),
    bonusCompleted: Boolean(row.bonus_completed),
    bonusSeal: normalizeSeal(row.bonus_seal),
    gameStartedAt: row.game_started_at || null,
    gameCompletedAt: row.game_completed_at || null,
    totalTimeSeconds: row.total_time_seconds || 0
  };
}

/**
 * Formato da API (camelCase) -> linha do banco (snake_case).
 */
function progressToRow(progress) {
  return {
    player_id: progress.playerId,
    current_phase: progress.currentPhase,
    score: progress.score,
    stars: progress.stars,
    completed_phases: progress.completedPhases,
    accessibility: progress.accessibility,
    bonus_completed: progress.bonusCompleted,
    bonus_seal: progress.bonusSeal,
    game_started_at: progress.gameStartedAt,
    game_completed_at: progress.gameCompletedAt,
    total_time_seconds: progress.totalTimeSeconds,
    updated_at: new Date().toISOString()
  };
}

module.exports = {
  MAX_PHASE,
  PROGRESS_COLUMNS,
  defaultProgress,
  mergeProgress,
  rowToProgress,
  progressToRow
};
