"use strict";

const express = require("express");
const cors = require("cors");

const { HttpError } = require("./errors");
const { describeCause } = require("./supabaseDiagnostics");
const { systemRouter } = require("./routes/system");
const { playersRouter } = require("./routes/players");
const { progressRouter } = require("./routes/progress");
const { rankingRouter } = require("./routes/ranking");
const { reportsRouter } = require("./routes/reports");

/**
 * CORS
 * FRONTEND_URL aceita várias origens separadas por vírgula:
 *   FRONTEND_URL=https://rota-brasil.vercel.app,https://meu-dominio.com.br
 * ALLOW_VERCEL_PREVIEWS=true libera também https://*.vercel.app
 * localhost/127.0.0.1 (qualquer porta) é sempre liberado para desenvolvimento.
 */
function createOriginCheck(config) {
  return function isOriginAllowed(origin) {
    if (!origin) {
      return true; // chamadas sem origem (curl, servidor)
    }

    const clean = origin.replace(/\/$/, "");

    return (
      config.frontendUrls.includes("*") ||
      config.frontendUrls.includes(clean) ||
      /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(clean) ||
      (config.allowVercelPreviews && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(clean))
    );
  };
}

function errorHandler(config, logger) {
  // Express reconhece o middleware de erro pelos 4 parâmetros.
  return (error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    // JSON malformado ou corpo grande demais (erros do express.json)
    if (error.type === "entity.parse.failed") {
      return res.status(400).json({ error: "JSON inválido no corpo da requisição" });
    }

    if (error.type === "entity.too.large") {
      return res.status(413).json({ error: "Corpo da requisição muito grande" });
    }

    if (error instanceof HttpError && error.status < 500) {
      return res.status(error.status).json({ error: error.message });
    }

    const status = error instanceof HttpError ? error.status : 500;

    logger.error("[API ERROR]", req.method, req.originalUrl, error);

    const body = {
      error: error instanceof HttpError ? error.message : "Erro interno do servidor"
    };

    // Detalhes técnicos só fora de produção.
    if (!config.isProduction) {
      body.detail = error.extra?.message || error.message;
      body.causa = describeCause(error);
    }

    return res.status(status).json(body);
  };
}

function createApp({ config, store, logger = console }) {
  const app = express();
  const isOriginAllowed = createOriginCheck(config);

  app.disable("x-powered-by");

  app.use(
    cors({
      origin(origin, callback) {
        // false = o navegador bloqueia; não derruba a API com erro 500
        callback(null, isOriginAllowed(origin));
      },
      exposedHeaders: ["Content-Disposition"]
    })
  );

  app.use(express.json({ limit: "100kb" }));

  app.use(systemRouter({ config, store }));
  app.use("/api/players", playersRouter(store));
  app.use("/api/progress", progressRouter(store));
  app.use("/api", rankingRouter(store));
  app.use("/api/reports", reportsRouter(store));

  app.use((req, res) => {
    res.status(404).json({ error: "Rota não encontrada", path: req.originalUrl });
  });

  app.use(errorHandler(config, logger));

  return app;
}

module.exports = { createApp, createOriginCheck };
