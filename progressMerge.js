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
 *  - campos ausentes: mantêm o que já estava salvo
 *  - EXCEÇÃO: reset: true ("começar do zero") ignora o que estava salvo
 */

const MAX_PHASE = 4;

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function pickMetric(body, key) {
  return body?.metrics?.[key] ?? body?.[key] ?? null;
}

function normalizePhases(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .map(Number)
    .filter(
      phase =>
        Number.isInteger(phase) &&
        phase >= 1 &&
        phase <= MAX_PHASE
    );
}

function normalizeAccessibility(source = {}) {
  return {
    narration: source.narration !== false,
    highContrast: Boolean(source.highContrast),
    reducedMotion: Boolean(source.reducedMotion),
    dyslexiaFont: Boolean(source.dyslexiaFont)
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

  const nickname = String(incoming.nickname || "").trim();
  const avatar = String(incoming.avatar || "").trim();

  const completedPhases = [
    ...new Set([
      ...normalizePhases(base.completedPhases),
      ...normalizePhases(incoming.completedPhases)
    ])
  ].sort((a, b) => a - b);

  return {
    playerId: String(incoming.playerId || base.playerId || ""),

    nickname: nickname || base.nickname || "",

    avatar: avatar || base.avatar || "ae",

    currentPhase: Math.max(
      1,
      Math.min(
        MAX_PHASE,
        Math.max(
          toNumber(base.currentPhase),
          toNumber(incoming.currentPhase)
        ) || 1
      )
    ),

    score: Math.max(
      0,
      toNumber(base.score),
      toNumber(incoming.score)
    ),

    stars: Math.max(
      0,
      toNumber(base.stars),
      toNumber(incoming.stars)
    ),

    completedPhases,

    accessibility: normalizeAccessibility({
      ...(base.accessibility || {}),
      ...(incoming.accessibility || {})
    }),

    gameStartedAt:
      base.gameStartedAt ||
      pickMetric(incoming, "gameStartedAt"),

    gameCompletedAt:
      pickMetric(incoming, "gameCompletedAt") ||
      base.gameCompletedAt ||
      null,

    totalTimeSeconds: Math.max(
      0,
      toNumber(base.totalTimeSeconds),
      toNumber(pickMetric(incoming, "totalTimeSeconds"))
    )
  };
}

/**
 * Linha do banco (snake_case) -> formato da API (camelCase).
 */
function rowToProgress(row) {
  if (!row) {
    return null;
  }

  return {
    playerId: row.player_id,
    currentPhase: row.current_phase,
    score: row.score,
    stars: row.stars,
    completedPhases: row.completed_phases,
    accessibility: row.accessibility,
    gameStartedAt: row.game_started_at,
    gameCompletedAt: row.game_completed_at,
    totalTimeSeconds: row.total_time_seconds
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
    game_started_at: progress.gameStartedAt,
    game_completed_at: progress.gameCompletedAt,
    total_time_seconds: progress.totalTimeSeconds,
    updated_at: new Date().toISOString()
  };
}

module.exports = {
  mergeProgress,
  rowToProgress,
  progressToRow
};