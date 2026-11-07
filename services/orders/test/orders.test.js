import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { SignJWT, exportJWK, createLocalJWKSet, jwtVerify } from 'jose';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { createPgliteDb } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { createJwtVerifier } from '../src/lib/auth.js';
import { createUpstream } from '../src/lib/upstream.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'http://localhost:8080';
const TOKEN = 'internal-token-0123456789';
const BOWL = { id: '11111111-1111-4111-8111-111111111111', name: 'Bol Aube', priceCents: 2400, currency: 'EUR' };
const CUP = { id: '22222222-2222-4222-8222-222222222222', name: 'Tasse Sieste', priceCents: 1800, currency: 'EUR' };
const ADDRESS = { line1: '12 rue des Potiers', postalCode: '69001', city: 'Lyon' };

const env = {
  NODE_ENV: 'test', DATABASE_URL: 'postgres://x', APP_ORIGIN: ORIGIN, AUTH_JWKS_URL: 'http://auth:3001/.well-known/jwks.json',
  CART_URL: 'http://cart:3003', CATALOG_URL: 'http://catalog:3002', UPSTREAM_TIMEOUT_MS: '300', INTERNAL_API_TOKEN: TOKEN,
};

let db;
let sign;
let verifyToken;
let privateKey;

/** Faux services cart et catalog, pilotables par chaque test. */
function fakeServices({ cart = [], catalog = [BOWL, CUP] } = {}) {
  const calls = [];
  const state = { cart, catalog, cartDown: false, cartSlow: false, catalogStatus: 200, clearFails: false, cartCleared: false };
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers });
    const u = new URL(url);
    if (u.host === 'cart:3003') {
      if (init.method === 'DELETE') {
        if (state.clearFails) throw new Error('réseau');
        state.cartCleared = true;
        return { ok: true, status: 204 };
      }
      if (state.cartDown) throw new Error('ECONNREFUSED');
      if (state.cartSlow) {
        await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))));
      }
      return { ok: true, status: 200, json: async () => ({ items: state.cart.map((i) => ({ ...i })) }) };
    }
    if (u.host === 'catalog:3002') {
      if (state.catalogStatus !== 200) return { ok: false, status: state.catalogStatus };
      const ids = (u.searchParams.get('ids') ?? '').split(',');
      return { ok: true, status: 200, json: async () => ({ items: state.catalog.filter((p) => ids.includes(p.id)) }) };
    }
    throw new Error(`hôte inattendu ${u.host}`);
  };
  return { fetchImpl, state, calls };
}

function makeApp(services) {
  const { app } = createApp({ cfg: loadConfig(env), db, log: createLogger('silent'), verifyToken, fetchImpl: services.fetchImpl });
  return request(app);
}

beforeAll(async () => {
  db = createPgliteDb(new PGlite());
  await runMigrations(db, path.join(here, '..', 'migrations'));
  const keys = generateKeyPairSync('ed25519');
  privateKey = keys.privateKey;
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'EdDSA' };
  const set = createLocalJWKSet({ keys: [jwk] });
  verifyToken = async (t) => (await jwtVerify(t, set, { issuer: 'shoplite-auth', audience: 'shoplite', algorithms: ['EdDSA'] })).payload;
  sign = (claims = {}, { key = privateKey, exp = '10m' } = {}) =>
    new SignJWT({ email: 'a@example.test', email_verified: true, sid: 's', ...claims })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'k1' }).setIssuer('shoplite-auth').setAudience('shoplite').setIssuedAt().setExpirationTime(exp).sign(key);
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.query('DELETE FROM order_items');
  await db.query('DELETE FROM orders');
});

const bearer = (req, t) => req.set('Authorization', `Bearer ${t}`);
const userA = randomUUID();
const userB = randomUUID();

describe('configuration', () => {
  it('refuse de démarrer sans variable obligatoire', () => {
    expect(() => loadConfig({ ...env, CART_URL: undefined })).toThrow(/CART_URL/);
    expect(() => loadConfig({ ...env, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...env, UPSTREAM_TIMEOUT_MS: '5' })).toThrow(/UPSTREAM_TIMEOUT_MS/);
  });
});

