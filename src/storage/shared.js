"use strict";

/**
 * Funções comuns aos dois armazenamentos (memória e Supabase).
 */

function toPlayer(row) {
  return {
    id: row.id,
    nickname: row.nickname,
    avatar: row.avatar || "ae",
    createdAt: row.created_at || row.createdAt || null
  };
}

function toRankingRow(player, progress) {
  return {
    id: player.id,
    nickname: player.nickname,
    avatar: player.avatar || "ae",
    currentPhase: progress.currentPhase || 1,
    score: progress.score || 0,
    stars: progress.stars || 0,
    completedPhases: progress.completedPhases || [],
    totalTimeSeconds: progress.totalTimeSeconds || 0,
    gameCompletedAt: progress.gameCompletedAt || null,
    bonusCompleted: Boolean(progress.bonusCompleted),
    bonusSeal: progress.bonusSeal || null
  };
}

/**
 * Ordem do ranking: mais pontos, mais estrelas, mais fases concluídas e,
 * no empate, quem levou menos tempo.
 */
function compareRanking(a, b) {
  return (
    b.score - a.score ||
    b.stars - a.stars ||
    b.completedPhases.length - a.completedPhases.length ||
    a.totalTimeSeconds - b.totalTimeSeconds
  );
}

/**
 * Agrega os resultados por fase (usado pelo armazenamento em memória; no
 * Supabase a mesma conta é feita pela view estatisticas_fases).
 */
function aggregatePhaseStats(results) {
  const byPhase = new Map();

  results.forEach(result => {
    const phase = Number(result.phase);

    if (!byPhase.has(phase)) {
      byPhase.set(phase, {
        phase,
        totalErrors: 0,
        totalAttempts: 0,
        totalTimeSeconds: 0,
        completedCount: 0,
        resultsCount: 0
      });
    }

    const item = byPhase.get(phase);

    item.totalErrors += Number(result.errors || 0);
    item.totalAttempts += Number(result.attempts || 0);
    item.totalTimeSeconds += Number(result.timeSeconds || 0);
    item.completedCount += result.completed ? 1 : 0;
    item.resultsCount += 1;
  });

  return [...byPhase.values()].sort((a, b) => a.phase - b.phase);
}

module.exports = {
  toPlayer,
  toRankingRow,
  compareRanking,
  aggregatePhaseStats
};
