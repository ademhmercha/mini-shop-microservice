import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, refreshSession, session, ApiError } from '../src/api/http.js';
import { authApi, cartApi, catalogApi, ordersApi } from '../src/api/endpoints.js';

const json = (status, body, headers = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

let calls;
function mockFetch(handler) {
  calls = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push({ url, ...init });
    return handler(url, init, calls.length);
  });
}

beforeEach(() => {
  session.clear();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('stockage du jeton d’accès', () => {
  it('garde le jeton en mémoire uniquement : jamais dans localStorage ni sessionStorage', async () => {
    const ls = vi.spyOn(Storage.prototype, 'setItem');
    mockFetch(() => json(200, { accessToken: 'JETON-SECRET-123', expiresIn: 900, user: { id: 'u' } }));
    await authApi.login('a@example.test', 'mot-de-passe-long-1');
    expect(session.getToken()).toBe('JETON-SECRET-123');
    expect(ls).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...localStorage })).not.toContain('JETON');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('JETON');
    expect(document.cookie).not.toContain('JETON');
  });

  it('envoie l’en-tête CSRF personnalisé et le jeton Bearer', async () => {
    session.set('abc', 900);
    mockFetch(() => json(200, { ok: true }));
    await api('/api/auth/me', { auth: true });
    expect(calls[0].headers['X-Requested-With']).toBe('shoplite');
    expect(calls[0].headers.Authorization).toBe('Bearer abc');
    expect(calls[0].credentials).toBe('same-origin');
  });
});

describe('renouvellement silencieux', () => {
  it('renouvelle un jeton proche de l’expiration avant la requête', async () => {
    session.set('vieux', 5);
    mockFetch((url) => (url === '/api/auth/refresh' ? json(200, { accessToken: 'neuf', expiresIn: 900, user: {} }) : json(200, { ok: 1 })));
    await api('/api/auth/me', { auth: true });
    expect(calls.map((c) => c.url)).toEqual(['/api/auth/refresh', '/api/auth/me']);
    expect(calls[1].headers.Authorization).toBe('Bearer neuf');
  });

  it('réessaie une fois après un 401 de jeton expiré', async () => {
    session.set('expire', 900);
    mockFetch((url, init, n) => {
      if (url === '/api/auth/refresh') return json(200, { accessToken: 'neuf', expiresIn: 900, user: {} });
      return n === 1 ? json(401, { error: { code: 'invalid_token', message: 'expiré' } }) : json(200, { ok: 1 });
    });
    const res = await api('/api/orders/me', { auth: true });
    expect(res).toEqual({ ok: 1 });
    expect(calls.map((c) => c.url)).toEqual(['/api/orders/me', '/api/auth/refresh', '/api/orders/me']);
  });

  it('une seule requête de rafraîchissement à la fois (le cookie tourne à chaque usage)', async () => {
    mockFetch(async () => json(200, { accessToken: 'neuf', expiresIn: 900, user: {} }));
    await Promise.all([refreshSession(), refreshSession(), refreshSession()]);
    expect(calls).toHaveLength(1);
  });

  it('vide la session si le rafraîchissement est refusé', async () => {
    session.set('x', 900);
    mockFetch(() => json(401, { error: { code: 'invalid_session', message: 'Session invalide.' } }));
    await expect(refreshSession()).rejects.toMatchObject({ status: 401, code: 'invalid_session' });
    expect(session.getToken()).toBeNull();
  });

  it('exige une session pour une route protégée', async () => {
    mockFetch(() => json(401, { error: { code: 'invalid_session', message: 'Session invalide.' } }));
    await expect(api('/api/auth/me', { auth: true })).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
  });

  it('abandonne et remonte l’erreur si le renouvellement échoue après un 401', async () => {
    session.set('expire', 900);
    mockFetch((url) => (url === '/api/auth/refresh' ? json(401, { error: { code: 'invalid_session' } }) : json(401, { error: { code: 'invalid_token', message: 'x' } })));
    await expect(api('/api/orders/me', { auth: true })).rejects.toMatchObject({ code: 'invalid_token' });
  });
});

describe('erreurs réseau et API', () => {
  it('traduit une panne réseau en message clair', async () => {
    mockFetch(() => { throw new TypeError('Failed to fetch'); });
    await expect(api('/api/catalog/products')).rejects.toMatchObject({ status: 0, code: 'network_error' });
  });
  it('expose code, champs, délai et identifiant de requête', async () => {
    mockFetch(() => json(429, { error: { code: 'too_many_attempts', message: 'Trop de tentatives.', requestId: 'r-1', fields: { email: 'x' } } }, { 'retry-after': '42' }));
    const err = await api('/api/auth/login', { method: 'POST', body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 429, code: 'too_many_attempts', retryAfter: 42, requestId: 'r-1', fields: { email: 'x' } });
  });
  it('gère les réponses sans contenu et non JSON', async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    expect(await api('/api/cart/', { method: 'DELETE' })).toBeNull();
    mockFetch(() => new Response('<html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    await expect(api('/api/x')).rejects.toMatchObject({ status: 502, code: 'unknown' });
  });
});

describe('points d’accès', () => {
  it('construit les bonnes requêtes', async () => {
    session.set('t', 900);
    mockFetch(() => json(200, {}));
    await catalogApi.products({ category: 'bols', page: 2, pageSize: 9, featured: true, ids: ['a', 'b'] });
    await catalogApi.product('bol aube');
    await catalogApi.categories();
    await cartApi.add('p1', 2);
    await cartApi.setQuantity('p1', 3);
    await cartApi.remove('p1');
    await cartApi.get();
    await cartApi.clear();
    await ordersApi.create({ line1: 'x' }, 'note');
    await ordersApi.mine({ page: 2 });
    await ordersApi.get('o1');
    await authApi.forgotPassword('a@b.fr');
    await authApi.resetPassword('tok', 'pw');
    await authApi.verifyEmail('tok');
    await authApi.register('a@b.fr', 'pw');
    await authApi.twoFactorSetup('fresh');
    await authApi.revokeSession('fresh', 'sid');
    expect(calls[0].url).toBe('/api/catalog/products?category=bols&featured=true&ids=a%2Cb&page=2&pageSize=9');
    expect(calls[1].url).toBe('/api/catalog/products/bol%20aube');
    expect(JSON.parse(calls[3].body)).toEqual({ productId: 'p1', quantity: 2 });
    expect(calls[3].headers.Authorization).toBe('Bearer t'); // panier du compte quand connecté
    expect(calls[9].url).toBe('/api/orders/me?page=2&pageSize=10');
    expect(calls[16].headers['X-Fresh-Token']).toBe('fresh');
  });

  it('logout vide la session même si le serveur échoue', async () => {
    session.set('t', 900);
    mockFetch(() => { throw new TypeError('offline'); });
    await expect(authApi.logout()).rejects.toBeTruthy();
    expect(session.getToken()).toBeNull();
  });

  it('la seconde étape de connexion mémorise le jeton', async () => {
    mockFetch(() => json(200, { accessToken: 'apres2fa', expiresIn: 900, user: {} }));
    await authApi.loginSecondFactor('challenge', '123456');
    expect(session.getToken()).toBe('apres2fa');
  });
});