describe('POST / (création de commande)', () => {
  it('exige un utilisateur connecté et vérifié', async () => {
    const agent = makeApp(fakeServices({ cart: [{ productId: BOWL.id, quantity: 1 }] }));
    await agent.post('/').send({ shippingAddress: ADDRESS }).expect(401);
    await bearer(agent.post('/'), 'n-importe-quoi').send({ shippingAddress: ADDRESS }).expect(401);
    const unverified = await sign({ sub: userA, email_verified: false });
    const res = await bearer(agent.post('/'), unverified).send({ shippingAddress: ADDRESS }).expect(403);
    expect(res.body.error.code).toBe('email_not_verified');
  });

  it('enregistre la commande avec les prix du catalogue, puis vide le panier', async () => {
    const services = fakeServices({ cart: [{ productId: BOWL.id, quantity: 2 }, { productId: CUP.id, quantity: 1 }] });
    const agent = makeApp(services);
    const t = await sign({ sub: userA });
    const res = await bearer(agent.post('/'), t).set('X-Request-Id', 'req-12345678').send({ shippingAddress: ADDRESS, note: 'Sonnez deux fois' }).expect(201);
    const { order } = res.body;
    expect(order.totalCents).toBe(2 * 2400 + 1800);
    expect(order.status).toBe('pending');
    expect(order.paymentMethod).toBe('on_site');
    expect(order.reference).toMatch(/^MA-\d{6}$/);
    expect(order.items).toHaveLength(2);
    expect(order.items.find((i) => i.name === 'Bol Aube')).toMatchObject({ unitPriceCents: 2400, quantity: 2, lineTotalCents: 4800 });
    expect(order.shippingAddress.country).toBe('France');
    expect(services.state.cartCleared).toBe(true);
    // le jeton et l'identifiant de requête sont propagés au service panier
    const cartCall = services.calls.find((c) => c.url.startsWith('http://cart') && c.method === 'GET');
    expect(cartCall.headers.Authorization).toBe(`Bearer ${t}`);
    expect(cartCall.headers['X-Request-Id']).toBe('req-12345678');
    const row = (await db.query('SELECT user_id, total_cents FROM orders')).rows[0];
    expect(row).toMatchObject({ user_id: userA, total_cents: 6600 });
  });

  it('ignore et refuse tout prix ou produit envoyé par le navigateur', async () => {
    const services = fakeServices({ cart: [{ productId: BOWL.id, quantity: 1 }] });
    const agent = makeApp(services);
    const t = await sign({ sub: userA });
    await bearer(agent.post('/'), t).send({ shippingAddress: ADDRESS, totalCents: 1, items: [{ productId: BOWL.id, priceCents: 1 }] }).expect(400);
    const ok = await bearer(agent.post('/'), t).send({ shippingAddress: ADDRESS }).expect(201);
    expect(ok.body.order.totalCents).toBe(2400);
  });

  it('valide l’adresse', async () => {
    const agent = makeApp(fakeServices({ cart: [{ productId: BOWL.id, quantity: 1 }] }));
    const t = await sign({ sub: userA });
    const res = await bearer(agent.post('/'), t).send({ shippingAddress: { line1: '', postalCode: '1', city: '' } }).expect(400);
    expect(res.body.error.fields['shippingAddress.line1']).toBeTruthy();
    await bearer(agent.post('/'), t).send({}).expect(400);
  });

  it('refuse un panier vide ou un produit retiré du catalogue', async () => {
    const t = await sign({ sub: userA });
    const empty = await bearer(makeApp(fakeServices({ cart: [] })).post('/'), t).send({ shippingAddress: ADDRESS }).expect(400);
    expect(empty.body.error.code).toBe('cart_empty');
    const gone = await bearer(makeApp(fakeServices({ cart: [{ productId: randomUUID(), quantity: 1 }] })).post('/'), t).send({ shippingAddress: ADDRESS }).expect(409);
    expect(gone.body.error.code).toBe('product_unavailable');
    expect((await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(0);
  });

  it('répond par une erreur claire quand le service panier est indisponible ou trop lent', async () => {
    const t = await sign({ sub: userA });
    const down = fakeServices({ cart: [{ productId: BOWL.id, quantity: 1 }] });
    down.state.cartDown = true;
    const r1 = await bearer(makeApp(down).post('/'), t).send({ shippingAddress: ADDRESS }).expect(503);
    expect(r1.body.error).toMatchObject({ code: 'service_unavailable', upstream: 'cart' });
    expect(r1.body.error.message).toMatch(/panier/);

    const slow = fakeServices({ cart: [{ productId: BOWL.id, quantity: 1 }] });
    slow.state.cartSlow = true;
    const started = Date.now();
    const r2 = await bearer(makeApp(slow).post('/'), t).send({ shippingAddress: ADDRESS }).expect(503);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r2.body.error.upstream).toBe('cart');
    expect((await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(0);
  });

  it('distingue un catalogue indisponible (503) d’un catalogue en erreur (502)', async () => {
    const t = await sign({ sub: userA });
    const bad = fakeServices({ cart: [{ productId: BOWL.id, quantity: 1 }] });
    bad.state.catalogStatus = 500;
    const r = await bearer(makeApp(bad).post('/'), t).send({ shippingAddress: ADDRESS }).expect(502);
    expect(r.body.error).toMatchObject({ code: 'upstream_error', upstream: 'catalog' });
    const noJson = createUpstream({ timeoutMs: 100, log: createLogger('silent'), fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('x'); } }) });
    await expect(noJson('catalog', 'http://c/')).rejects.toMatchObject({ status: 502 });
  });

  it('la commande reste enregistrée même si le panier ne peut pas être vidé', async () => {
    const services = fakeServices({ cart: [{ productId: BOWL.id, quantity: 1 }] });
    services.state.clearFails = true;
    const t = await sign({ sub: userA });
    await bearer(makeApp(services).post('/'), t).send({ shippingAddress: ADDRESS }).expect(201);
    expect((await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(1);
  });
});

describe('lecture des commandes (isolation entre utilisateurs)', () => {
  async function place(userId, product = BOWL) {
    const agent = makeApp(fakeServices({ cart: [{ productId: product.id, quantity: 1 }] }));
    const res = await bearer(agent.post('/'), await sign({ sub: userId })).send({ shippingAddress: ADDRESS }).expect(201);
    return res.body.order;
  }

  it('GET /me ne renvoie que les commandes de l’utilisateur, les plus récentes d’abord', async () => {
    const a1 = await place(userA);
    const a2 = await place(userA, CUP);
    await place(userB);
    const agent = makeApp(fakeServices());
    const res = await bearer(agent.get('/me'), await sign({ sub: userA })).expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((o) => o.id)).toEqual([a2.id, a1.id]);
    expect(res.headers['cache-control']).toBe('no-store');
    const page = await bearer(agent.get('/me?pageSize=1&page=2'), await sign({ sub: userA })).expect(200);
    expect(page.body.items.map((o) => o.id)).toEqual([a1.id]);
    await bearer(agent.get('/me?page=0'), await sign({ sub: userA })).expect(400);
    await agent.get('/me').expect(401);
  });

  it('GET /:id refuse l’accès à la commande d’un autre utilisateur (404)', async () => {
    const orderB = await place(userB);
    const agent = makeApp(fakeServices());
    const tokenA = await sign({ sub: userA });
    const stolen = await bearer(agent.get(`/${orderB.id}`), tokenA).expect(404);
    expect(stolen.body.error.code).toBe('not_found');
    expect(JSON.stringify(stolen.body)).not.toContain(orderB.reference);
    const own = await bearer(agent.get(`/${orderB.id}`), await sign({ sub: userB })).expect(200);
    expect(own.body.order.id).toBe(orderB.id);
    await bearer(agent.get(`/${randomUUID()}`), tokenA).expect(404);
    await bearer(agent.get('/pas-un-uuid'), tokenA).expect(404);
    await bearer(agent.get("/1' OR '1'='1"), tokenA).expect(404);
    await agent.get(`/${orderB.id}`).expect(401);
  });

  it('refuse les jetons expirés ou signés par une autre clé', async () => {
    const agent = makeApp(fakeServices());
    const expired = await sign({ sub: userA }, { exp: Math.floor(Date.now() / 1000) - 60 });
    await bearer(agent.get('/me'), expired).expect(401);
    const forged = await sign({ sub: userA }, { key: generateKeyPairSync('ed25519').privateKey });
    await bearer(agent.get('/me'), forged).expect(401);
    await agent.get('/me').set('Authorization', 'Basic xx').expect(401);
  });
});

describe('anonymisation RGPD (appel interne)', () => {
  it('détache les commandes du compte supprimé, uniquement avec le jeton interne', async () => {
    const agent = makeApp(fakeServices({ cart: [{ productId: BOWL.id, quantity: 1 }] }));
    await bearer(agent.post('/'), await sign({ sub: userA })).send({ shippingAddress: ADDRESS }).expect(201);
    await agent.delete(`/internal/users/${userA}`).expect(403);
    await agent.delete(`/internal/users/${userA}`).set('x-internal-token', 'mauvais-jeton-0123456').expect(403);
    await agent.delete('/internal/users/xyz').set('x-internal-token', TOKEN).expect(403);
    await agent.delete(`/internal/users/${userA}`).set('x-internal-token', TOKEN).expect(204);
    const row = (await db.query('SELECT user_id, shipping_address, total_cents FROM orders')).rows[0];
    expect(row.user_id).toBeNull();
    expect(row.shipping_address).toBeNull();
    expect(row.total_cents).toBe(2400);
  });
});

describe('vérificateur JWKS et opérations', () => {
  it('le vérificateur distant échoue proprement si le JWKS est injoignable', async () => {
    const verify = createJwtVerifier({ ...loadConfig(env), AUTH_JWKS_URL: 'http://127.0.0.1:1/jwks.json' });
    await expect(verify(await sign({ sub: userA }))).rejects.toThrow();
  });

  it('expose healthz, readyz, metrics, docs et propage X-Request-Id', async () => {
    const agent = makeApp(fakeServices());
    await agent.get('/healthz').expect(200);
    await agent.get('/readyz').expect(200);
    const m = await agent.get('/metrics').expect(200);
    expect(m.text).toMatch(/http_requests_total/);
    expect(m.text).toMatch(/http_request_errors_total/);
    expect(m.text).toMatch(/http_request_duration_seconds/);
    await agent.get('/docs/').expect(200);
    await agent.get('/openapi.json').expect(200);
    const res = await agent.get('/healthz').set('X-Request-Id', 'abc12345-req').expect(200);
    expect(res.headers['x-request-id']).toBe('abc12345-req');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    await agent.get('/nimporte/chose/ici').expect(404);
    await agent.post('/').set('Content-Type', 'application/json').send('{oops').expect(400);
    const big = await agent.post('/').send({ note: 'a'.repeat(6000) }).expect(413);
    expect(big.body.error.code).toBe('payload_too_large');
  });

  it('/readyz renvoie 503 si la base est injoignable et ne divulgue pas les erreurs internes', async () => {
    const broken = { ping: async () => { throw new Error('down'); }, query: async () => { throw new Error('secret interne'); }, tx: async () => { throw new Error('secret interne'); } };
    const { app } = createApp({ cfg: loadConfig(env), db: broken, log: createLogger('silent'), verifyToken, fetchImpl: fakeServices().fetchImpl });
    await request(app).get('/readyz').expect(503);
    const res = await bearer(request(app).get('/me'), await sign({ sub: userA })).expect(500);
    expect(res.body.error.message).not.toMatch(/secret interne/);
  });
});
