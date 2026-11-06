"use strict";

/**
 * Erro com status HTTP. As rotas lançam estes erros e o middleware de
 * erro (app.js) transforma em resposta JSON { error }.
 */
class HttpError extends Error {
  constructor(status, message, extra = undefined) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.extra = extra;
  }
}

const badRequest = message => new HttpError(400, message);
const notFound = (message = "Jogador não encontrado") => new HttpError(404, message);
const conflict = message => new HttpError(409, message);
const unavailable = message => new HttpError(503, message);

const NICKNAME_TAKEN = "Esse apelido já está sendo utilizado. Tente outro.";

module.exports = {
  HttpError,
  badRequest,
  notFound,
  conflict,
  unavailable,
  NICKNAME_TAKEN
};
