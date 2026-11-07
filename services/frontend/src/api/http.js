/**
 * Client HTTP. Le jeton d'accès vit UNIQUEMENT dans une variable de ce module (mémoire) :
 * jamais dans localStorage, sessionStorage ni un cookie lisible. Le renouvellement s'appuie sur le cookie
 * de rafraîchissement HttpOnly, que JavaScript ne peut pas lire.
 */
const CSRF_HEADERS = { 'X-Requested-With': 'shoplite' };
const REFRESH_MARGIN_MS = 20_000;

export class ApiError extends Error {
  constructor(status, payload = {}, retryAfter = null) {
    const err = payload?.error ?? {};
    super(err.message || 'Une erreur est survenue. Réessayez dans un instant.');
    this.name = 'ApiError';
    this.status = status;
    this.code = err.code ?? 'unknown';
    this.fields = err.fields ?? {};
    this.requestId = err.requestId ?? null;
    this.upstream = err.upstream ?? null;
    this.retryAfter = retryAfter;
  }
}

let accessToken = null;
let expiresAt = 0;
let refreshing = null;
const listeners = new Set();

export const session = {
  getToken: () => accessToken,
  expiresInMs: () => (accessToken ? expiresAt - Date.now() : 0),
  set(token, expiresInSeconds) {
    accessToken = token;
    expiresAt = Date.now() + expiresInSeconds * 1000;
    listeners.forEach((fn) => fn({ token, expiresInSeconds }));
  },
  clear() {
    accessToken = null;
    expiresAt = 0;
    listeners.forEach((fn) => fn({ token: null }));
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

async function send(path, { method = 'GET', body, headers = {}, token, signal } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      signal,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...CSRF_HEADERS,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(0, { error: { code: 'network_error', message: 'Connexion impossible. Vérifiez votre réseau et réessayez.' } });
  }
  if (res.status === 204) return null;
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  const payload = isJson ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    const retry = Number(res.headers.get('retry-after'));
    throw new ApiError(res.status, payload, Number.isFinite(retry) && retry > 0 ? retry : null);
  }
  return payload;
}

/** Une seule requête de rafraîchissement à la fois (la rotation du cookie détecte les rejeux). */
export function refreshSession() {
  refreshing ??= send('/api/auth/refresh', { method: 'POST' })
    .then((data) => {
      session.set(data.accessToken, data.expiresIn);
      return data;
    })
    .catch((err) => {
      if (err.status === 401 || err.status === 403) session.clear();
      throw err;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * auth: true       -> jeton obligatoire (renouvelé si besoin, une nouvelle tentative après un 401)
 * auth: 'optional' -> jeton joint s'il existe (panier : compte ou invité)
 */
export async function api(path, { auth = false, _retried = false, ...options } = {}) {
  if (auth && session.getToken() && session.expiresInMs() < REFRESH_MARGIN_MS) {
    await refreshSession().catch(() => {});
  }
  if (auth === true && !session.getToken()) {
    await refreshSession().catch(() => {});
    if (!session.getToken()) {
      throw new ApiError(401, { error: { code: 'unauthorized', message: 'Votre session a expiré. Reconnectez-vous.' } });
    }
  }
  try {
    return await send(path, { ...options, token: auth ? session.getToken() : undefined });
  } catch (err) {
    if (auth && !_retried && err.status === 401 && ['invalid_token', 'session_revoked', 'unauthorized'].includes(err.code)) {
      try {
        await refreshSession();
      } catch {
        throw err;
      }
      return api(path, { auth, ...options, _retried: true });
    }
    throw err;
  }
}
