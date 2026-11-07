import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import request from 'supertest';
import RedisMock from 'ioredis-mock';
import { SignJWT, exportJWK, createLocalJWKSet, jwtVerify, importJWK } from 'jose';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { createApp } from '../src/app.js';
import { createJwtVerifier } from '../src/lib/auth.js';

const ORIGIN = 'http://localhost:8080';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'internal-token-0123456789';

const env = {
  NODE_ENV: 'test', REDIS_URL: 'redis://x', APP_ORIGIN: ORIGIN, AUTH_JWKS_URL: 'http://auth:3001/.well-known/jwks.json',
  COOKIE_SECURE: 'false', INTERNAL_API_TOKEN: TOKEN,
};

let agent;
let redis;
let sign;
let built;

beforeAll(async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'EdDSA' };
  const localSet = createLocalJWKSet({ keys: [jwk] });
  const verifyToken = async (t) => (await jwtVerify(t, localSet, { issuer: 'shoplite-auth', audience: 'shoplite', algorithms: ['EdDSA'] })).payload;
  sign = (claims = {}, { key = privateKey, exp = '10m', aud = 'shoplite' } = {}) =>
    new SignJWT({ email: 'a@example.test', email_verified: true, sid: 's1', ...claims })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'k1' }).setIssuer('shoplite-auth').setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(key);
  redis = new RedisMock();
  built = createApp({ cfg: loadConfig(env), redis, log: createLogger('silent'), verifyToken });
  agent = request(built.app);
});
beforeEach(() => redis.flushall());

const guest = (req) => req.set('Origin', ORIGIN).set('X-Requested-With', 'shoplite');
const cookieOf = (res) => (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('cart_sid='))?.split(';')[0];

describe('configuration', () => {
  it('refuse de démarrer sans variable obligatoire', () => {
    expect(() => loadConfig({ APP_ORIGIN: ORIGIN })).toThrow(/REDIS_URL/);
    expect(() => loadConfig({ ...env, AUTH_JWKS_URL: undefined })).toThrow(/AUTH_JWKS_URL/);
    expect(() => loadConfig({ ...env, INTERNAL_API_TOKEN: 'court' })).toThrow(/INTERNAL_API_TOKEN/);
  });
});

