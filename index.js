"use strict";

/**
 * Ponto de entrada da API Rota Brasil.
 *  - Local:  npm run dev  (ou npm start)
 *  - Vercel: o app é exportado e executado como função serverless.
 */
const dotenv = require("dotenv");

dotenv.config({ quiet: true });

const { loadConfig } = require("./src/config");
const { createStore } = require("./src/storage");
const { createApp } = require("./src/app");

const config = loadConfig();
const store = createStore(config);
const app = createApp({ config, store });

const STORAGE_LABEL = {
  supabase: "Supabase",
  memory: "memória local (somente desenvolvimento: os dados somem ao reiniciar)",
  unavailable: "NENHUM — configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY"
};

if (!process.env.VERCEL && require.main === module) {
  const server = app.listen(config.port, () => {
    console.log(`Servidor rodando em http://localhost:${config.port}`);
    console.log(`Armazenamento: ${STORAGE_LABEL[config.storage]}`);
  });

  server.on("error", error => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `A porta ${config.port} já está em uso. Feche o outro processo ou defina PORT no .env.`
      );
    } else {
      console.error("Erro ao iniciar o servidor:", error);
    }

    process.exit(1);
  });
}

// A Vercel executa o app como função serverless: precisa exportá-lo.
module.exports = app;
