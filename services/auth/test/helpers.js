import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import { generate } from 'otplib';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { createPgliteDb } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createApp } from '../src/app.js';

export const ORIGIN = 'http://localhost:8080';
export const PASSWORD = 'Correct-Horse-Battery-9';
const here = path.dirname(fileURLToPath(import.meta.url));

export function testEnv(extra = {}) {
  const { privateKey } = generateKeyPairSync('ed25519');
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://unused',
    REDIS_URL: 'redis://unused',
    APP_ORIGIN: ORIGIN,
    COOKIE_SECURE: 'false',
    JWT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    SMTP_HOST: 'localhost',
    ...extra,
  };
}

export function fakeMailer() {
  const outbox = [];
  const push = (kind) => async (to, a, b) => {
    outbox.push({ kind, to, token: kind === 'securityNotice' ? undefined : a, subject: kind === 'securityNotice' ? a : undefined, body: b });
  };
  return {
    outbox,
    sendVerification: push('verification'),
    sendAlreadyRegistered: push('alreadyRegistered'),
    sendPasswordReset: push('reset'),
    sendEmailChange: push('emailChange'),
    sendSecurityNotice: push('securityNotice'),
    last: (kind, to) => [...outbox].reverse().find((m) => m.kind === kind && (!to || m.to === to)),
  };
}

export async function makeTestApp({ env = {}, internal, logStream } = {}) {
  const cfg = loadConfig(testEnv(env));
  const pglite = new PGlite();
  const db = createPgliteDb(pglite);
  await runMigrations(db, path.join(here, '..', 'migrations'));
  const redis = new RedisMock();
  const mailer = fakeMailer();
  const log = createLogger(logStream ? 'info' : 'silent', logStream);
  const built = createApp({ cfg, db, redis, log, mailer, internal });
  const agent = request(built.app);
  return { ...built, cfg, db, redis, mailer, log, agent, close: () => db.close() };
}

let counter = 0;
export const uniqueEmail = (prefix = 'user') => `${prefix}${Date.now()}${counter++}@example.test`;

export const csrf = (req) => req.set('Origin', ORIGIN).set('X-Requested-With', 'shoplite');
export const bearer = (req, token) => req.set('Authorization', `Bearer ${token}`);

export function refreshCookieOf(res) {
  const cookies = res.headers['set-cookie'] ?? [];
  const c = cookies.find((x) => x.startsWith('refresh_token='));
  return c ? c.split(';')[0] : null;
}

/** Inscrit, confirme l'e-mail et connecte un utilisateur. */
export async function signup(ctx, { email = uniqueEmail(), password = PASSWORD, verify = true } = {}) {
  await ctx.agent.post('/register').send({ email, password }).expect(202);
  await ctx.background.drain();
  if (verify) {
    const { token } = ctx.mailer.last('verification', email);
    await ctx.agent.post('/verify-email').send({ token }).expect(200);
  }
  return { email, password };
}

export async function login(ctx, email, password = PASSWORD, ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36') {
  const res = await csrf(ctx.agent.post('/login')).set('User-Agent', ua).send({ email, password });
  return { res, cookie: refreshCookieOf(res), accessToken: res.body.accessToken };
}

export async function signupAndLogin(ctx, opts) {
  const creds = await signup(ctx, opts);
  const session = await login(ctx, creds.email, creds.password);
  return { ...creds, ...session };
}

export async function fresh(ctx, accessToken, password = PASSWORD) {
  const res = await bearer(ctx.agent.post('/reauth'), accessToken).send({ password }).expect(200);
  return res.body.freshToken;
}

export const totpNow = (secret) => generate({ secret });
