"use strict";

const { randomUUID } = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const { HttpError, conflict, notFound, badRequest, NICKNAME_TAKEN } = require("../errors");
const {
  PROGRESS_COLUMNS,
  defaultProgress,
  rowToProgress,
  progressToRow
} = require("../progressMerge");
const { toPlayer, toRankingRow } = require("./shared");

/**
 * Armazenamento no Supabase (PostgreSQL).
 * Estrutura do banco: database/migrations/*.sql
 */

const PLAYER_COLUMNS = "id,nickname,avatar,created_at";
const RESULT_COLUMNS =
  "id,player_id,phase,score,stars,completed,errors,attempts,time_seconds,created_at";

/**
 * Traduz os códigos do PostgreSQL para respostas HTTP corretas
 * (antes todos viravam 500).
 */
function translate(error, { conflictMessage = NICKNAME_TAKEN } = {}) {
  if (!error) {
    return null;
  }

  // Erros do banco sempre trazem um código (SQLSTATE ou PGRSTxxx). Sem
  // código = não chegou ao banco (rede, DNS, projeto pausado, gateway fora):
  // 503, com a causa original preservada para o log.
  if (!error.code) {
    const unavailableError = new HttpError(503, "Banco de dados indisponível no momento. Tente novamente.");

    unavailableError.cause = error.cause;
    unavailableError.details = error.details;

    return unavailableError;
  }

  switch (error.code) {
    case "23505": // unique_violation
      return conflict(conflictMessage);
    case "23503": // foreign_key_violation
      return notFound();
    case "22P02": // invalid_text_representation (ex.: UUID inválido)
    case "23514": // check_violation
      return badRequest("Dados inválidos");
    case "42P01": // undefined_table
    case "42703": // undefined_column
    case "PGRST200": // relacionamento não encontrado (FK ausente)
    case "PGRST204": // coluna ausente no cache do PostgREST
    case "PGRST205": // tabela ausente
      return new HttpError(
        500,
        "Estrutura do banco desatualizada. Execute as migrations em database/migrations.",
        { code: error.code, message: error.message }
      );
    default:
      return error;
  }
}

async function run(query, options) {
  const { data, error } = await query;

  if (error) {
    throw translate(error, options);
  }

  return data;
}

function toResult(row) {
  return {
    id: row.id,
    playerId: row.player_id,
    phase: row.phase,
    score: row.score,
    stars: row.stars,
    completed: row.completed,
    errors: row.errors,
    attempts: row.attempts,
    timeSeconds: row.time_seconds,
    createdAt: row.created_at
  };
}

function createSupabaseStore({ url, key }) {
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  return {
    kind: "supabase",

    async ping() {
      const data = await run(supabase.from("jogadores").select("id").limit(1));
      return { ok: true, sample: data.length };
    },

    async createPlayer({ nickname, nicknameNormalized, avatar }) {
      // O gatilho trg_jogadores_criar_progresso cria a linha de progresso.
      const row = await run(
        supabase
          .from("jogadores")
          .insert({
            id: randomUUID(),
            nickname,
            nickname_normalized: nicknameNormalized,
            avatar
          })
          .select(PLAYER_COLUMNS)
          .single()
      );

      return toPlayer(row);
    },

    async findPlayerById(id) {
      const row = await run(
        supabase.from("jogadores").select(PLAYER_COLUMNS).eq("id", id).maybeSingle()
      );

      return row ? toPlayer(row) : null;
    },

    async findPlayerByNickname(nicknameNormalized) {
      const row = await run(
        supabase
          .from("jogadores")
          .select(PLAYER_COLUMNS)
          .eq("nickname_normalized", nicknameNormalized)
          .maybeSingle()
      );

      return row ? toPlayer(row) : null;
    },

    async updatePlayer(id, changes) {
      const patch = {};

      if (changes.nickname) {
        patch.nickname = changes.nickname;
        patch.nickname_normalized = changes.nicknameNormalized;
      }

      if (changes.avatar) {
        patch.avatar = changes.avatar;
      }

      const row = await run(
        supabase.from("jogadores").update(patch).eq("id", id).select(PLAYER_COLUMNS).maybeSingle()
      );

      return row ? toPlayer(row) : null;
    },

    async deletePlayer(id) {
      // Remove os filhos primeiro: funciona mesmo se a FK não tiver CASCADE.
      await run(supabase.from("resultados_fases").delete().eq("player_id", id));
      await run(supabase.from("progresso_jogadores").delete().eq("player_id", id));

      const rows = await run(supabase.from("jogadores").delete().eq("id", id).select("id"));

      return rows.length > 0;
    },

    async getProgress(playerId) {
      const row = await run(
        supabase
          .from("progresso_jogadores")
          .select(PROGRESS_COLUMNS)
          .eq("player_id", playerId)
          .maybeSingle()
      );

      return rowToProgress(row);
    },

    async saveProgress(progress) {
      const row = await run(
        supabase
          .from("progresso_jogadores")
          .upsert(progressToRow(progress), { onConflict: "player_id" })
          .select(PROGRESS_COLUMNS)
          .single()
      );

      return rowToProgress(row);
    },

    async resetProgress(playerId) {
      await run(supabase.from("resultados_fases").delete().eq("player_id", playerId));

      return this.saveProgress(defaultProgress(playerId));
    },

    async addPhaseResult(result) {
      const row = await run(
        supabase
          .from("resultados_fases")
          .insert({
            player_id: result.playerId,
            phase: result.phase,
            score: result.score,
            stars: result.stars,
            completed: result.completed,
            errors: result.errors,
            attempts: result.attempts,
            time_seconds: result.timeSeconds
          })
          .select(RESULT_COLUMNS)
          .single()
      );

      return toResult(row);
    },

    async listPhaseResults(playerId) {
      const rows = await run(
        supabase
          .from("resultados_fases")
          .select(RESULT_COLUMNS)
          .eq("player_id", playerId)
          .order("phase", { ascending: true })
          .order("created_at", { ascending: true })
      );

      return rows.map(toResult);
    },

    /**
     * Ordena e limita NO BANCO (antes a API baixava as tabelas inteiras,
     * e o Supabase corta respostas em 1000 linhas).
     */
    async getRanking(limit) {
      const rows = await run(
        supabase
          .from("progresso_jogadores")
          .select(`${PROGRESS_COLUMNS},jogador:jogadores!inner(${PLAYER_COLUMNS})`)
          .order("score", { ascending: false })
          .order("stars", { ascending: false })
          .order("completed_count", { ascending: false })
          .order("total_time_seconds", { ascending: true })
          .order("player_id", { ascending: true })
          .limit(limit)
      );

      return rows.map(row => toRankingRow(toPlayer(row.jogador), rowToProgress(row)));
    },

    /** Agregação feita pela view estatisticas_fases (uma linha por fase). */
    async getPhaseStats() {
      const rows = await run(
        supabase
          .from("estatisticas_fases")
          .select("phase,total_errors,total_attempts,total_time_seconds,completed_count,results_count")
          .order("phase", { ascending: true })
      );

      return rows.map(row => ({
        phase: Number(row.phase),
        totalErrors: Number(row.total_errors || 0),
        totalAttempts: Number(row.total_attempts || 0),
        totalTimeSeconds: Number(row.total_time_seconds || 0),
        completedCount: Number(row.completed_count || 0),
        resultsCount: Number(row.results_count || 0)
      }));
    }
  };
}

module.exports = { createSupabaseStore };
