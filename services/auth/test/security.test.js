import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { SignJWT } from 'jose';
import {
  makeTestApp, signup, signupAndLogin, login, csrf, bearer, uniqueEmail, refreshCookieOf,
} from './helpers.js';

let ctx;
beforeAll(async () => {
  ctx = await makeTestApp({ env: { IP_RATE_LIMIT_MAX: '1000' } });
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await ctx.redis.flushall();
});

const clearDelays = async () => {
  for (const k of await ctx.redis.keys('delay:*')) await ctx.redis.del(k);
};

describe('attaques sur la connexion', () => {
  it('mauvais mot de passe : 401 générique, identique pour un compte inexistant', async () => {
    const a = await signup(ctx);
    const wrong = await login(ctx, a.email, 'Mauvais-Mot-De-Passe-1');
    await clearDelays();
    const unknown = await login(ctx, uniqueEmail('fantome'), 'Mauvais-Mot-De-Passe-1');
    expect(wrong.res.status).toBe(401);
    expect(unknown.res.status).toBe(401);
    const strip = (b) => ({ ...b, error: { ...b.error, requestId: undefined } });
    expect(strip(wrong.res.body)).toEqual(strip(unknown.res.body));
    expect(wrong.res.body.error.message).toBe('Adresse e-mail ou mot de passe incorrect.');
    expect(wrong.res.headers['set-cookie']).toBeUndefined();
  });

  it('temps de réponse comparables que le compte existe ou non (hachage factice)', async () => {
    const a = await signup(ctx);
    const time = async (email) => {
      await clearDelays();
      const t = performance.now();
      await login(ctx, email, 'Mauvais-Mot-De-Passe-1');
      return performance.now() - t;
    };
    await time(a.email); // chauffe
    const known = [];
    const unknown = [];
    for (let i = 0; i < 3; i += 1) {
      known.push(await time(a.email));
      unknown.push(await time(uniqueEmail('fantome')));
    }
    const median = (xs) => [...xs].sort((x, y) => x - y)[1];
    const ratio = median(unknown) / median(known);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(2.5);
  });

  it('impose un délai croissant puis verrouille le compte (y compris un bon mot de passe ensuite)', async () => {
    const a = await signup(ctx);
    const first = await login(ctx, a.email, 'Mauvais-Mot-De-Passe-1');
    expect(first.res.status).toBe(401);
    const tooFast = await login(ctx, a.email, a.password); // dans le délai : refusé même avec le bon mot de passe
    expect(tooFast.res.status).toBe(429);
    expect(tooFast.res.headers['retry-after']).toBeTruthy();

    for (let i = 0; i < 4; i += 1) {
      await clearDelays();
      await login(ctx, a.email, 'Mauvais-Mot-De-Passe-1');
    }
    await clearDelays();
    const locked = await login(ctx, a.email, a.password);
    expect(locked.res.status).toBe(429);
    expect(Number(locked.res.headers['retry-after'])).toBeGreaterThan(60);
    const metrics = (await ctx.agent.get('/metrics')).text;
    expect(metrics).toMatch(/auth_lockouts_total 1/);
    const events = (await ctx.db.query('SELECT event FROM audit_log')).rows.map((r) => r.event);
    expect(events).toContain('account_locked');
    expect(events).toContain('login_failed');
  });

  it('le verrouillage est identique pour un compte inexistant (pas d’énumération)', async () => {
    const email = uniqueEmail('fantome');
    for (let i = 0; i < 5; i += 1) {
      await clearDelays();
      await login(ctx, email, 'Mauvais-Mot-De-Passe-1');
    }
    await clearDelays();
    expect((await login(ctx, email, 'Mauvais-Mot-De-Passe-1')).res.status).toBe(429);
  });

  it('limite le nombre de tentatives par adresse IP', async () => {
    const limited = await makeTestApp({ env: { IP_RATE_LIMIT_MAX: '3' } });
    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push((await login(limited, uniqueEmail(), 'Mauvais-Mot-De-Passe-1')).res.status);
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3)).toEqual([429, 429]);
    await limited.close();
  });
});

