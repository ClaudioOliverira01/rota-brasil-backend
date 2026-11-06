"use strict";

/**
 * Utilitários de configuração e diagnóstico do Supabase.
 * Nunca devolvem a chave: só informações seguras para depuração.
 */

/**
 * Remove espaços/quebras de linha, barras finais e o sufixo /rest/v1,
 * erros comuns ao colar a URL no painel da Vercel.
 */
function normalizeSupabaseUrl(rawUrl) {
  return String(rawUrl || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/rest\/v1$/i, "");
}

function hasWhitespace(value) {
  return /\s/.test(String(value || ""));
}

/**
 * Resume a configuração sem expor segredos.
 */
function describeSupabaseConfig(rawUrl, rawKey) {
  const url = String(rawUrl || "");
  const key = String(rawKey || "");
  const normalized = normalizeSupabaseUrl(url);

  let host = null;

  try {
    host = new URL(normalized).host;
  } catch {
    host = null;
  }

  return {
    host,
    urlValida: Boolean(host),
    urlComEspacoOuQuebraDeLinha: hasWhitespace(url),
    urlTerminaComBarra: /\/$/.test(url.trim()),
    chaveTipo: key.split("_").slice(0, 2).join("_") || null,
    chaveTamanho: key.trim().length,
    chaveComEspacoOuQuebraDeLinha: hasWhitespace(key),
    node: process.version
  };
}

/**
 * Em Node, "TypeError: fetch failed" esconde o motivo real:
 *  - no próprio erro (error.cause), ou
 *  - dentro de error.details, quando o supabase-js embrulha o erro
 *    (ex.: "Caused by: Error: getaddrinfo ENOTFOUND ...").
 *
 * Códigos comuns:
 *  ENOTFOUND / EAI_AGAIN  = o endereço não existe ou não resolve
 *                           (URL errada ou projeto pausado)
 *  ECONNREFUSED           = nada escutando naquele endereço
 *  ETIMEDOUT              = sem resposta no tempo limite
 */
function describeCause(error) {
  const cause = error?.cause;

  if (cause) {
    return {
      codigo: cause.code || null,
      nome: cause.name || null,
      mensagem: cause.message || null,
      host: cause.hostname || null
    };
  }

  const details = String(error?.details || "").trim();

  if (!details) {
    return null;
  }

  const code = details.match(/\b(E[A-Z_]{4,}|UND_ERR_[A-Z_]+)\b/);

  return {
    codigo: code ? code[1] : null,
    detalhes: details
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(" | ")
  };
}

module.exports = {
  normalizeSupabaseUrl,
  describeSupabaseConfig,
  describeCause
};