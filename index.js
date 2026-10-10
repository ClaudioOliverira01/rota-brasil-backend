const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const {
  createClient
} = require("@supabase/supabase-js");
const {
  randomUUID
} = require("crypto");
const PDFDocument = require("pdfkit");
const {
  normalizeSupabaseUrl,
  describeSupabaseConfig,
  describeCause
} = require("./supabaseDiagnostics");
const {
  mergeProgress,
  rowToProgress,
  progressToRow
} = require("./progressMerge");

dotenv.config();

const app = express();

const PORT = Number(
  process.env.PORT || 3333
);

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  "http://localhost:5173";

const SUPABASE_URL =
  normalizeSupabaseUrl(
    process.env.SUPABASE_URL
  );

const SUPABASE_ANON_KEY =
  String(
    process.env.SUPABASE_ANON_KEY || ""
  ).trim();

const SUPABASE_CONFIGURED =
  Boolean(
    SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_URL.includes(
      "SEUPROJETO"
    ) &&
    !SUPABASE_ANON_KEY.includes(
      "sua_chave"
    )
  );

/*
 * CORS
 * FRONTEND_URL aceita várias origens separadas por vírgula:
 *   FRONTEND_URL=https://rota-brasil.vercel.app,https://meu-dominio.com.br
 * ALLOW_VERCEL_PREVIEWS=true libera também https://*.vercel.app
 * (útil para testar os deploys de preview do frontend).
 */
const ALLOWED_ORIGINS =
  FRONTEND_URL
    .split(",")
    .map(item => item.trim().replace(/\/$/, ""))
    .filter(Boolean);

const ALLOW_VERCEL_PREVIEWS =
  String(process.env.ALLOW_VERCEL_PREVIEWS || "false") === "true";

function isOriginAllowed(origin) {
  if (!origin) {
    return true; // chamadas sem origem (curl, servidor)
  }

  const clean = origin.replace(/\/$/, "");

  return (
    ALLOWED_ORIGINS.includes("*") ||
    ALLOWED_ORIGINS.includes(clean) ||
    /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(clean) ||
    (
      ALLOW_VERCEL_PREVIEWS &&
      /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(clean)
    )
  );
}

app.use(
  cors({
    origin(origin, callback) {
      // false = o navegador bloqueia; não derruba a API com erro 500
      return callback(null, isOriginAllowed(origin));
    },
    exposedHeaders: ["Content-Disposition"]
  })
);

app.use(
  express.json({
    limit: "1mb"
  })
);

const supabase =
  SUPABASE_CONFIGURED
    ? createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY
      )
    : null;

const memoryPlayers =
  new Map();

const memoryProgress =
  new Map();

const memoryPhaseResults =
  [];

function normalizeNickname(
  nickname
) {
  return String(
    nickname || ""
  )
    .trim()
    .toLocaleLowerCase(
      "pt-BR"
    );
}

function validatePlayerPayload(
  body
) {
  const nickname =
    String(
      body?.nickname || ""
    ).trim();

  const avatar =
    String(
      body?.avatar || "ae"
    ).trim();

  if (!nickname) {
    return "nickname é obrigatório";
  }

  if (nickname.length > 15) {
    return "nickname deve ter no máximo 15 caracteres";
  }

  if (
    !/^[\p{L}\p{N} _-]+$/u.test(
      nickname
    )
  ) {
    return "nickname contém caracteres inválidos";
  }

  if (!avatar) {
    return "avatar é obrigatório";
  }

  return null;
}

function buildMemoryPlayer(
  nickname,
  avatar
) {
  const id =
    randomUUID();

  const player = {
    id,
    nickname,
    avatar,
    createdAt:
      new Date().toISOString()
  };

  memoryPlayers.set(
    id,
    player
  );

  memoryProgress.set(
    id,
    {
      playerId: id,
      nickname,
      avatar,
      currentPhase: 1,
      score: 0,
      stars: 0,
      completedPhases: [],
      accessibility: {
        narration: true,
        highContrast: false,
        reducedMotion: false,
        dyslexiaFont: false
      },
      gameStartedAt: null,
      gameCompletedAt: null,
      totalTimeSeconds: 0
    }
  );

  return player;
}

