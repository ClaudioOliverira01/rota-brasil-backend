"use strict";

const { badRequest } = require("./errors");

/**
 * Validação dos dados que chegam do frontend.
 * Regras iguais às do jogo (ProgressManager.validateNickname, AVATARS).
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NICKNAME_PATTERN = /^[\p{L}\p{N} _-]+$/u;

const AVATARS = Object.freeze(["ae", "onca", "tartaruga"]);

const MAX_PHASE = 4;

function normalizeNickname(nickname) {
  return String(nickname || "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function validateNickname(raw) {
  const nickname = String(raw ?? "").trim();

  if (!nickname) {
    throw badRequest("nickname é obrigatório");
  }

  if (nickname.length < 2 || nickname.length > 15) {
    throw badRequest("nickname deve ter de 2 a 15 caracteres");
  }

  if (!NICKNAME_PATTERN.test(nickname)) {
    throw badRequest("nickname contém caracteres inválidos");
  }

  return nickname;
}

function validateAvatar(raw) {
  const avatar = String(raw ?? "").trim();

  if (!AVATARS.includes(avatar)) {
    throw badRequest(`avatar inválido. Use: ${AVATARS.join(", ")}`);
  }

  return avatar;
}

function parsePlayerId(raw, field = "playerId") {
  const value = String(raw ?? "").trim();

  if (!value) {
    throw badRequest(`${field} é obrigatório`);
  }

  if (!UUID_PATTERN.test(value)) {
    throw badRequest(`${field} inválido`);
  }

  return value;
}

/**
 * Número inteiro dentro de [min, max]. Campo ausente usa o padrão.
 * Texto, NaN ou valores fora do intervalo geram 400 (antes viravam 500).
 */
function parseInteger(body, key, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0, required = false } = {}) {
  const raw = body?.[key];

  if (raw === undefined || raw === null || raw === "") {
    if (required) {
      throw badRequest(`${key} é obrigatório`);
    }

    return fallback;
  }

  const number = Number(raw);

  if (!Number.isFinite(number)) {
    throw badRequest(`${key} deve ser um número`);
  }

  const integer = Math.floor(number);

  if (integer < min || integer > max) {
    throw badRequest(`${key} deve estar entre ${min} e ${max}`);
  }

  return integer;
}

function validatePlayerCreate(body) {
  const nickname = validateNickname(body?.nickname);
  const avatar = validateAvatar(body?.avatar ?? "ae");

  return {
    nickname,
    nicknameNormalized: normalizeNickname(nickname),
    avatar
  };
}

function validatePlayerUpdate(body) {
  const changes = {};

  if (body?.nickname !== undefined) {
    changes.nickname = validateNickname(body.nickname);
    changes.nicknameNormalized = normalizeNickname(changes.nickname);
  }

  if (body?.avatar !== undefined) {
    changes.avatar = validateAvatar(body.avatar);
  }

  if (Object.keys(changes).length === 0) {
    throw badRequest("Envie nickname e/ou avatar para atualizar");
  }

  return changes;
}

function validatePhaseResult(body) {
  return {
    playerId: parsePlayerId(body?.playerId),
    phase: parseInteger(body, "phase", { min: 1, max: MAX_PHASE, required: true }),
    score: parseInteger(body, "score", { max: 100000 }),
    stars: parseInteger(body, "stars", { max: 3 }),
    completed: body?.completed === true || body?.completed === "true",
    errors: parseInteger(body, "errors", { max: 100000 }),
    attempts: parseInteger(body, "attempts", { max: 100000 }),
    timeSeconds: parseInteger(body, "timeSeconds", { max: 60 * 60 * 24 * 30 })
  };
}

/**
 * Confere os tipos do progresso enviado. A consolidação (nunca regredir)
 * é feita depois, em progressMerge.js.
 */
function validateProgressPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Corpo da requisição inválido");
  }

  const playerId = parsePlayerId(body.playerId);

  ["currentPhase", "score", "stars"].forEach(key => {
    parseInteger(body, key, { max: key === "currentPhase" ? MAX_PHASE : 1000000 });
  });

  if (body.completedPhases !== undefined && !Array.isArray(body.completedPhases)) {
    throw badRequest("completedPhases deve ser uma lista");
  }

  if (
    body.accessibility !== undefined &&
    (typeof body.accessibility !== "object" || Array.isArray(body.accessibility) || body.accessibility === null)
  ) {
    throw badRequest("accessibility deve ser um objeto");
  }

  if (
    body.bonusSeal !== undefined &&
    body.bonusSeal !== null &&
    !["gold", "silver"].includes(body.bonusSeal)
  ) {
    throw badRequest("bonusSeal deve ser gold, silver ou null");
  }

  return { ...body, playerId };
}

function parseLimit(raw, { fallback = 10, max = 50 } = {}) {
  const number = Number(raw);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(1, Math.min(max, Math.floor(number)));
}

module.exports = {
  AVATARS,
  MAX_PHASE,
  normalizeNickname,
  parsePlayerId,
  parseLimit,
  validatePlayerCreate,
  validatePlayerUpdate,
  validatePhaseResult,
  validateProgressPayload
};
