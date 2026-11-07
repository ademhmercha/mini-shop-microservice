import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  makeTestApp, signup, login, signupAndLogin, csrf, bearer, fresh, totpNow, uniqueEmail, PASSWORD, refreshCookieOf, ORIGIN,
} from './helpers.js';

let ctx;
beforeAll(async () => {
  ctx = await makeTestApp({ env: { IP_RATE_LIMIT_MAX: '1000' } });
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await ctx.redis.flushall();
});

describe('inscription et vérification', () => {
  it("inscrit, envoie un lien d'e-mail à usage unique et permet la connexion", async () => {
    const email = uniqueEmail();
    const res = await ctx.agent.post('/register').send({ email, password: PASSWORD }).expect(202);
    expect(res.body.message).toBeTruthy();
    await ctx.background.drain();
    const mail = ctx.mailer.last('verification', email);
    expect(mail.token).toBeTruthy();

    const row = (await ctx.db.query('SELECT password_hash, email_verified_at FROM users WHERE email = $1', [email])).rows[0];
    expect(row.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(row.password_hash).not.toContain(PASSWORD);
    expect(row.email_verified_at).toBeNull();

    await ctx.agent.post('/verify-email').send({ token: mail.token }).expect(200);
    await ctx.agent.post('/verify-email').send({ token: mail.token }).expect(400); // usage unique

    const { res: loginRes } = await login(ctx, email);
    expect(loginRes.body.user.emailVerified).toBe(true);
  });

  it('renvoie le lien de vérification (limité à un par minute) tant que l’adresse n’est pas confirmée', async () => {
    const a = await signupAndLogin(ctx, { verify: false });
    const again = await bearer(ctx.agent.post('/resend-verification'), a.accessToken).expect(202);
    expect(again.body.sent).toBe(true);
    await ctx.background.drain();
    const mail = ctx.mailer.last('verification', a.email);
    await bearer(ctx.agent.post('/resend-verification'), a.accessToken).expect(429);
    await ctx.agent.post('/verify-email').send({ token: mail.token }).expect(200);
    const done = await bearer(ctx.agent.post('/resend-verification'), a.accessToken).expect(202);
    expect(done.body.sent).toBe(false);
    await ctx.agent.post('/resend-verification').expect(401);
  });

  it('refuse les mots de passe faibles, courants ou contenant l’e-mail', async () => {
    const email = uniqueEmail('camille');
    const short = await ctx.agent.post('/register').send({ email, password: 'Court1!' }).expect(400);
    expect(short.body.error.fields.password).toMatch(/12 caractères/);
    const common = await ctx.agent.post('/register').send({ email, password: 'passwordpassword' }).expect(400);
    expect(common.body.error.fields.password).toBeTruthy();
    const withMail = await ctx.agent.post('/register').send({ email, password: `${email.split('@')[0]}-Zx9!` }).expect(400);
    expect(withMail.body.error.fields.password).toMatch(/e-mail/);
  });

  it('valide strictement les entrées (champ inconnu, e-mail invalide)', async () => {
    await ctx.agent.post('/register').send({ email: 'pas-un-email', password: PASSWORD }).expect(400);
    await ctx.agent.post('/register').send({ email: uniqueEmail(), password: PASSWORD, isAdmin: true }).expect(400);
    await ctx.agent.post('/register').set('Content-Type', 'application/json').send('{bad json').expect(400);
  });

  it('refuse un corps trop volumineux', async () => {
    await ctx.agent.post('/register').send({ email: uniqueEmail(), password: 'a'.repeat(20000) }).expect(413);
  });

  it('réinscription avec une adresse existante : même réponse, e-mail "déjà un compte"', async () => {
    const { email } = await signup(ctx);
    const res = await ctx.agent.post('/register').send({ email, password: PASSWORD }).expect(202);
    await ctx.background.drain();
    expect(res.body.message).toMatch(/Si cette adresse est valide/);
    expect(ctx.mailer.last('alreadyRegistered', email)).toBeTruthy();
  });
});

describe('connexion, jetons et sessions', () => {
  it('émet un JWT EdDSA court, un cookie HttpOnly strict et publie le JWKS sans clé privée', async () => {
    const { accessToken, cookie, res } = await signupAndLogin(ctx);
    const setCookie = res.headers['set-cookie'][0];
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).toMatch(/Path=\/api\/auth/);
    expect(res.body.refreshToken).toBeUndefined();
    expect(cookie).toBeTruthy();

    const [h, p] = accessToken.split('.').slice(0, 2).map((s) => JSON.parse(Buffer.from(s, 'base64url').toString()));
    expect(h.alg).toBe('EdDSA');
    expect(h.kid).toBe('key-1');
    expect(p.exp - p.iat).toBe(900);

    const jwks = await ctx.agent.get('/.well-known/jwks.json').expect(200);
    expect(jwks.body.keys[0]).toMatchObject({ kty: 'OKP', crv: 'Ed25519', kid: 'key-1', alg: 'EdDSA' });
    expect(jwks.body.keys[0].d).toBeUndefined();
  });

  it('exige l’en-tête CSRF et l’origine du site sur les routes à cookie', async () => {
    await ctx.agent.post('/refresh').expect(403);
    await ctx.agent.post('/refresh').set('X-Requested-With', 'shoplite').expect(403);
    await ctx.agent.post('/refresh').set('X-Requested-With', 'shoplite').set('Origin', 'https://evil.example').expect(403);
    await ctx.agent.post('/login').send({ email: uniqueEmail(), password: PASSWORD }).expect(403);
  });

  it('fait tourner le jeton de rafraîchissement et renvoie un nouveau jeton d’accès', async () => {
    const { cookie } = await signupAndLogin(ctx);
    const r = await csrf(ctx.agent.post('/refresh')).set('Cookie', cookie).expect(200);
    expect(r.body.accessToken).toBeTruthy();
    const next = refreshCookieOf(r);
    expect(next).toBeTruthy();
    expect(next).not.toBe(cookie);
  });

  it('refuse un refresh sans cookie ou avec un cookie inconnu', async () => {
    await csrf(ctx.agent.post('/refresh')).expect(401);
    await csrf(ctx.agent.post('/refresh')).set('Cookie', 'refresh_token=inconnu').expect(401);
  });

  it('refuse un jeton de rafraîchissement expiré ou une session révoquée', async () => {
    const a = await signupAndLogin(ctx);
    await ctx.db.query("UPDATE refresh_tokens SET expires_at = now() - interval '1 minute'");
    await csrf(ctx.agent.post('/refresh')).set('Cookie', a.cookie).expect(401);
  });

  it('déconnecte : la session est révoquée et le refresh ne marche plus', async () => {
    const { cookie, accessToken } = await signupAndLogin(ctx);
    const out = await csrf(ctx.agent.post('/logout')).set('Cookie', cookie).expect(204);
    expect(out.headers['set-cookie'][0]).toMatch(/refresh_token=;/);
    await csrf(ctx.agent.post('/refresh')).set('Cookie', cookie).expect(401);
    await bearer(ctx.agent.get('/me'), accessToken).expect(401); // session révoquée, effet immédiat sur auth
    await csrf(ctx.agent.post('/logout')).expect(204); // sans cookie : idempotent
  });

  it('liste les sessions actives et permet de déconnecter les autres', async () => {
    const a = await signupAndLogin(ctx);
    const b = await login(ctx, a.email, a.password, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/604.1');
    const list = await bearer(ctx.agent.get('/me/sessions'), a.accessToken).expect(200);
    expect(list.body.sessions).toHaveLength(2);
    expect(list.body.sessions.filter((s) => s.current)).toHaveLength(1);
    expect(list.body.sessions.map((s) => s.device).join()).toMatch(/iOS/);

    await bearer(ctx.agent.delete('/me/sessions'), a.accessToken).expect(403); // confirmation récente requise
    const f = await fresh(ctx, a.accessToken);
    const del = await bearer(ctx.agent.delete('/me/sessions'), a.accessToken).set('X-Fresh-Token', f).expect(200);
    expect(del.body.revoked).toBe(1);
    await bearer(ctx.agent.get('/me'), b.accessToken).expect(401);
    await bearer(ctx.agent.get('/me'), a.accessToken).expect(200);
  });

  it('déconnecte une session précise', async () => {
    const a = await signupAndLogin(ctx);
    const b = await login(ctx, a.email, a.password);
    const f = await fresh(ctx, a.accessToken);
    const sessions = (await bearer(ctx.agent.get('/me/sessions'), a.accessToken)).body.sessions;
    const other = sessions.find((s) => !s.current);
    await bearer(ctx.agent.delete(`/me/sessions/${other.id}`), a.accessToken).set('X-Fresh-Token', f).expect(204);
    await bearer(ctx.agent.delete(`/me/sessions/${other.id}`), a.accessToken).set('X-Fresh-Token', f).expect(404);
    await bearer(ctx.agent.delete('/me/sessions/pas-un-uuid'), a.accessToken).set('X-Fresh-Token', f).expect(400);
    await bearer(ctx.agent.get('/me'), b.accessToken).expect(401);
  });
});

describe('mot de passe oublié et réinitialisation', () => {
  it('réinitialise avec un lien à usage unique et révoque toutes les sessions', async () => {
    const a = await signupAndLogin(ctx);
    await ctx.agent.post('/forgot-password').send({ email: a.email }).expect(202);
    await ctx.background.drain();
    const { token } = ctx.mailer.last('reset', a.email);
    const newPassword = 'Un-Autre-Mot-De-Passe-42';
    await ctx.agent.post('/reset-password').send({ token, newPassword: 'court' }).expect(400);
    await ctx.agent.post('/reset-password').send({ token, newPassword }).expect(200);
    await ctx.agent.post('/reset-password').send({ token, newPassword: `${newPassword}x` }).expect(400); // réutilisé
    await csrf(ctx.agent.post('/refresh')).set('Cookie', a.cookie).expect(401);
    expect((await login(ctx, a.email, newPassword)).res.status).toBe(200);
    expect((await login(ctx, a.email, a.password)).res.status).toBe(401);
  });

  it('refuse un lien expiré et répond de la même façon pour un compte inconnu', async () => {
    const a = await signup(ctx);
    await ctx.agent.post('/forgot-password').send({ email: a.email }).expect(202);
    const unknown = await ctx.agent.post('/forgot-password').send({ email: uniqueEmail('inconnu') }).expect(202);
    const known = await ctx.agent.post('/forgot-password').send({ email: a.email }).expect(202);
    expect(unknown.body).toEqual(known.body);
    await ctx.background.drain();
    expect(ctx.mailer.outbox.filter((m) => m.kind === 'reset' && m.to.startsWith('inconnu'))).toHaveLength(0);
    const { token } = ctx.mailer.last('reset', a.email);
    await ctx.db.query("UPDATE email_tokens SET expires_at = now() - interval '1 second' WHERE purpose = 'reset'");
    await ctx.agent.post('/reset-password').send({ token, newPassword: 'Encore-Un-Bon-Mot-De-Passe-1' }).expect(400);
  });

  it('applique la politique de mot de passe lors de la réinitialisation', async () => {
    const a = await signup(ctx);
    await ctx.agent.post('/forgot-password').send({ email: a.email }).expect(202);
    await ctx.background.drain();
    const { token } = ctx.mailer.last('reset', a.email);
    const res = await ctx.agent.post('/reset-password').send({ token, newPassword: 'passwordpassword' }).expect(400);
    expect(res.body.error.fields.newPassword).toBeTruthy();
  });
});

describe('profil', () => {
  it('met à jour les informations et l’adresse de livraison', async () => {
    const a = await signupAndLogin(ctx);
    const res = await bearer(ctx.agent.patch('/me'), a.accessToken)
      .send({ firstName: 'Camille', lastName: 'Dupont', shippingAddress: { line1: '1 rue des Potiers', postalCode: '69001', city: 'Lyon' } })
      .expect(200);
    expect(res.body.user.firstName).toBe('Camille');
    expect(res.body.user.shippingAddress.country).toBe('France');
    const removed = await bearer(ctx.agent.patch('/me'), a.accessToken).send({ shippingAddress: null }).expect(200);
    expect(removed.body.user.shippingAddress).toBeNull();
    expect(removed.body.user.firstName).toBe('Camille');
    await bearer(ctx.agent.patch('/me'), a.accessToken).send({ shippingAddress: { line1: '' } }).expect(400);
  });

  it('change le mot de passe (ancien obligatoire) et révoque les autres sessions', async () => {
    const a = await signupAndLogin(ctx);
    const other = await login(ctx, a.email, a.password);
    const newPassword = 'Nouveau-Mot-De-Passe-2026';
    await bearer(ctx.agent.post('/me/password'), a.accessToken).send({ currentPassword: 'mauvais', newPassword }).expect(403);
    await bearer(ctx.agent.post('/me/password'), a.accessToken).send({ currentPassword: a.password, newPassword: 'court' }).expect(400);
    await bearer(ctx.agent.post('/me/password'), a.accessToken).send({ currentPassword: a.password, newPassword }).expect(200);
    await bearer(ctx.agent.get('/me'), other.accessToken).expect(401);
    await bearer(ctx.agent.get('/me'), a.accessToken).expect(200);
    expect((await login(ctx, a.email, newPassword)).res.status).toBe(200);
  });

  it('change l’e-mail seulement après vérification de la nouvelle adresse', async () => {
    const a = await signupAndLogin(ctx);
    const newEmail = uniqueEmail('nouveau');
    await bearer(ctx.agent.post('/me/email'), a.accessToken).send({ password: 'mauvais', newEmail }).expect(403);
    await bearer(ctx.agent.post('/me/email'), a.accessToken).send({ password: a.password, newEmail }).expect(202);
    await ctx.background.drain();
    expect((await bearer(ctx.agent.get('/me'), a.accessToken)).body.user.email).toBe(a.email); // pas encore remplacée
    const { token } = ctx.mailer.last('emailChange', newEmail);
    const v = await ctx.agent.post('/verify-email').send({ token }).expect(200);
    expect(v.body.purpose).toBe('change_email');
    expect((await login(ctx, newEmail, a.password)).res.status).toBe(200);
  });

  it('ne révèle pas qu’une adresse est déjà utilisée lors d’un changement d’e-mail', async () => {
    const a = await signupAndLogin(ctx);
    const b = await signup(ctx);
    const res = await bearer(ctx.agent.post('/me/email'), a.accessToken).send({ password: a.password, newEmail: b.email }).expect(202);
    await ctx.background.drain();
    expect(res.body.message).toBeTruthy();
    expect(ctx.mailer.last('emailChange', b.email)).toBeUndefined();
    await bearer(ctx.agent.post('/me/email'), a.accessToken).send({ password: a.password, newEmail: a.email }).expect(202);
  });

  it('exporte les données personnelles (confirmation récente requise)', async () => {
    const a = await signupAndLogin(ctx);
    await bearer(ctx.agent.get('/me/export'), a.accessToken).expect(403);
    const f = await fresh(ctx, a.accessToken);
    const res = await bearer(ctx.agent.get('/me/export'), a.accessToken).set('X-Fresh-Token', f).expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.body.account.email).toBe(a.email);
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|password_hash|totp_secret/);
    expect(res.body.securityEvents.length).toBeGreaterThan(0);
  });

  it('supprime le compte (mot de passe obligatoire) et appelle l’effacement des autres services', async () => {
    const purged = [];
    const c2 = await makeTestApp({ internal: { purgeUser: async (id) => purged.push(id) } });
    const a = await signupAndLogin(c2);
    await bearer(c2.agent.delete('/me'), a.accessToken).send({ password: 'mauvais' }).expect(403);
    await bearer(c2.agent.delete('/me'), a.accessToken).send({ password: a.password }).expect(204);
    await c2.background.drain();
    expect(purged).toHaveLength(1);
    expect((await login(c2, a.email, a.password)).res.status).toBe(401);
    const left = await c2.db.query('SELECT count(*)::int AS n FROM sessions');
    expect(left.rows[0].n).toBe(0);
    const events = (await c2.db.query('SELECT event FROM audit_log')).rows.map((r) => r.event);
    expect(events).toContain('account_deleted');
    await c2.close();
  });
});