describe('jetons d’accès', () => {
  const claims = (a, extra = {}) => ({ sub: a.sub, sid: a.sid, email: 'x@example.test', email_verified: true, ...extra });

  async function victim() {
    const a = await signupAndLogin(ctx);
    const payload = JSON.parse(Buffer.from(a.accessToken.split('.')[1], 'base64url').toString());
    return { ...a, sub: payload.sub, sid: payload.sid };
  }

  it('refuse une requête sans jeton ou avec un schéma inconnu', async () => {
    await ctx.agent.get('/me').expect(401);
    await ctx.agent.get('/me').set('Authorization', 'Basic abc').expect(401);
    await ctx.agent.get('/me').set('Authorization', 'Bearer n-importe-quoi').expect(401);
  });

  it('refuse un jeton expiré', async () => {
    const a = await victim();
    const key = createPrivateKey(ctx.cfg.JWT_PRIVATE_KEY);
    const expired = await new SignJWT(claims(a))
      .setProtectedHeader({ alg: 'EdDSA', kid: 'key-1' })
      .setIssuer('shoplite-auth').setAudience('shoplite')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600).setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    const res = await bearer(ctx.agent.get('/me'), expired).expect(401);
    expect(res.body.error.code).toBe('invalid_token');
  });

  it('refuse un jeton signé par une autre clé (falsifié)', async () => {
    const a = await victim();
    const { privateKey } = generateKeyPairSync('ed25519');
    const forged = await new SignJWT(claims(a))
      .setProtectedHeader({ alg: 'EdDSA', kid: 'key-1' })
      .setIssuer('shoplite-auth').setAudience('shoplite').setIssuedAt().setExpirationTime('10m')
      .sign(privateKey);
    await bearer(ctx.agent.get('/me'), forged).expect(401);
  });

  it('refuse un jeton dont le contenu a été modifié', async () => {
    const a = await victim();
    const [h, , s] = a.accessToken.split('.');
    const evil = Buffer.from(JSON.stringify({ ...claims(a), sub: '00000000-0000-4000-8000-000000000000', iss: 'shoplite-auth', aud: 'shoplite', exp: 9999999999 })).toString('base64url');
    await bearer(ctx.agent.get('/me'), `${h}.${evil}.${s}`).expect(401);
  });

  it('refuse alg=none et l’échange RS/HS (confusion d’algorithme)', async () => {
    const a = await victim();
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims(a), iss: 'shoplite-auth', aud: 'shoplite', exp: 9999999999 })}.`;
    await bearer(ctx.agent.get('/me'), none).expect(401);
    const hs = await new SignJWT(claims(a))
      .setProtectedHeader({ alg: 'HS256', kid: 'key-1' }).setIssuer('shoplite-auth').setAudience('shoplite').setExpirationTime('10m')
      .sign(new TextEncoder().encode('x'.repeat(32)));
    await bearer(ctx.agent.get('/me'), hs).expect(401);
  });

  it('refuse un jeton destiné à un autre usage (mauvaise audience)', async () => {
    const a = await victim();
    const key = createPrivateKey(ctx.cfg.JWT_PRIVATE_KEY);
    const other = await new SignJWT(claims(a))
      .setProtectedHeader({ alg: 'EdDSA', kid: 'key-1' }).setIssuer('shoplite-auth').setAudience('autre-service')
      .setIssuedAt().setExpirationTime('10m').sign(key);
    await bearer(ctx.agent.get('/me'), other).expect(401);
    // un jeton "fresh" ne peut pas servir de jeton d'accès
    const fresh = await ctx.keyring.signPurpose('reauth', { sub: a.sub, sid: a.sid }, 300);
    await bearer(ctx.agent.get('/me'), fresh).expect(401);
  });

  it('refuse un jeton de confirmation récente appartenant à un autre utilisateur', async () => {
    const a = await victim();
    const b = await victim();
    const fb = (await bearer(ctx.agent.post('/reauth'), b.accessToken).send({ password: b.password })).body.freshToken;
    await bearer(ctx.agent.get('/me/export'), a.accessToken).set('X-Fresh-Token', fb).expect(403);
    await bearer(ctx.agent.get('/me/export'), a.accessToken).set('X-Fresh-Token', 'n-importe-quoi').expect(403);
  });

  it('limite les tentatives de /reauth avec un mauvais mot de passe', async () => {
    const a = await signupAndLogin(ctx);
    const res = await bearer(ctx.agent.post('/reauth'), a.accessToken).send({ password: 'mauvais' });
    expect(res.status).toBe(403);
    await bearer(ctx.agent.post('/reauth'), a.accessToken).send({ password: a.password }).expect(429); // délai
  });
});

describe('jetons de rafraîchissement', () => {
  it('détecte la réutilisation d’un ancien jeton et révoque toute la famille', async () => {
    const a = await signupAndLogin(ctx);
    const rotated = await csrf(ctx.agent.post('/refresh')).set('Cookie', a.cookie).expect(200);
    const newCookie = refreshCookieOf(rotated);

    // L'attaquant rejoue l'ancien jeton
    await csrf(ctx.agent.post('/refresh')).set('Cookie', a.cookie).expect(401);
    // Le jeton légitime le plus récent est lui aussi invalidé
    await csrf(ctx.agent.post('/refresh')).set('Cookie', newCookie).expect(401);
    await bearer(ctx.agent.get('/me'), rotated.body.accessToken).expect(401);

    const events = (await ctx.db.query('SELECT event FROM audit_log')).rows.map((r) => r.event);
    expect(events).toContain('refresh_reuse_detected');
  });

  it('ne stocke que des empreintes des jetons (jamais la valeur du cookie)', async () => {
    const a = await signupAndLogin(ctx);
    const raw = a.cookie.split('=')[1];
    const rows = (await ctx.db.query('SELECT token_hash FROM refresh_tokens')).rows;
    expect(rows.some((r) => r.token_hash === raw)).toBe(false);
    const tokens = (await ctx.db.query('SELECT token_hash FROM email_tokens')).rows;
    expect(tokens.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash))).toBe(true);
  });
});

describe('journaux et audit', () => {
  it('n’écrit aucun mot de passe, jeton ou cookie dans les logs ni dans le journal d’audit', async () => {
    const lines = [];
    const logStream = { write: (l) => lines.push(l) };
    const c = await makeTestApp({ logStream, env: { IP_RATE_LIMIT_MAX: '1000' } });
    const a = await signupAndLogin(c, { password: 'Un-Secret-Tres-Sensible-77' });
    await login(c, a.email, 'Mauvais-Secret-Tres-Sensible-88');
    await bearer(c.agent.get('/me'), a.accessToken);
    const output = lines.join('');
    const auditRows = JSON.stringify((await c.db.query('SELECT * FROM audit_log')).rows);

    for (const secret of ['Un-Secret-Tres-Sensible-77', 'Mauvais-Secret-Tres-Sensible-88', a.accessToken, a.cookie.split('=')[1]]) {
      expect(output).not.toContain(secret);
      expect(auditRows).not.toContain(secret);
    }
    expect(output).toMatch(/"audit":true/);
    expect(output).toMatch(/login_failed/);
    await c.close();
  });

  it('le logger masque automatiquement les champs sensibles', async () => {
    const { createLogger } = await import('../src/logger.js');
    const lines = [];
    const log = createLogger('info', { write: (l) => lines.push(l) });
    log.info({ password: 'p1', user: { password: 'p2', token: 't', email: 'ok@example.test' }, req: { headers: { authorization: 'Bearer abc', cookie: 'refresh_token=zzz' } } }, 'test');
    const out = lines.join('');
    expect(out).not.toMatch(/p1|p2|Bearer abc|zzz/);
    expect(out).toContain('[REDACTED]');
    expect(out).toContain('ok@example.test');
  });
});
