"use strict";

const express = require("express");

const { notFound } = require("../errors");
const { mergeProgress } = require("../progressMerge");
const { validatePhaseResult, validateProgressPayload } = require("../validation");

/**
 * /api/progress
 *  POST /         salva o progresso (consolidado: nunca regride; reset: true zera)
 *  POST /phases   registra o resultado de uma fase concluída
 */
function progressRouter(store) {
  const router = express.Router();

  async function ensurePlayer(playerId) {
    if (!(await store.findPlayerById(playerId))) {
      throw notFound();
    }
  }

  router.post("/", async (req, res) => {
    const incoming = validateProgressPayload(req.body);

    await ensurePlayer(incoming.playerId);

    const current = await store.getProgress(incoming.playerId);
    const saved = await store.saveProgress(mergeProgress(current, incoming));

    res.json(saved);
  });

  router.post("/phases", async (req, res) => {
    const result = validatePhaseResult(req.body);

    await ensurePlayer(result.playerId);

    res.status(201).json(await store.addPhaseResult(result));
  });

  return router;
}

module.exports = { progressRouter };
