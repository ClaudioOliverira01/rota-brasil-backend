"use strict";

const express = require("express");

const { badRequest, notFound } = require("../errors");
const { defaultProgress } = require("../progressMerge");
const {
  normalizeNickname,
  parsePlayerId,
  validatePlayerCreate,
  validatePlayerUpdate
} = require("../validation");

/**
 * /api/players
 *  POST   /                        cria jogador
 *  GET    /?nickname=x             busca pelo apelido: [jogador] ou [] (usada pelo jogo)
 *  GET    /by-nickname/:nickname   busca pelo apelido: jogador ou 404 (compatibilidade)
 *  GET    /:playerId               jogador + progresso
 *  PATCH  /:playerId               altera avatar e/ou apelido
 *  DELETE /:playerId               remove jogador, progresso e resultados
 *  GET    /:playerId/progress      progresso
 *  DELETE /:playerId/progress      "começar do zero": zera progresso e resultados
 */
function playersRouter(store) {
  const router = express.Router();

  async function withProgress(player) {
    return {
      ...player,
      progress: (await store.getProgress(player.id)) || defaultProgress(player.id)
    };
  }

  async function requirePlayer(rawId) {
    const playerId = parsePlayerId(rawId);
    const player = await store.findPlayerById(playerId);

    if (!player) {
      throw notFound();
    }

    return player;
  }

  router.post("/", async (req, res) => {
    const data = validatePlayerCreate(req.body);
    const player = await store.createPlayer(data);

    res.status(201).json(player);
  });

  // Busca: devolve [] quando não acha (apelido livre não é erro).
  router.get("/", async (req, res) => {
    if (typeof req.query.nickname !== "string" || !req.query.nickname.trim()) {
      throw badRequest("Informe ?nickname= para buscar");
    }

    const player = await store.findPlayerByNickname(normalizeNickname(req.query.nickname));

    res.json(player ? [await withProgress(player)] : []);
  });

  router.get("/by-nickname/:nickname", async (req, res) => {
    const player = await store.findPlayerByNickname(normalizeNickname(req.params.nickname));

    if (!player) {
      throw notFound();
    }

    res.json(await withProgress(player));
  });

  router.get("/:playerId", async (req, res) => {
    res.json(await withProgress(await requirePlayer(req.params.playerId)));
  });

  router.patch("/:playerId", async (req, res) => {
    const playerId = parsePlayerId(req.params.playerId);
    const changes = validatePlayerUpdate(req.body);
    const player = await store.updatePlayer(playerId, changes);

    if (!player) {
      throw notFound();
    }

    res.json(player);
  });

  router.delete("/:playerId", async (req, res) => {
    const removed = await store.deletePlayer(parsePlayerId(req.params.playerId));

    if (!removed) {
      throw notFound();
    }

    res.status(204).end();
  });

  router.get("/:playerId/progress", async (req, res) => {
    const player = await requirePlayer(req.params.playerId);

    res.json((await store.getProgress(player.id)) || defaultProgress(player.id));
  });

  router.delete("/:playerId/progress", async (req, res) => {
    const player = await requirePlayer(req.params.playerId);

    res.json(await store.resetProgress(player.id));
  });

  return router;
}

module.exports = { playersRouter };