describe('double authentification', () => {
  async function enable2fa(a) {
    const f = await fresh(ctx, a.accessToken);
    await bearer(ctx.agent.post('/me/2fa/setup'), a.accessToken).expect(403);
    const setup = await bearer(ctx.agent.post('/me/2fa/setup'), a.accessToken).set('X-Fresh-Token', f).expect(200);
    expect(setup.body.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const stored = (await ctx.db.query('SELECT totp_secret_enc FROM users WHERE email = $1', [a.email])).rows[0].totp_secret_enc;
    expect(stored).not.toContain(setup.body.secret); // chiffré au repos
    await bearer(ctx.agent.post('/me/2fa/enable'), a.accessToken).set('X-Fresh-Token', f).send({ code: '000000' }).expect(400);
    const enabled = await bearer(ctx.agent.post('/me/2fa/enable'), a.accessToken)
      .set('X-Fresh-Token', f).send({ code: await totpNow(setup.body.secret) }).expect(200);
    return { secret: setup.body.secret, backupCodes: enabled.body.backupCodes, f };
  }

  it('active la 2FA, génère 10 codes de secours hachés et exige le second facteur à la connexion', async () => {
    const a = await signupAndLogin(ctx);
    const { secret, backupCodes, f } = await enable2fa(a);
    expect(backupCodes).toHaveLength(10);
    const stored = (await ctx.db.query('SELECT code_hash FROM backup_codes')).rows;
    expect(stored.every((r) => r.code_hash.startsWith('$argon2id$'))).toBe(true);
    await bearer(ctx.agent.post('/me/2fa/setup'), a.accessToken).set('X-Fresh-Token', f).expect(409);

    const step1 = await login(ctx, a.email, a.password);
    expect(step1.res.body.twoFactorRequired).toBe(true);
    expect(step1.cookie).toBeNull();
    const { challengeToken } = step1.res.body;
    await csrf(ctx.agent.post('/login/2fa')).send({ challengeToken, code: '123456' }).expect(401);
    await csrf(ctx.agent.post('/login/2fa')).send({ challengeToken, code: await totpNow(secret) }).expect(429); // délai croissant
    for (const k of await ctx.redis.keys('delay:*')) await ctx.redis.del(k);
    const ok = await csrf(ctx.agent.post('/login/2fa')).send({ challengeToken, code: await totpNow(secret) }).expect(200);
    expect(refreshCookieOf(ok)).toBeTruthy();
    // le défi est à usage unique
    await csrf(ctx.agent.post('/login/2fa')).send({ challengeToken, code: await totpNow(secret) }).expect(401);
  });

  it('accepte un code de secours une seule fois', async () => {
    const a = await signupAndLogin(ctx);
    const { backupCodes } = await enable2fa(a);
    const first = (await login(ctx, a.email, a.password)).res.body.challengeToken;
    await csrf(ctx.agent.post('/login/2fa')).send({ challengeToken: first, code: backupCodes[0] }).expect(200);
    const second = (await login(ctx, a.email, a.password)).res.body.challengeToken;
    await csrf(ctx.agent.post('/login/2fa')).send({ challengeToken: second, code: backupCodes[0] }).expect(401);
    await csrf(ctx.agent.post('/login/2fa')).send({ challengeToken: 'x'.repeat(30), code: backupCodes[1] }).expect(401);
  });

  it('désactive la 2FA avec le mot de passe', async () => {
    const a = await signupAndLogin(ctx);
    const { f } = await enable2fa(a);
    await bearer(ctx.agent.post('/me/2fa/disable'), a.accessToken).set('X-Fresh-Token', f).send({ password: 'mauvais' }).expect(403);
    await bearer(ctx.agent.post('/me/2fa/disable'), a.accessToken).set('X-Fresh-Token', f).send({ password: a.password }).expect(200);
    expect((await login(ctx, a.email, a.password)).res.body.accessToken).toBeTruthy();
  });

  it('refuse d’activer sans configuration préalable', async () => {
    const a = await signupAndLogin(ctx);
    const f = await fresh(ctx, a.accessToken);
    await bearer(ctx.agent.post('/me/2fa/enable'), a.accessToken).set('X-Fresh-Token', f).send({ code: '123456' }).expect(400);
  });
});

describe('opérations', () => {
  it('répond sur /healthz, /readyz, /metrics et /docs', async () => {
    await ctx.agent.get('/healthz').expect(200);
    await ctx.agent.get('/readyz').expect(200);
    const m = await ctx.agent.get('/metrics').expect(200);
    expect(m.text).toMatch(/http_requests_total/);
    expect(m.text).toMatch(/auth_logins_succeeded_total/);
    expect(m.text).toMatch(/auth_logins_failed_total/);
    expect(m.text).toMatch(/auth_lockouts_total/);
    expect(m.text).toMatch(/http_request_duration_seconds/);
    await ctx.agent.get('/openapi.json').expect(200);
    await ctx.agent.get('/docs/').expect(200);
  });

  it('propage X-Request-Id, ignore les valeurs douteuses et renvoie 404 JSON', async () => {
    const ok = await ctx.agent.get('/healthz').set('X-Request-Id', 'abc12345-req').expect(200);
    expect(ok.headers['x-request-id']).toBe('abc12345-req');
    const bad = await ctx.agent.get('/healthz').set('X-Request-Id', 'x y z').expect(200);
    expect(bad.headers['x-request-id']).not.toContain(' ');
    const nf = await ctx.agent.get('/inexistant').expect(404);
    expect(nf.body.error.code).toBe('not_found');
  });

  it('envoie les en-têtes de sécurité Helmet et limite CORS à l’origine du site', async () => {
    const res = await ctx.agent.get('/me').set('Origin', ORIGIN);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeTruthy();
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['x-powered-by']).toBeUndefined();
    const evil = await ctx.agent.get('/me').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBe(ORIGIN); // jamais l'origine étrangère ni *
  });

  it('/readyz renvoie 503 si une dépendance est indisponible', async () => {
    const broken = await makeTestApp();
    broken.redis.ping = async () => { throw new Error('down'); };
    await broken.agent.get('/readyz').expect(503);
    await broken.close();
  });
});
