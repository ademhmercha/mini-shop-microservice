import { AppError } from './errors.js';

const NAMES = { cart: 'panier', catalog: 'catalogue' };

/**
 * Client HTTP vers les autres services : délai d'attente strict, propagation de X-Request-Id,
 * erreurs claires (503 si le service est injoignable ou trop lent, 502 s'il répond en erreur).
 */
export function createUpstream({ timeoutMs, fetchImpl = fetch, log }) {
  return async function call(service, url, { method = 'GET', headers = {}, requestId } = {}) {
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers: { Accept: 'application/json', ...(requestId ? { 'X-Request-Id': requestId } : {}), ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      log.warn({ service, timedOut, err: { message: err?.message } }, 'service appelé indisponible');
      throw new AppError(
        503,
        'service_unavailable',
        `Le service ${NAMES[service] ?? service} est momentanément indisponible. Réessayez dans un instant.`,
        { upstream: service },
      );
    }
    if (res.status === 204) return null;
    if (!res.ok) {
      log.warn({ service, status: res.status }, 'réponse en erreur du service appelé');
      throw new AppError(502, 'upstream_error', `Le service ${NAMES[service] ?? service} a répondu par une erreur.`, { upstream: service });
    }
    try {
      return await res.json();
    } catch {
      throw new AppError(502, 'upstream_error', `Réponse invalide du service ${NAMES[service] ?? service}.`, { upstream: service });
    }
  };
}
