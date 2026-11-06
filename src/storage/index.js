"use strict";

const { unavailable } = require("../errors");
const { createMemoryStore } = require("./memoryStore");
const { createSupabaseStore } = require("./supabaseStore");

/**
 * Escolhe o armazenamento conforme a configuração:
 *  supabase     -> banco real (produção)
 *  memory       -> só desenvolvimento/testes (dados somem ao reiniciar)
 *  unavailable  -> produção sem Supabase: as rotas respondem 503 em vez de
 *                  fingir que salvaram.
 */
function createStore(config) {
  if (config.storage === "supabase") {
    return createSupabaseStore(config.supabase);
  }

  if (config.storage === "memory") {
    return createMemoryStore();
  }

  const fail = async () => {
    throw unavailable(
      "Banco de dados não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY."
    );
  };

  return new Proxy(
    { kind: "unavailable" },
    {
      get(target, prop) {
        return prop in target ? target[prop] : fail;
      }
    }
  );
}

module.exports = { createStore };