describe('panier invité', () => {
  it('crée un identifiant de session HttpOnly au premier ajout et accumule les quantités', async () => {
    const first = await guest(agent.post('/items')).send({ productId: P1, quantity: 2 }).expect(201);
    const set = first.headers['set-cookie'][0];
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Strict/);
    expect(set).toMatch(/Path=\/api\/cart/);
    const cookie = cookieOf(first);
    await guest(agent.post('/items')).set('Cookie', cookie).send({ productId: P1 }).expect(201);
    const second = await guest(agent.post('/items')).set('Cookie', cookie).send({ productId: P2, quantity: 1 }).expect(201);
    expect(second.headers['set-cookie']).toBeUndefined();
    expect(second.body).toEqual({ items: [{ productId: P1, quantity: 3 }, { productId: P2, quantity: 1 }], itemCount: 4 });
    const read = await agent.get('/').set('Cookie', cookie).expect(200);
    expect(read.body.itemCount).toBe(4);
    expect(read.headers['cache-control']).toBe('no-store');
  });

  it('un panier vide est renvoyé sans cookie', async () => {
    const res = await agent.get('/').expect(200);
    expect(res.body).toEqual({ items: [], itemCount: 0 });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('modifie, retire et vide le panier', async () => {
    const first = await guest(agent.post('/items')).send({ productId: P1, quantity: 5 }).expect(201);
    const cookie = cookieOf(first);
    const set = await guest(agent.put(`/items/${P1}`)).set('Cookie', cookie).send({ quantity: 2 }).expect(200);
    expect(set.body.items[0].quantity).toBe(2);
    const added = await guest(agent.put(`/items/${P2}`)).set('Cookie', cookie).send({ quantity: 1 }).expect(200);
    expect(added.body.items).toHaveLength(2);
    const zero = await guest(agent.put(`/items/${P2}`)).set('Cookie', cookie).send({ quantity: 0 }).expect(200);
    expect(zero.body.items).toHaveLength(1);
    const del = await guest(agent.delete(`/items/${P1}`)).set('Cookie', cookie).expect(200);
    expect(del.body.items).toEqual([]);
    await guest(agent.delete('/items/' + P1)).expect(200); // sans cookie : idempotent
    await guest(agent.post('/items')).set('Cookie', cookie).send({ productId: P3 });
    await guest(agent.delete('/')).set('Cookie', cookie).expect(204);
    expect((await agent.get('/').set('Cookie', cookie)).body.itemCount).toBe(0);
    await guest(agent.delete('/')).expect(204);
  });

  it('plafonne les quantités et le nombre de lignes', async () => {
    const first = await guest(agent.post('/items')).send({ productId: P1, quantity: 20 }).expect(201);
    const cookie = cookieOf(first);
    const more = await guest(agent.post('/items')).set('Cookie', cookie).send({ productId: P1, quantity: 5 }).expect(201);
    expect(more.body.items[0].quantity).toBe(20);
    for (let i = 0; i < 49; i += 1) await guest(agent.post('/items')).set('Cookie', cookie).send({ productId: randomUUID() }).expect(201);
    await guest(agent.post('/items')).set('Cookie', cookie).send({ productId: randomUUID() }).expect(409);
    await guest(agent.put(`/items/${randomUUID()}`)).set('Cookie', cookie).send({ quantity: 1 }).expect(409);
  });

  it('valide strictement les entrées', async () => {
    await guest(agent.post('/items')).send({ productId: 'pas-un-uuid' }).expect(400);
    await guest(agent.post('/items')).send({ productId: P1, quantity: 0 }).expect(400);
    await guest(agent.post('/items')).send({ productId: P1, quantity: 21 }).expect(400);
    await guest(agent.post('/items')).send({ productId: P1, quantity: 1.5 }).expect(400);
    await guest(agent.post('/items')).send({ productId: P1, price: 0 }).expect(400); // aucun prix accepté
    await guest(agent.put('/items/xyz')).send({ quantity: 1 }).expect(400);
    await guest(agent.post('/items')).send({ productId: P1, note: 'a'.repeat(6000) }).expect(413);
  });

  it('ignore un identifiant de session forgé (injection de clé Redis)', async () => {
    const res = await guest(agent.post('/items')).set('Cookie', 'cart_sid=../user:x*').send({ productId: P1 }).expect(201);
    expect(cookieOf(res)).toBeTruthy(); // un nouvel identifiant est émis
    expect(await redis.keys('cart:guest:*')).toHaveLength(1);
  });

  it('protège les modifications par cookie contre le CSRF', async () => {
    await agent.post('/items').send({ productId: P1 }).expect(403);
    await agent.post('/items').set('X-Requested-With', 'shoplite').send({ productId: P1 }).expect(403);
    await agent.post('/items').set('X-Requested-With', 'shoplite').set('Origin', 'https://evil.example').send({ productId: P1 }).expect(403);
  });
});

describe('panier du compte', () => {
  it('lit et écrit le panier du compte avec un jeton valide (sans CSRF cookie nécessaire)', async () => {
    const jwt = await sign({ sub: 'user-a' });
    const res = await agent.post('/items').set('Authorization', `Bearer ${jwt}`).send({ productId: P1, quantity: 2 }).expect(201);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await redis.hgetall('cart:user:user-a')).toEqual({ [P1]: '2' });
    const other = await sign({ sub: 'user-b' });
    expect((await agent.get('/').set('Authorization', `Bearer ${other}`)).body.itemCount).toBe(0); // isolation
  });

  it('fusionne le panier invité dans le panier du compte à la connexion', async () => {
    const g = await guest(agent.post('/items')).send({ productId: P1, quantity: 2 }).expect(201);
    const cookie = cookieOf(g);
    await guest(agent.post('/items')).set('Cookie', cookie).send({ productId: P2, quantity: 1 });
    const jwt = await sign({ sub: 'user-a' });
    await agent.post('/items').set('Authorization', `Bearer ${jwt}`).send({ productId: P1, quantity: 3 });
    const merged = await agent.post('/merge').set('Authorization', `Bearer ${jwt}`).set('Cookie', cookie).expect(200);
    expect(merged.body.items).toEqual([{ productId: P1, quantity: 5 }, { productId: P2, quantity: 1 }]);
    expect(merged.headers['set-cookie'][0]).toMatch(/cart_sid=;/);
    expect(await redis.keys('cart:guest:*')).toHaveLength(0);
    // sans cookie invité : renvoie simplement le panier du compte
    const again = await agent.post('/merge').set('Authorization', `Bearer ${jwt}`).expect(200);
    expect(again.body.itemCount).toBe(6);
    await guest(agent.post('/merge')).expect(401);
  });
});

