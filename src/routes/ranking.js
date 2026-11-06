"use strict";

const express = require("express");

const { parseLimit } = require("../validation");

/**
 *  GET /api/ranking?limit=10   melhores jogadores
 *  GET /api/stats/phases       erros e tentativas somados por fase
 */
function rankingRouter(store) {
  const router = express.Router();

  router.get("/ranking", async (req, res) => {
    res.json(await store.getRanking(parseLimit(req.query.limit)));
  });

  router.get("/stats/phases", async (req, res) => {
    const phases = await store.getPhaseStats();

    const hardest = phases.reduce(
      (best, item) => (item.totalErrors > (best?.totalErrors ?? 0) ? item : best),
      null
    );

    res.json({
      phases,
      mostErrorsPhase: hardest ? hardest.phase : null
    });
  });

  return router;
}

module.exports = { rankingRouter };
