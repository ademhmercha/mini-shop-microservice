export class AppError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (message = 'Requête invalide.', code = 'bad_request', extra) =>
  new AppError(400, code, message, extra);
export const unauthorized = (message = 'Authentification requise.', code = 'unauthorized') =>
  new AppError(401, code, message);
export const forbidden = (message = 'Action interdite.', code = 'forbidden') => new AppError(403, code, message);
export const notFound = (message = 'Ressource introuvable.') => new AppError(404, 'not_found', message);
export const tooMany = (retryAfter = 60) =>
  new AppError(429, 'too_many_attempts', 'Trop de tentatives. Réessayez plus tard.', { retryAfter });

/** Middleware d'erreurs : format JSON uniforme, jamais de trace dans la réponse. */
export function errorHandler(log) {
  return (err, req, res, _next) => {
    let status = 500;
    let body = { code: 'internal_error', message: 'Une erreur interne est survenue.' };
    if (err instanceof AppError) {
      status = err.status;
      body = { code: err.code, message: err.message, ...err.extra };
      if (err.extra?.retryAfter) res.set('Retry-After', String(err.extra.retryAfter));
    } else if (err?.type === 'entity.too.large') {
      status = 413;
      body = { code: 'payload_too_large', message: 'Requête trop volumineuse.' };
    } else if (err?.type === 'entity.parse.failed') {
      status = 400;
      body = { code: 'invalid_json', message: 'Corps JSON invalide.' };
    } else {
      (req.log ?? log).error({ err: { message: err?.message, stack: err?.stack } }, 'erreur non gérée');
    }
    res.status(status).json({ error: { ...body, requestId: req.id } });
  };
}
