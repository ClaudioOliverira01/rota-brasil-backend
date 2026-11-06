"use strict";

const express = require("express");

const { notFound } = require("../errors");
const { defaultProgress } = require("../progressMerge");
const { parsePlayerId } = require("../validation");
const { buildPerformancePdf, reportFilename } = require("../reports/performancePdf");

/**
 *  GET /api/reports/:playerId/pdf   relatório de desempenho em PDF
 */
function reportsRouter(store) {
  const router = express.Router();

  router.get("/:playerId/pdf", async (req, res) => {
    const playerId = parsePlayerId(req.params.playerId);
    const player = await store.findPlayerById(playerId);

    if (!player) {
      throw notFound();
    }

    const [progress, results] = await Promise.all([
      store.getProgress(playerId),
      store.listPhaseResults(playerId)
    ]);

    const pdf = await buildPerformancePdf({
      player,
      progress: progress || defaultProgress(playerId),
      results
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdf.length);
    res.setHeader("Content-Disposition", `attachment; filename="${reportFilename(player.nickname)}"`);
    res.end(pdf);
  });

  return router;
}

module.exports = { reportsRouter };