app.get(
  "/",
  (req, res) => {
    res.json({
      mensagem:
        "API Rota Brasil funcionando!",
      status: "ok"
    });
  }
);

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      status: "ok",
      service:
        "rota-brasil-api",
      storage:
        SUPABASE_CONFIGURED
          ? "supabase"
          : "memory"
    });
  }
);

app.get(
  "/api/teste-supabase",
  async (req, res) => {
    const diagnostico =
      describeSupabaseConfig(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY
      );

    if (!SUPABASE_CONFIGURED) {
      return res
        .status(503)
        .json({
          mensagem:
            "Supabase ainda não configurado",
          diagnostico
        });
    }

    const inicio = Date.now();

    try {
      const {
        data,
        error
      } =
        await supabase
          .from("jogadores")
          .select(
            "id,nickname,avatar"
          )
          .limit(1);

      if (error) {
        throw error;
      }

      return res.json({
        mensagem:
          "Supabase conectado com sucesso!",
        tempoMs:
          Date.now() - inicio,
        diagnostico,
        dados: data
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          mensagem:
            "Erro ao consultar o Supabase",
          erro: error.message,
          causa:
            describeCause(error),
          diagnostico
        });
    }
  }
);

app.post(
  "/api/players",
  async (
    req,
    res,
    next
  ) => {
    try {
      const validationError =
        validatePlayerPayload(
          req.body
        );

      if (validationError) {
        return res
          .status(400)
          .json({
            error:
              validationError
          });
      }

      const nickname =
        String(
          req.body.nickname
        ).trim();

      const avatar =
        String(
          req.body.avatar ||
            "ae"
        ).trim();

      const nicknameNormalized =
        normalizeNickname(
          nickname
        );

      if (
        !SUPABASE_CONFIGURED
      ) {
        for (
          const player of
          memoryPlayers.values()
        ) {
          if (
            normalizeNickname(
              player.nickname
            ) ===
            nicknameNormalized
          ) {
            return res
              .status(409)
              .json({
                error:
                  "Esse apelido já está sendo utilizado. Tente outro."
              });
          }
        }

        return res
          .status(201)
          .json(
            buildMemoryPlayer(
              nickname,
              avatar
            )
          );
      }

      const playerId =
        randomUUID();

      const {
        data,
        error
      } =
        await supabase
          .from("jogadores")
          .insert({
            id: playerId,
            nickname,
            nickname_normalized:
              nicknameNormalized,
            avatar
          })
          .select(
            "id,nickname,avatar"
          )
          .single();

      if (error) {
        if (
          error.code ===
          "23505"
        ) {
          return res
            .status(409)
            .json({
              error:
                "Esse apelido já está sendo utilizado. Tente outro."
            });
        }

        throw error;
      }

      return res
        .status(201)
        .json(data);
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  "/api/players/by-nickname/:nickname",
  async (
    req,
    res,
    next
  ) => {
    try {
      const normalized =
        normalizeNickname(
          decodeURIComponent(
            req.params.nickname
          )
        );

      if (
        !SUPABASE_CONFIGURED
      ) {
        const player =
          [
            ...memoryPlayers.values()
          ].find(
            p =>
              normalizeNickname(
                p.nickname
              ) ===
              normalized
          );

        if (!player) {
          return res
            .status(404)
            .json({
              error:
                "Jogador não encontrado"
            });
        }

        return res.json({
          ...player,
          progress:
            memoryProgress.get(
              player.id
            ) || null
        });
      }

      const {
        data: player,
        error
      } =
        await supabase
          .from("jogadores")
          .select(
            "id,nickname,avatar,created_at"
          )
          .eq(
            "nickname_normalized",
            normalized
          )
          .maybeSingle();

      if (error) {
        throw error;
      }

      if (!player) {
        return res
          .status(404)
          .json({
            error:
              "Jogador não encontrado"
          });
      }

      const {
        data: progress,
        error:
          progressError
      } =
        await supabase
          .from(
            "progresso_jogadores"
          )
          .select(
            "player_id,current_phase,score,stars,completed_phases,accessibility,game_started_at,game_completed_at,total_time_seconds"
          )
          .eq(
            "player_id",
            player.id
          )
          .maybeSingle();

      if (progressError) {
        throw progressError;
      }

      return res.json({
        id: player.id,
        nickname:
          player.nickname,
        avatar:
          player.avatar,
        progress:
          progress
            ? {
                playerId:
                  progress.player_id,
                currentPhase:
                  progress.current_phase,
                score:
                  progress.score,
                stars:
                  progress.stars,
                completedPhases:
                  progress.completed_phases ||
                  [],
                accessibility:
                  progress.accessibility ||
                  {},
                gameStartedAt:
                  progress.game_started_at,
                gameCompletedAt:
                  progress.game_completed_at,
                totalTimeSeconds:
                  progress.total_time_seconds ||
                  0
              }
            : null
      });
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  "/api/players/:playerId/progress",
  async (
    req,
    res,
    next
  ) => {
    try {
      const {
        playerId
      } = req.params;

      if (
        !SUPABASE_CONFIGURED
      ) {
        const progress =
          memoryProgress.get(
            playerId
          );

        if (!progress) {
          return res
            .status(404)
            .json({
              error:
                "Jogador não encontrado"
            });
        }

        return res.json(
          progress
        );
      }

      const {
        data,
        error
      } =
        await supabase
          .from(
            "progresso_jogadores"
          )
          .select(
            "player_id,current_phase,score,stars,completed_phases,accessibility,game_started_at,game_completed_at,total_time_seconds"
          )
          .eq(
            "player_id",
            playerId
          )
          .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        return res.json({
          playerId,
          currentPhase: 1,
          score: 0,
          stars: 0,
          completedPhases: [],
          accessibility: {
            narration: true,
            highContrast: false,
            reducedMotion: false,
            dyslexiaFont: false
          },
          gameStartedAt: null,
          gameCompletedAt: null,
          totalTimeSeconds: 0
        });
      }

      return res.json({
        playerId:
          data.player_id,
        currentPhase:
          data.current_phase,
        score:
          data.score,
        stars:
          data.stars,
        completedPhases:
          data.completed_phases ||
          [],
        accessibility:
          data.accessibility ||
          {},
        gameStartedAt:
          data.game_started_at,
        gameCompletedAt:
          data.game_completed_at,
        totalTimeSeconds:
          data.total_time_seconds ||
          0
      });
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/progress",
  async (
    req,
    res,
    next
  ) => {
    try {
      const incoming =
        req.body || {};

      const playerId =
        String(
          incoming.playerId || ""
        ).trim();

      if (!playerId) {
        return res
          .status(400)
          .json({
            error:
              "playerId é obrigatório"
          });
      }

      if (
        !SUPABASE_CONFIGURED
      ) {
        const player =
          memoryPlayers.get(
            playerId
          );

        if (!player) {
          return res
            .status(404)
            .json({
              error:
                "Jogador não encontrado"
            });
        }

        const merged =
          mergeProgress(
            memoryProgress.get(
              playerId
            ),
            {
              ...incoming,
              playerId
            }
          );

        merged.nickname =
          merged.nickname ||
          player.nickname;

        merged.avatar =
          merged.avatar ||
          player.avatar;

        memoryProgress.set(
          playerId,
          merged
        );

        return res.json(
          merged
        );
      }

      const {
        data: currentRow,
        error: readError
      } =
        await supabase
          .from(
            "progresso_jogadores"
          )
          .select(
            "player_id,current_phase,score,stars,completed_phases,accessibility,game_started_at,game_completed_at,total_time_seconds"
          )
          .eq(
            "player_id",
            playerId
          )
          .maybeSingle();

      if (readError) {
        throw readError;
      }

      const merged =
        mergeProgress(
          rowToProgress(
            currentRow
          ),
          {
            ...incoming,
            playerId
          }
        );

      const {
        error
      } =
        await supabase
          .from(
            "progresso_jogadores"
          )
          .upsert(
            progressToRow(
              merged
            ),
            {
              onConflict:
                "player_id"
            }
          );

      if (error) {
        throw error;
      }

      return res.json(
        merged
      );
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/progress/phases",
  async (
    req,
    res,
    next
  ) => {
    try {
      const playerId =
        String(
          req.body?.playerId ||
            ""
        );

      const phase =
        Number(
          req.body?.phase || 0
        );

      const score =
        Number(
          req.body?.score || 0
        );

      const stars =
        Number(
          req.body?.stars || 0
        );

      const completed =
        Boolean(
          req.body?.completed
        );

      const errors =
        Math.max(
          0,
          Number(
            req.body?.errors ||
              0
          )
        );

      const attempts =
        Math.max(
          0,
          Number(
            req.body?.attempts ||
              0
          )
        );

      const timeSeconds =
        Math.max(
          0,
          Number(
            req.body
              ?.timeSeconds ||
              0
          )
        );

      if (
        !playerId ||
        !phase
      ) {
        return res
          .status(400)
          .json({
            error:
              "playerId e phase são obrigatórios"
          });
      }

      if (
        !SUPABASE_CONFIGURED
      ) {
        if (
          !memoryPlayers.has(
            playerId
          )
        ) {
          return res
            .status(404)
            .json({
              error:
                "Jogador não encontrado"
            });
        }

        const result = {
          id: randomUUID(),
          playerId,
          phase,
          score,
          stars,
          completed,
          errors,
          attempts,
          timeSeconds,
          createdAt:
            new Date().toISOString()
        };

        memoryPhaseResults.push(
          result
        );

        return res
          .status(201)
          .json(result);
      }

      const {
        data,
        error
      } =
        await supabase
          .from(
            "resultados_fases"
          )
          .insert({
            player_id:
              playerId,
            phase,
            score,
            stars,
            completed,
            errors,
            attempts,
            time_seconds:
              timeSeconds
          })
          .select(
            "id,player_id,phase,score,stars,completed,errors,attempts,time_seconds,created_at"
          )
          .single();

      if (error) {
        throw error;
      }

      return res
        .status(201)
        .json({
          id: data.id,
          playerId:
            data.player_id,
          phase:
            data.phase,
          score:
            data.score,
          stars:
            data.stars,
          completed:
            data.completed,
          errors:
            data.errors,
          attempts:
            data.attempts,
          timeSeconds:
            data.time_seconds,
          createdAt:
            data.created_at
        });
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  "/api/ranking",
  async (
    req,
    res,
    next
  ) => {
    try {
      const limit =
        Math.max(
          1,
          Math.min(
            50,
            Number(
              req.query.limit ||
                10
            )
          )
        );

      if (
        !SUPABASE_CONFIGURED
      ) {
        const rows =
          [
            ...memoryPlayers.values()
          ].map(
            player => ({
              id: player.id,
              nickname:
                player.nickname,
              avatar:
                player.avatar,
              ...(
                memoryProgress.get(
                  player.id
                ) || {}
              )
            })
          );

        rows.sort(
          (a, b) =>
            Number(
              b.score || 0
            ) -
              Number(
                a.score || 0
              ) ||
            Number(
              b.stars || 0
            ) -
              Number(
                a.stars || 0
              ) ||
            (
              b.completedPhases
                ?.length ||
              0
            ) -
              (
                a.completedPhases
                  ?.length ||
                0
              ) ||
            Number(
              a.totalTimeSeconds ||
                0
            ) -
              Number(
                b.totalTimeSeconds ||
                  0
              )
        );

        return res.json(
          rows.slice(
            0,
            limit
          )
        );
      }

      const [
        {
          data: players,
          error:
            playersError
        },
        {
          data: progress,
          error:
            progressError
        }
      ] =
        await Promise.all([
          supabase
            .from("jogadores")
            .select(
              "id,nickname,avatar,created_at"
            ),

          supabase
            .from(
              "progresso_jogadores"
            )
            .select(
              "player_id,current_phase,score,stars,completed_phases,total_time_seconds,game_completed_at"
            )
        ]);

      if (playersError) {
        throw playersError;
      }

      if (progressError) {
        throw progressError;
      }

      const progressByPlayer =
        new Map(
          (
            progress || []
          ).map(
            row => [
              row.player_id,
              row
            ]
          )
        );

      const rows =
        (
          players || []
        ).map(
          player => {
            const p =
              progressByPlayer.get(
                player.id
              ) || {};

            return {
              id:
                player.id,
              nickname:
                player.nickname,
              avatar:
                player.avatar,
              currentPhase:
                p.current_phase ||
                1,
              score:
                p.score || 0,
              stars:
                p.stars || 0,
              completedPhases:
                p.completed_phases ||
                [],
              totalTimeSeconds:
                p.total_time_seconds ||
                0,
              gameCompletedAt:
                p.game_completed_at ||
                null
            };
          }
        );

      rows.sort(
        (a, b) =>
          Number(
            b.score
          ) -
            Number(
              a.score
            ) ||
          Number(
            b.stars
          ) -
            Number(
              a.stars
            ) ||
          b.completedPhases
            .length -
            a.completedPhases
              .length ||
          Number(
            a.totalTimeSeconds
          ) -
            Number(
              b.totalTimeSeconds
            )
      );

      return res.json(
        rows.slice(
          0,
          limit
        )
      );
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  "/api/stats/phases",
  async (
    req,
    res,
    next
  ) => {
    try {
      let rows;

      if (
        !SUPABASE_CONFIGURED
      ) {
        rows =
          memoryPhaseResults;
      } else {
        const {
          data,
          error
        } =
          await supabase
            .from(
              "resultados_fases"
            )
            .select(
              "phase,errors,attempts,time_seconds,completed"
            );

        if (error) {
          throw error;
        }

        rows =
          data || [];
      }

      const aggregate =
        new Map();

      rows.forEach(
        row => {
          const phase =
            Number(
              row.phase
            );

          if (
            !aggregate.has(
              phase
            )
          ) {
            aggregate.set(
              phase,
              {
                phase,
                totalErrors: 0,
                totalAttempts: 0,
                totalTimeSeconds: 0,
                completedCount: 0
              }
            );
          }

          const item =
            aggregate.get(
              phase
            );

          item.totalErrors +=
            Number(
              row.errors ||
                0
            );

          item.totalAttempts +=
            Number(
              row.attempts ||
                0
            );

          item.totalTimeSeconds +=
            Number(
              row.time_seconds ||
                row.timeSeconds ||
                0
            );

          if (
            row.completed
          ) {
            item.completedCount +=
              1;
          }
        }
      );

      const phases =
        [
          ...aggregate.values()
        ].sort(
          (a, b) =>
            a.phase -
            b.phase
        );

      const mostErrors =
        phases.reduce(
          (
            best,
            item
          ) =>
            !best ||
            item.totalErrors >
              best.totalErrors
              ? item
              : best,
          null
        );

      return res.json({
        phases,
        mostErrorsPhase:
          mostErrors?.phase ||
          null
      });
    } catch (error) {
      next(error);
    }
  }
);

/*
 * ============================================================
 * RELATÓRIO DE DESEMPENHO EM PDF
 * ============================================================
 */

async function getReportData(
  playerId
) {
  if (
    !SUPABASE_CONFIGURED
  ) {
    const player =
      memoryPlayers.get(
        playerId
      );

    if (!player) {
      return null;
    }

    const progress =
      memoryProgress.get(
        playerId
      ) || {};

    const results =
      memoryPhaseResults.filter(
        item =>
          item.playerId ===
          playerId
      );

    return {
      player,
      progress,
      results
    };
  }

  const {
    data: player,
    error:
      playerError
  } =
    await supabase
      .from("jogadores")
      .select(
        "id,nickname,avatar,created_at"
      )
      .eq(
        "id",
        playerId
      )
      .maybeSingle();

  if (playerError) {
    throw playerError;
  }

  if (!player) {
    return null;
  }

  const {
    data: progress,
    error:
      progressError
  } =
    await supabase
      .from(
        "progresso_jogadores"
      )
      .select(
        "player_id,current_phase,score,stars,completed_phases,accessibility,game_started_at,game_completed_at,total_time_seconds"
      )
      .eq(
        "player_id",
        playerId
      )
      .maybeSingle();

  if (progressError) {
    throw progressError;
  }

  const {
    data: results,
    error:
      resultsError
  } =
    await supabase
      .from(
        "resultados_fases"
      )
      .select(
        "id,player_id,phase,score,stars,completed,errors,attempts,time_seconds,created_at"
      )
      .eq(
        "player_id",
        playerId
      )
      .order(
        "phase",
        {
          ascending: true
        }
      );

  if (resultsError) {
    throw resultsError;
  }

  return {
    player,
    progress:
      progress || {},
    results:
      results || []
  };
}

function formatDuration(
  seconds
) {
  const total =
    Math.max(
      0,
      Number(
        seconds || 0
      )
    );

  const minutes =
    Math.floor(
      total / 60
    );

  const secs =
    Math.floor(
      total % 60
    );

  return `${minutes}min ${String(
    secs
  ).padStart(2, "0")}s`;
}

function safePdfText(
  value
) {
  return String(
    value ?? ""
  )
    .replace(
      /[^\x20-\x7EÀ-ÿ]/g,
      ""
    );
}

app.get(
  "/api/reports/:playerId/pdf",
  async (
    req,
    res,
    next
  ) => {
    try {
      const {
        playerId
      } = req.params;

      if (!playerId) {
        return res
          .status(400)
          .json({
            error:
              "playerId é obrigatório"
          });
      }

      const report =
        await getReportData(
          playerId
        );

      if (!report) {
        return res
          .status(404)
          .json({
            error:
              "Jogador não encontrado"
          });
      }

      const player =
        report.player;

      const progress =
        report.progress ||
        {};

      const results =
        Array.isArray(
          report.results
        )
          ? report.results
          : [];

      const doc =
        new PDFDocument({
          size: "A4",
          margin: 50,
          info: {
            Title:
              "Relatório de Desempenho - Rota Brasil",
            Author:
              "Rota Brasil: A Expedição de Aê",
            Subject:
              "Relatório de desempenho do jogador"
          }
        });

      const filename =
        `relatorio-rota-brasil-${String(
          player.nickname || "jogador"
        )
          .replace(
            /[^a-zA-Z0-9_-]/g,
            "_"
          )
          .toLowerCase()}.pdf`;

      res.setHeader(
        "Content-Type",
        "application/pdf"
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );

      doc.pipe(res);

      doc
        .fontSize(24)
        .fillColor("#07543d")
        .text(
          "ROTA BRASIL",
          {
            align: "center"
          }
        );

      doc
        .fontSize(16)
        .fillColor("#18332c")
        .text(
          "A Expedição de Aê",
          {
            align: "center"
          }
        );

      doc.moveDown();

      doc
        .fontSize(18)
        .fillColor("#07543d")
        .text(
          "RELATÓRIO DE DESEMPENHO",
          {
            align: "center"
          }
        );

      doc.moveDown();

      doc
        .fontSize(12)
        .fillColor("#222222")
        .text(
          `Jogador: ${safePdfText(
            player.nickname ||
              "Explorador"
          )}`
        );

      doc.text(
        `Avatar: ${safePdfText(
          player.avatar ||
            "ae"
        )}`
      );

      doc.text(
        `Fase atual: ${
          progress.current_phase ||
          progress.currentPhase ||
          1
        }`
      );

      doc.moveDown();

      doc
        .fontSize(16)
        .fillColor("#07543d")
        .text(
          "RESUMO DA EXPEDIÇÃO"
        );

      doc.moveDown(0.5);

      doc
        .fontSize(12)
        .fillColor("#222222")
        .text(
          `Pontuação: ${
            progress.score ||
            0
          } pontos`
        );

      doc.text(
        `Estrelas: ${
          progress.stars ||
          0
        }`
      );

      doc.text(
        `Fases concluídas: ${
          Array.isArray(
            progress.completed_phases
          )
            ? progress.completed_phases.length
            : Array.isArray(
                progress.completedPhases
              )
              ? progress.completedPhases
                  .length
              : 0
        }`
      );

      doc.text(
        `Tempo total: ${formatDuration(
          progress.total_time_seconds ||
            progress.totalTimeSeconds ||
            0
        )}`
      );

      doc.moveDown();

      doc
        .fontSize(16)
        .fillColor("#07543d")
        .text(
          "RESULTADOS POR FASE"
        );

      doc.moveDown(0.5);

      if (!results.length) {
        doc
          .fontSize(12)
          .fillColor("#555555")
          .text(
            "Ainda não existem resultados detalhados registrados."
          );
      } else {
        results.forEach(
          result => {
            const phase =
              result.phase;

            const score =
              result.score ||
              0;

            const stars =
              result.stars ||
              0;

            const errors =
              result.errors ||
              0;

            const attempts =
              result.attempts ||
              0;

            const timeSeconds =
              result.time_seconds ||
              result.timeSeconds ||
              0;

            doc
              .fontSize(14)
              .fillColor("#07543d")
              .text(
                `Fase ${phase}`
              );

            doc
              .fontSize(11)
              .fillColor("#222222")
              .text(
                `Resultado: ${
                  result.completed
                    ? "Concluída"
                    : "Não concluída"
                }`
              );

            doc.text(
              `Pontuação: ${score}`
            );

            doc.text(
              `Estrelas: ${stars}`
            );

            doc.text(
              `Tentativas: ${attempts}`
            );

            doc.text(
              `Erros: ${errors}`
            );

            doc.text(
              `Tempo: ${formatDuration(
                timeSeconds
              )}`
            );

            doc.moveDown(
              0.8
            );
          }
        );
      }

      doc.moveDown();

      doc
        .fontSize(16)
        .fillColor("#07543d")
        .text(
          "ACESSIBILIDADE UTILIZADA"
        );

      doc.moveDown(0.5);

      const accessibility =
        progress.accessibility ||
        {};

      doc
        .fontSize(11)
        .fillColor("#222222")
        .text(
          `Narração: ${
            accessibility.narration
              ? "Ativada"
              : "Desativada"
          }`
        );

      doc.text(
        `Alto contraste: ${
          accessibility.highContrast
            ? "Ativado"
            : "Desativado"
        }`
      );

      doc.text(
        `Movimentos reduzidos: ${
          accessibility.reducedMotion
            ? "Ativado"
            : "Desativado"
        }`
      );

      doc.text(
        `Fonte para dislexia: ${
          accessibility.dyslexiaFont
            ? "Ativada"
            : "Desativada"
        }`
      );

      doc.moveDown(2);

      doc
        .fontSize(9)
        .fillColor("#666666")
        .text(
          "Relatório gerado automaticamente pelo sistema Rota Brasil.",
          {
            align: "center"
          }
        );

      doc.end();
    } catch (error) {
      next(error);
    }
  }
);

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "[API ERROR]",
      error
    );

    if (
      res.headersSent
    ) {
      return next(
        error
      );
    }

    res
      .status(500)
      .json({
        error:
          "Erro interno do servidor",
        detail:
          error.message,
        causa:
          describeCause(error)
      });
  }
);

if (!process.env.VERCEL) {
  app.listen(
    PORT,
    () => {
      console.log(
        `Servidor rodando em http://localhost:${PORT}`
      );

      console.log(
        `Armazenamento: ${
          SUPABASE_CONFIGURED
            ? "Supabase"
            : "memória local (fallback de desenvolvimento)"
        }`
      );
    }
  );
}

// A Vercel executa o app como função serverless: precisa exportá-lo.
module.exports = app;