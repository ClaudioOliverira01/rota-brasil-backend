"use strict";

const { randomUUID } = require("crypto");

const { conflict, NICKNAME_TAKEN } = require("../errors");
const { defaultProgress } = require("../progressMerge");
const { normalizeNickname } = require("../validation");
const {
  toPlayer,
  toRankingRow,
  compareRanking,
  aggregatePhaseStats
} = require("./shared");

/**
 * Armazenamento em memória: SÓ para desenvolvimento local e testes.
 * Os dados somem quando o servidor reinicia. Em produção a API exige o
 * Supabase (ver config.js).
 */
function createMemoryStore() {
  const players = new Map();
  const progress = new Map();
  let results = [];

  function ensureUniqueNickname(nicknameNormalized, ignoreId = null) {
    for (const player of players.values()) {
      if (player.id !== ignoreId && normalizeNickname(player.nickname) === nicknameNormalized) {
        throw conflict(NICKNAME_TAKEN);
      }
    }
  }

  return {
    kind: "memory",

    async ping() {
      return { players: players.size };
    },

    async createPlayer({ nickname, nicknameNormalized, avatar }) {
      ensureUniqueNickname(nicknameNormalized);

      const player = {
        id: randomUUID(),
        nickname,
        avatar,
        createdAt: new Date().toISOString()
      };

      players.set(player.id, player);
      progress.set(player.id, defaultProgress(player.id));

      return toPlayer(player);
    },

    async findPlayerById(id) {
      const player = players.get(id);
      return player ? toPlayer(player) : null;
    },

    async findPlayerByNickname(nicknameNormalized) {
      const player = [...players.values()].find(
        item => normalizeNickname(item.nickname) === nicknameNormalized
      );

      return player ? toPlayer(player) : null;
    },

    async updatePlayer(id, changes) {
      const player = players.get(id);

      if (!player) {
        return null;
      }

      if (changes.nicknameNormalized) {
        ensureUniqueNickname(changes.nicknameNormalized, id);
      }

      if (changes.nickname) {
        player.nickname = changes.nickname;
      }

      if (changes.avatar) {
        player.avatar = changes.avatar;
      }

      return toPlayer(player);
    },

    async deletePlayer(id) {
      const existed = players.delete(id);

      progress.delete(id);
      results = results.filter(item => item.playerId !== id);

      return existed;
    },

    async getProgress(playerId) {
      const saved = progress.get(playerId);
      return saved ? structuredClone(saved) : null;
    },

    async saveProgress(next) {
      progress.set(next.playerId, structuredClone(next));
      return structuredClone(next);
    },

    async resetProgress(playerId) {
      const fresh = defaultProgress(playerId);

      progress.set(playerId, fresh);
      results = results.filter(item => item.playerId !== playerId);

      return structuredClone(fresh);
    },

    async addPhaseResult(result) {
      const saved = {
        id: randomUUID(),
        ...result,
        createdAt: new Date().toISOString()
      };

      results.push(saved);

      return { ...saved };
    },

    async listPhaseResults(playerId) {
      return results
        .filter(item => item.playerId === playerId)
        .sort((a, b) => a.phase - b.phase || a.createdAt.localeCompare(b.createdAt))
        .map(item => ({ ...item }));
    },

    async getRanking(limit) {
      return [...players.values()]
        .map(player => toRankingRow(player, progress.get(player.id) || defaultProgress(player.id)))
        .sort(compareRanking)
        .slice(0, limit);
    },

    async getPhaseStats() {
      return aggregatePhaseStats(results);
    }
  };
}

module.exports = { createMemoryStore };
