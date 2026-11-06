"use strict";

const express = require("express");

const { describeSupabaseConfig, describeCause } = require("../supabaseDiagnostics");

/**
 *  GET /                      mensagem simples
 *  GET /api/health            estado da API (?deep=1 também consulta o banco)
 *  GET /api/teste-supabase    diagnóstico da conexão com o Supabase
 */
function systemRouter({ config, store }) {
  const router = express.Router();

  router.get("/", (req, res) => {
    res.json({ mensagem: "API Rota Brasil funcionando!", status: "ok" });
  });

  router.get("/api/health", async (req, res) => {
    const body = {
      status: config.storage === "unavailable" ? "degraded" : "ok",
      service: "rota-brasil-api",
      storage: config.storage,
      // Ajuda a achar erro de CORS: a URL do site precisa estar nesta lista.
      cors: {
        origensPermitidas: config.frontendUrls,
        previewsDaVercel: config.allowVercelPreviews
      }
    };

    if (req.query.deep === "1" || req.query.deep === "true") {
      try {
        await store.ping();
        body.database = "ok";
      } catch (error) {
        body.status = "degraded";
        body.database = "error";
        body.detail = error.message;
      }
    }

    res.status(body.status === "ok" ? 200 : 503).json(body);
  });

  router.get("/api/teste-supabase", async (req, res) => {
    const diagnostico = {
      ...describeSupabaseConfig(config.supabase.rawUrl, config.supabase.key),
      chaveUsada: config.supabase.keyKind
    };

    if (config.storage !== "supabase") {
      return res.status(503).json({ mensagem: "Supabase ainda não configurado", diagnostico });
    }

    const inicio = Date.now();

    try {
      await store.ping();

      return res.json({
        mensagem: "Supabase conectado com sucesso!",
        tempoMs: Date.now() - inicio,
        diagnostico
      });
    } catch (error) {
      return res.status(500).json({
        mensagem: "Erro ao consultar o Supabase",
        erro: error.message,
        causa: describeCause(error),
        diagnostico
      });
    }
  });

  return router;
}

module.exports = { systemRouter };