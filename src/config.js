"use strict";

const { normalizeSupabaseUrl } = require("./supabaseDiagnostics");

/**
 * Configuração da API, lida das variáveis de ambiente (.env).
 * Nenhuma chave é exposta em logs ou respostas.
 */

function isPlaceholder(value) {
  return /SEUPROJETO|sua_chave|SUA_CHAVE/i.test(String(value || ""));
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

/**
 * Origens do frontend sempre aceitas, mesmo sem FRONTEND_URL configurada na
 * Vercel. Sem isso o navegador bloqueia as chamadas do site publicado e o
 * ranking cai no modo "só este aparelho". São endereços públicos.
 * FRONTEND_URL só ACRESCENTA origens (por exemplo, um domínio próprio).
 */
const DEFAULT_FRONTEND_URLS = [
  "http://localhost:5173",
  "https://rota-brasil-lemon.vercel.app"
];

function loadConfig(env = process.env) {
  const supabaseUrl = normalizeSupabaseUrl(env.SUPABASE_URL);

  // Preferência: chave secreta (service_role). Compatível com a chave anon.
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const anonKey = String(env.SUPABASE_ANON_KEY || "").trim();
  const supabaseKey = serviceKey || anonKey;

  const supabaseConfigured = Boolean(
    supabaseUrl &&
      supabaseKey &&
      !isPlaceholder(supabaseUrl) &&
      !isPlaceholder(supabaseKey)
  );

  const isProduction = env.NODE_ENV === "production" || Boolean(env.VERCEL);

  // Memória só serve para desenvolvimento: em produção (Vercel) cada
  // execução pode começar do zero e os jogadores "sumiriam".
  const allowMemory =
    env.ALLOW_MEMORY_STORAGE !== undefined
      ? env.ALLOW_MEMORY_STORAGE === "true"
      : !isProduction;

  let storage = "unavailable";

  if (supabaseConfigured) {
    storage = "supabase";
  } else if (allowMemory) {
    storage = "memory";
  }

  return {
    port: Number(env.PORT || 3333),
    isProduction,
    frontendUrls: [...new Set([...DEFAULT_FRONTEND_URLS, ...splitList(env.FRONTEND_URL)])],
    allowVercelPreviews: env.ALLOW_VERCEL_PREVIEWS === "true",
    storage,
    supabase: {
      url: supabaseUrl,
      key: supabaseKey,
      keyKind: serviceKey ? "service_role" : anonKey ? "anon" : null,
      configured: supabaseConfigured,
      rawUrl: env.SUPABASE_URL
    }
  };
}

module.exports = { loadConfig };