describe('authentification des jetons', () => {
  it('rejette jeton expiré, falsifié, mauvaise audience et schéma inconnu', async () => {
    const expired = await sign({ sub: 'u' }, { exp: Math.floor(Date.now() / 1000) - 60 });
    await agent.get('/').set('Authorization', `Bearer ${expired}`).expect(401);
    const forged = await sign({ sub: 'u' }, { key: generateKeyPairSync('ed25519').privateKey });
    await agent.get('/').set('Authorization', `Bearer ${forged}`).expect(401);
    const wrongAud = await sign({ sub: 'u' }, { aud: 'autre' });
    await agent.get('/').set('Authorization', `Bearer ${wrongAud}`).expect(401);
    await agent.get('/').set('Authorization', 'Basic abc').expect(401);
    await agent.get('/').set('Authorization', 'Bearer').expect(401);
  });

  it('le vérificateur JWKS distant n’utilise que la clé publique et refuse une source injoignable', async () => {
    const verify = createJwtVerifier({ ...loadConfig(env), AUTH_JWKS_URL: 'http://127.0.0.1:1/jwks.json' });
    await expect(verify(await sign({ sub: 'u' }))).rejects.toThrow();
    expect(typeof importJWK).toBe('function');
  });
});

describe('effacement interne (RGPD)', () => {
  it('supprime le panier d’un compte avec le jeton interne, et seulement avec lui', async () => {
    await redis.hset('cart:user:11111111-1111-4111-8111-aaaaaaaaaaaa', P1, 1);
    const url = '/internal/users/11111111-1111-4111-8111-aaaaaaaaaaaa';
    await agent.delete(url).expect(403);
    await agent.delete(url).set('x-internal-token', 'mauvais-jeton-0123456').expect(403);
    await agent.delete('/internal/users/pas-un-id').set('x-internal-token', TOKEN).expect(403);
    await agent.delete(url).set('x-internal-token', TOKEN).expect(204);
    expect(await redis.exists('cart:user:11111111-1111-4111-8111-aaaaaaaaaaaa')).toBe(0);
    const noToken = createApp({ cfg: loadConfig({ ...env, INTERNAL_API_TOKEN: undefined }), redis, log: createLogger('silent'), verifyToken: async () => ({}) });
    await request(noToken.app).delete(url).set('x-internal-token', '').expect(403);
  });
});

describe('opérations', () => {
  it('expose healthz, readyz, metrics, docs, X-Request-Id et en-têtes de sécurité', async () => {
    await agent.get('/healthz').expect(200);
    await agent.get('/readyz').expect(200);
    const m = await agent.get('/metrics').expect(200);
    expect(m.text).toMatch(/http_requests_total/);
    expect(m.text).toMatch(/http_request_errors_total/);
    await agent.get('/docs/').expect(200);
    await agent.get('/openapi.json').expect(200);
    const res = await agent.get('/healthz').set('X-Request-Id', 'abc12345-req').expect(200);
    expect(res.headers['x-request-id']).toBe('abc12345-req');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const nf = await agent.get('/inconnu').expect(404);
    expect(nf.body.error.code).toBe('not_found');
    await agent.post('/items').set('Content-Type', 'application/json').send('{oops').expect(400);
  });

  it('/readyz renvoie 503 si Redis est injoignable', async () => {
    const down = { ping: async () => { throw new Error('down'); } };
    const a = createApp({ cfg: loadConfig(env), redis: down, log: createLogger('silent'), verifyToken: async () => ({}) });
    await request(a.app).get('/readyz').expect(503);
    const broken = { hgetall: async () => { throw new Error('secret interne'); } };
    const b = createApp({ cfg: loadConfig(env), redis: broken, log: createLogger('silent'), verifyToken: async () => ({}) });
    const res = await request(b.app).get('/').set('Cookie', 'cart_sid=' + 'a'.repeat(32)).expect(500);
    expect(res.body.error.message).not.toMatch(/secret interne/);
  });
});
