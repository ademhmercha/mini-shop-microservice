#!/usr/bin/env node
/**
 * Parcours complet de bout en bout SANS Docker : les 4 services démarrent dans ce processus, avec de vrais
 * échanges HTTP entre eux (JWKS, panier, catalogue), PGlite à la place de PostgreSQL et ioredis-mock à la place de Redis.
 * Utile pour vérifier l'intégration entre services ; la pile réelle se teste avec `docker compose up --build`.
 *
 *   node scripts/e2e-inprocess.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svc = (name, file) => import(pathToFileURL(path.join(root, 'services', name, file)).href);
const authRequire = createRequire(path.join(root, 'services/auth/package.json'));
const { PGlite } = await import(pathToFileURL(authRequire.resolve('@electric-sql/pglite')).href);
const RedisMock = authRequire('ioredis-mock');
const { generate } = await import(pathToFileURL(authRequire.resolve('otplib')).href);

const ORIGIN = 'http://localhost:8080';
const PASSWORD = 'Correct-Horse-Battery-9';
const quiet = (m) => m.createLogger('silent');

const { privateKey } = generateKeyPairSync('ed25519');
const common = { NODE_ENV: 'test', APP_ORIGIN: ORIGIN, COOKIE_SECURE: 'false', INTERNAL_API_TOKEN: 'internal-token-0123456789' };
const jwks = 'http://127.0.0.1:3001/.well-known/jwks.json';

// ---------- démarrage des services ----------
const mails = [];
const mailer = Object.fromEntries(
  ['sendVerification', 'sendAlreadyRegistered', 'sendPasswordReset', 'sendEmailChange', 'sendSecurityNotice'].map((k) => [
    k, async (to, token) => { mails.push({ kind: k, to, token }); },
  ]),
);
const servers = [];
const listen = (app, port) => new Promise((resolve) => servers.push(app.listen(port, '127.0.0.1', resolve)));

const migrate = async (name) => {
  const { createPgliteDb } = await svc(name, 'src/db.js');
  const { runMigrations } = await svc(name, 'src/migrate.js');
  const db = createPgliteDb(new PGlite());
  await runMigrations(db, path.join(root, 'services', name, 'migrations'));
  return db;
};

{
  const { loadConfig } = await svc('auth', 'src/config.js');
  const { createApp } = await svc('auth', 'src/app.js');
  const logger = await svc('auth', 'src/logger.js');
  const cfg = loadConfig({
    ...common, DATABASE_URL: 'x', REDIS_URL: 'x', SMTP_HOST: 'x', IP_RATE_LIMIT_MAX: '1000',
    JWT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }), TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    ORDERS_INTERNAL_URL: 'http://127.0.0.1:3004', CART_INTERNAL_URL: 'http://127.0.0.1:3003',
  });
  const built = createApp({ cfg, db: await migrate('auth'), redis: new RedisMock(), log: quiet(logger), mailer });
  globalThis.authBackground = built.background;
  await listen(built.app, 3001);
}
{
  const { loadConfig } = await svc('catalog', 'src/config.js');
  const { createApp } = await svc('catalog', 'src/app.js');
  const logger = await svc('catalog', 'src/logger.js');
  const cfg = loadConfig({ ...common, DATABASE_URL: 'x' });
  await listen(createApp({ cfg, db: await migrate('catalog'), log: quiet(logger) }).app, 3002);
}
{
  const { loadConfig } = await svc('cart', 'src/config.js');
  const { createApp } = await svc('cart', 'src/app.js');
  const logger = await svc('cart', 'src/logger.js');
  const cfg = loadConfig({ ...common, REDIS_URL: 'x', AUTH_JWKS_URL: jwks });
  await listen(createApp({ cfg, redis: new RedisMock(), log: quiet(logger) }).app, 3003);
}
{
  const { loadConfig } = await svc('orders', 'src/config.js');
  const { createApp } = await svc('orders', 'src/app.js');
  const logger = await svc('orders', 'src/logger.js');
  const cfg = loadConfig({ ...common, DATABASE_URL: 'x', AUTH_JWKS_URL: jwks, CART_URL: 'http://127.0.0.1:3003', CATALOG_URL: 'http://127.0.0.1:3002' });
  await listen(createApp({ cfg, db: await migrate('orders'), log: quiet(logger) }).app, 3004);
}

// ---------- client minimal avec gestion des cookies ----------
const PORTS = { auth: 3001, catalog: 3002, cart: 3003, orders: 3004 };
function client() {
  const jar = new Map();
  let token = null;
  const call = async (service, p, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(`http://127.0.0.1:${PORTS[service]}${p}`, {
      method,
      headers: {
        Origin: ORIGIN, 'X-Requested-With': 'shoplite', 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (X11; Linux) Firefox/120.0',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, v] = kv.split('=');
      if (v) jar.set(k, v); else jar.delete(k);
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };
  return { call, setToken: (t) => { token = t; }, jar };
}
const step = (label) => console.log(`✔ ${label}`);

try {
  const email = `camille${Date.now()}@example.test`;
  const browser = client();
  const drain = () => globalThis.authBackground.drain();

  // Catalogue public
  const products = await browser.call('catalog', '/products?pageSize=50');
  assert.equal(products.body.total, 12);
  step('catalogue : 12 pièces de démonstration');

  // Panier invité
  const bowl = products.body.items.find((p) => p.slug === 'bol-aube');
  const teapot = products.body.items.find((p) => p.slug === 'theiere-serenade');
  assert.equal((await browser.call('cart', '/items', { method: 'POST', body: { productId: bowl.id, quantity: 2 } })).status, 201);
  assert.ok(browser.jar.has('cart_sid'));
  step('panier invité créé (cookie HttpOnly)');

  // Inscription, e-mail de vérification, connexion
  assert.equal((await browser.call('auth', '/register', { method: 'POST', body: { email, password: PASSWORD } })).status, 202);
  await drain();
  const verification = mails.findLast((m) => m.kind === 'sendVerification' && m.to === email);
  assert.ok(verification, 'e-mail de vérification envoyé');
  const unverified = await browser.call('auth', '/login', { method: 'POST', body: { email, password: PASSWORD } });
  assert.equal(unverified.status, 200);
  browser.setToken(unverified.body.accessToken);
  step('inscription + connexion (e-mail non vérifié)');

  // Commande refusée tant que l'e-mail n'est pas vérifié
  const address = { line1: '12 rue des Potiers', postalCode: '69001', city: 'Lyon' };
  assert.equal((await browser.call('orders', '/', { method: 'POST', body: { shippingAddress: address } })).status, 403);
  assert.equal((await browser.call('auth', '/verify-email', { method: 'POST', body: { token: verification.token } })).status, 200);
  step('lien de vérification à usage unique');

  // Reconnexion vérifiée, fusion du panier invité
  const login = await browser.call('auth', '/login', { method: 'POST', body: { email, password: PASSWORD } });
  browser.setToken(login.body.accessToken);
  const merged = await browser.call('cart', '/merge', { method: 'POST' });
  assert.equal(merged.body.itemCount, 2);
  assert.ok(!browser.jar.has('cart_sid'));
  await browser.call('cart', '/items', { method: 'POST', body: { productId: teapot.id } });
  step('panier invité fusionné dans le panier du compte');

  // Commande : prix vérifiés côté serveur (JWKS + cart + catalog en HTTP réel)
  const ordered = await browser.call('orders', '/', { method: 'POST', headers: { 'X-Request-Id': 'e2e-request-0001' }, body: { shippingAddress: address } });
  assert.equal(ordered.status, 201, JSON.stringify(ordered.body));
  assert.equal(ordered.body.order.totalCents, 2 * bowl.priceCents + teapot.priceCents);
  assert.equal((await browser.call('cart', '/')).body.itemCount, 0);
  step(`commande ${ordered.body.order.reference} : ${ordered.body.order.totalCents / 100} € à régler sur place, panier vidé`);

  const mine = await browser.call('orders', '/me');
  assert.equal(mine.body.total, 1);
  const stranger = client();
  await stranger.call('auth', '/register', { method: 'POST', body: { email: `autre${Date.now()}@example.test`, password: PASSWORD } });
  await drain();
  const sm = mails.findLast((m) => m.kind === 'sendVerification' && m.to.startsWith('autre'));
  await stranger.call('auth', '/verify-email', { method: 'POST', body: { token: sm.token } });
  const sl = await stranger.call('auth', '/login', { method: 'POST', body: { email: sm.to, password: PASSWORD } });
  stranger.setToken(sl.body.accessToken);
  assert.equal((await stranger.call('orders', `/${ordered.body.order.id}`)).status, 404);
  step('la commande d’un autre utilisateur reste inaccessible (404)');

  // Deuxième session, changement de mot de passe, déconnexion des autres sessions
  const phone = client();
  const second = await phone.call('auth', '/login', { method: 'POST', body: { email, password: PASSWORD } });
  phone.setToken(second.body.accessToken);
  assert.equal((await phone.call('auth', '/me/sessions')).body.sessions.length, 3);
  const newPassword = 'Nouveau-Mot-De-Passe-2026';
  assert.equal((await browser.call('auth', '/me/password', { method: 'POST', body: { currentPassword: PASSWORD, newPassword } })).status, 200);
  assert.equal((await phone.call('auth', '/me')).status, 401);
  assert.equal((await browser.call('auth', '/me')).status, 200);
  step('changement de mot de passe : l’autre session est déconnectée');

  // Rotation du jeton de rafraîchissement et détection de réutilisation
  const old = browser.jar.get('refresh_token');
  assert.equal((await browser.call('auth', '/refresh', { method: 'POST' })).status, 200);
  const replay = client();
  replay.jar.set('refresh_token', old);
  assert.equal((await replay.call('auth', '/refresh', { method: 'POST' })).status, 401);
  assert.equal((await browser.call('auth', '/refresh', { method: 'POST' })).status, 401);
  step('réutilisation d’un ancien jeton de rafraîchissement : toute la famille est révoquée');

  // Double authentification
  const c2 = client();
  const l2 = await c2.call('auth', '/login', { method: 'POST', body: { email, password: newPassword } });
  c2.setToken(l2.body.accessToken);
  const fresh = (await c2.call('auth', '/reauth', { method: 'POST', body: { password: newPassword } })).body.freshToken;
  const setup = await c2.call('auth', '/me/2fa/setup', { method: 'POST', headers: { 'X-Fresh-Token': fresh } });
  const enabled = await c2.call('auth', '/me/2fa/enable', { method: 'POST', headers: { 'X-Fresh-Token': fresh }, body: { code: await generate({ secret: setup.body.secret }) } });
  assert.equal(enabled.body.backupCodes.length, 10);
  const challenge = await client().call('auth', '/login', { method: 'POST', body: { email, password: newPassword } });
  assert.equal(challenge.body.twoFactorRequired, true);
  step('double authentification activée : 10 codes de secours, défi à la connexion');

  // Métriques et sondes
  for (const [name, port] of Object.entries(PORTS)) {
    assert.equal((await fetch(`http://127.0.0.1:${port}/readyz`)).status, 200, `${name} prêt`);
    assert.match(await (await fetch(`http://127.0.0.1:${port}/metrics`)).text(), /http_requests_total/);
  }
  step('/readyz et /metrics disponibles sur les 4 services');
  console.log('\nParcours de bout en bout : OK');
} catch (err) {
  console.error('\n✘ Échec :', err.message);
  process.exitCode = 1;
} finally {
  servers.forEach((s) => s.close());
  setTimeout(() => process.exit(process.exitCode ?? 0), 200);
}
