import QRCode from 'qrcode';
import { generateSecret, generateURI, verify as verifyTotpCode } from 'otplib';
import { hashPassword, verifyPassword, dummyVerify } from '../lib/passwords.js';
import { newOpaqueToken, sha256, newBackupCode } from '../lib/tokens.js';
import { AppError, unauthorized, badRequest, notFound, tooMany } from '../lib/errors.js';
import { describeDevice } from '../lib/userAgent.js';

const VERIFY_TTL = 24 * 3600;
const RESET_TTL = 30 * 60;
const CHALLENGE_TTL = 5 * 60;
const FRESH_TTL = 5 * 60;
const INVALID_CREDENTIALS = () => unauthorized('Adresse e-mail ou mot de passe incorrect.', 'invalid_credentials');
const INVALID_LINK = () => badRequest('Ce lien est invalide ou a expiré.', 'invalid_token');

const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  emailVerified: Boolean(u.email_verified_at),
  firstName: u.first_name,
  lastName: u.last_name,
  shippingAddress: u.shipping_address ?? null,
  twoFactorEnabled: u.totp_enabled,
  createdAt: u.created_at,
});

export function createAuthService({ db, cfg, keyring, limiter, mailer, secretBox, audit, metrics, background, internal }) {
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];

  async function createEmailToken(client, userId, purpose, ttl, newEmail = null) {
    const raw = newOpaqueToken();
    await client.query(
      `INSERT INTO email_tokens (user_id, purpose, token_hash, new_email, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5::int))`,
      [userId, purpose, sha256(raw), newEmail, ttl],
    );
    return raw;
  }

  async function issueSession(user, ctx) {
    const refreshToken = newOpaqueToken();
    const session = await db.tx(async (t) => {
      const s = (
        await t.query('INSERT INTO sessions (user_id, user_agent, ip) VALUES ($1, $2, $3) RETURNING id', [
          user.id, (ctx.userAgent ?? '').slice(0, 255), ctx.ip ?? '',
        ])
      ).rows[0];
      await t.query(
        `INSERT INTO refresh_tokens (session_id, token_hash, expires_at)
         VALUES ($1, $2, now() + make_interval(secs => $3::int))`,
        [s.id, sha256(refreshToken), cfg.REFRESH_TOKEN_TTL_SECONDS],
      );
      return s;
    });
    return { ...(await accessFor(user, session.id)), refreshToken };
  }

  async function accessFor(user, sessionId) {
    const accessToken = await keyring.signAccess({
      sub: user.id,
      email: user.email,
      email_verified: Boolean(user.email_verified_at),
      sid: sessionId,
    });
    return { accessToken, expiresIn: cfg.ACCESS_TOKEN_TTL_SECONDS, user: publicUser(user) };
  }

  async function verifySecondFactor(user, code) {
    const clean = String(code).trim().replace(/\s/g, '');
    if (/^\d{6}$/.test(clean)) {
      const secret = secretBox.decrypt(user.totp_secret_enc);
      const res = await verifyTotpCode({ secret, token: clean });
      return { ok: Boolean(res.valid), method: 'totp' };
    }
    const normalized = clean.toLowerCase();
    if (/^[0-9a-z]{5}-?[0-9a-z]{5}$/.test(normalized)) {
      const formatted = normalized.includes('-') ? normalized : `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
      const codes = (await db.query('SELECT id, code_hash FROM backup_codes WHERE user_id = $1 AND used_at IS NULL', [user.id])).rows;
      for (const c of codes) {
        if (await verifyPassword(c.code_hash, formatted)) {
          const used = await one('UPDATE backup_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id', [c.id]);
          return { ok: Boolean(used), method: 'backup_code' };
        }
      }
    }
    return { ok: false, method: 'unknown' };
  }

  const svc = {
    publicUser,

    /* ---------- Inscription et vérification ---------- */
    register({ email, password }, ctx) {
      // Réponse identique que l'adresse existe ou non : tout le travail se fait après la réponse.
      background.run(async () => {
        const passwordHash = await hashPassword(password);
        const existing = await one('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
        if (existing) {
          await mailer.sendAlreadyRegistered(email);
          await audit('register_duplicate', { userId: existing.id, ip: ctx.ip, userAgent: ctx.userAgent });
          return;
        }
        let user;
        let token;
        try {
          ({ user, token } = await db.tx(async (t) => {
            const u = (await t.query('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id', [email, passwordHash])).rows[0];
            return { user: u, token: await createEmailToken(t, u.id, 'verify', VERIFY_TTL) };
          }));
        } catch (err) {
          if (err.code === '23505' || /unique/i.test(err.message)) return; // course entre deux inscriptions
          throw err;
        }
        await mailer.sendVerification(email, token);
        await audit('register', { userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent });
      });
    },

    /** Renvoie le lien de vérification (un par minute et par compte). */
    async resendVerification(userId) {
      const u = await svc.getUser(userId);
      if (u.email_verified_at) return { sent: false };
      if (!(await limiter.consumeOnce(`resend:${userId}`, 60))) throw tooMany(60);
      const token = await createEmailToken(db, userId, 'verify', VERIFY_TTL);
      background.run(() => mailer.sendVerification(u.email, token));
      return { sent: true };
    },

    async confirmEmailToken(rawToken, ctx) {
      const result = await db.tx(async (t) => {
        const row = (
          await t.query(
            `UPDATE email_tokens SET used_at = now()
             WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() AND purpose IN ('verify', 'change_email')
             RETURNING user_id, purpose, new_email`,
            [sha256(rawToken)],
          )
        ).rows[0];
        if (!row) return null;
        if (row.purpose === 'verify') {
          await t.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1', [row.user_id]);
        } else {
          const taken = (await t.query('SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2', [row.new_email, row.user_id])).rows[0];
          if (taken) throw new AppError(409, 'email_unavailable', "Cette adresse ne peut pas être utilisée.");
          await t.query('UPDATE users SET email = $2, email_verified_at = now(), updated_at = now() WHERE id = $1', [row.user_id, row.new_email]);
        }
        return row;
      });
      if (!result) throw INVALID_LINK();
      await audit(result.purpose === 'verify' ? 'email_verified' : 'email_changed', { userId: result.user_id, ip: ctx.ip, userAgent: ctx.userAgent });
      return { purpose: result.purpose };
    },

    /* ---------- Connexion ---------- */
    async login({ email, password }, ctx) {
      await limiter.hitIp(ctx.ip);
      await limiter.assertAccountOpen(email);
      const user = await one('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
      const ok = user ? await verifyPassword(user.password_hash, password) : await dummyVerify(password);
      if (!ok) {
        const { locked } = await limiter.recordFailure(email);
        metrics.loginsFailed.inc();
        await audit('login_failed', { userId: user?.id ?? null, ip: ctx.ip, userAgent: ctx.userAgent, metadata: { reason: 'bad_password' } });
        if (locked) {
          metrics.lockouts.inc();
          await audit('account_locked', { userId: user?.id ?? null, ip: ctx.ip, userAgent: ctx.userAgent });
        }
        throw INVALID_CREDENTIALS();
      }
      if (user.totp_enabled) {
        const challengeToken = await keyring.signPurpose('2fa', { sub: user.id }, CHALLENGE_TTL);
        return { twoFactorRequired: true, challengeToken };
      }
      await limiter.reset(email);
      metrics.loginsSucceeded.inc();
      await audit('login_success', { userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent });
      return issueSession(user, ctx);
    },

    async loginSecondFactor({ challengeToken, code }, ctx) {
      await limiter.hitIp(ctx.ip);
      let claims;
      try {
        claims = await keyring.verifyPurpose('2fa', challengeToken);
      } catch {
        throw unauthorized('Le défi a expiré. Reconnectez-vous.', 'challenge_invalid');
      }
      const user = await one('SELECT * FROM users WHERE id = $1', [claims.sub]);
      if (!user || !user.totp_enabled) throw unauthorized('Le défi a expiré. Reconnectez-vous.', 'challenge_invalid');
      await limiter.assertAccountOpen(user.email);
      const { ok, method } = await verifySecondFactor(user, code);
      if (!ok) {
        const { locked } = await limiter.recordFailure(user.email);
        metrics.loginsFailed.inc();
        await audit('login_failed', { userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent, metadata: { reason: 'bad_second_factor' } });
        if (locked) {
          metrics.lockouts.inc();
          await audit('account_locked', { userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent });
        }
        throw unauthorized('Code incorrect.', 'invalid_code');
      }
      if (!(await limiter.consumeOnce(`2fa:${claims.jti}`, CHALLENGE_TTL))) {
        throw unauthorized('Le défi a expiré. Reconnectez-vous.', 'challenge_invalid');
      }
      await limiter.reset(user.email);
      metrics.loginsSucceeded.inc();
      await audit('login_success', { userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent, metadata: { method } });
      return issueSession(user, ctx);
    },

    /* ---------- Jetons de rafraîchissement ---------- */
    async refresh(rawToken, ctx) {
      if (!rawToken) throw unauthorized('Session absente.', 'no_session');
      const row = await one(
        `SELECT rt.id, rt.session_id, rt.used_at, rt.expires_at < now() AS expired,
                s.user_id, s.family_id, s.revoked_at
         FROM refresh_tokens rt JOIN sessions s ON s.id = rt.session_id
         WHERE rt.token_hash = $1`,
        [sha256(rawToken)],
      );
      if (!row) throw unauthorized('Session invalide.', 'invalid_session');
      if (row.used_at) {
        // Réutilisation d'un ancien jeton : vol probable → on révoque toute la famille de sessions.
        await db.query('UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE family_id = $1', [row.family_id]);
        await audit('refresh_reuse_detected', { userId: row.user_id, ip: ctx.ip, userAgent: ctx.userAgent, metadata: { family: row.family_id } });
        throw unauthorized('Session invalide.', 'invalid_session');
      }
      if (row.revoked_at || row.expired) throw unauthorized('Session expirée.', 'invalid_session');

      const user = await one('SELECT * FROM users WHERE id = $1', [row.user_id]);
      if (!user) throw unauthorized('Session invalide.', 'invalid_session');
      const next = newOpaqueToken();
      const rotated = await db.tx(async (t) => {
        const claimed = (await t.query('UPDATE refresh_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id', [row.id])).rows[0];
        if (!claimed) return false;
        await t.query(
          `INSERT INTO refresh_tokens (session_id, token_hash, expires_at)
           VALUES ($1, $2, now() + make_interval(secs => $3::int))`,
          [row.session_id, sha256(next), cfg.REFRESH_TOKEN_TTL_SECONDS],
        );
        await t.query('UPDATE sessions SET last_seen_at = now(), ip = $2 WHERE id = $1', [row.session_id, ctx.ip ?? '']);
        return true;
      });
      if (!rotated) throw unauthorized('Session invalide.', 'invalid_session');
      return { ...(await accessFor(user, row.session_id)), refreshToken: next };
    },

    async logout(rawToken, ctx) {
      if (!rawToken) return;
      const row = await one(
        'UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE id = (SELECT session_id FROM refresh_tokens WHERE token_hash = $1) RETURNING user_id',
        [sha256(rawToken)],
      );
      if (row) await audit('logout', { userId: row.user_id, ip: ctx.ip, userAgent: ctx.userAgent });
    },

    async isSessionActive(sessionId, userId) {
      const s = await one('SELECT 1 AS ok FROM sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL', [sessionId, userId]);
      return Boolean(s);
    },

    /* ---------- Mot de passe oublié / réinitialisation ---------- */
    forgotPassword({ email }, ctx) {
      background.run(async () => {
        const user = await one('SELECT id, email FROM users WHERE lower(email) = lower($1)', [email]);
        if (!user) return;
        const token = await createEmailToken(db, user.id, 'reset', RESET_TTL);
        await mailer.sendPasswordReset(user.email, token);
        await audit('password_reset_requested', { userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent });
      });
    },

    async resetPassword({ token, newPassword }, ctx, policyCheck) {
      const row = await one(
        `SELECT et.id, et.user_id, u.email FROM email_tokens et JOIN users u ON u.id = et.user_id
         WHERE et.token_hash = $1 AND et.purpose = 'reset' AND et.used_at IS NULL AND et.expires_at > now()`,
        [sha256(token)],
      );
      if (!row) throw INVALID_LINK();
      policyCheck(newPassword, row.email);
      const passwordHash = await hashPassword(newPassword);
      const done = await db.tx(async (t) => {
        const claimed = (await t.query('UPDATE email_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id', [row.id])).rows[0];
        if (!claimed) return false;
        await t.query('UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1', [row.user_id, passwordHash]);
        await t.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [row.user_id]);
        await t.query("UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'reset' AND used_at IS NULL", [row.user_id]);
        return true;
      });
      if (!done) throw INVALID_LINK();
      await audit('password_reset', { userId: row.user_id, ip: ctx.ip, userAgent: ctx.userAgent });
      background.run(() => mailer.sendSecurityNotice(row.email, 'Votre mot de passe a été modifié', 'Votre mot de passe vient d’être réinitialisé et toutes vos sessions ont été fermées.'));
    },

    /* ---------- Profil ---------- */
    async getUser(id) {
      const u = await one('SELECT * FROM users WHERE id = $1', [id]);
      if (!u) throw notFound('Compte introuvable.');
      return u;
    },

    async updateProfile(userId, { firstName, lastName, shippingAddress }) {
      const u = await one(
        `UPDATE users SET first_name = COALESCE($2, first_name), last_name = COALESCE($3, last_name),
                shipping_address = CASE WHEN $5::boolean THEN $4::jsonb ELSE shipping_address END, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [userId, firstName ?? null, lastName ?? null, shippingAddress ? JSON.stringify(shippingAddress) : null, shippingAddress !== undefined],
      );
      return publicUser(u);
    },

    async assertPassword(userId, password) {
      const u = await svc.getUser(userId);
      if (!(await verifyPassword(u.password_hash, password))) {
        throw new AppError(403, 'wrong_password', 'Mot de passe incorrect.');
      }
      return u;
    },

    async reauth(userId, sessionId, password, ctx) {
      await limiter.hitIp(ctx.ip, 'reauth');
      const u = await svc.getUser(userId);
      await limiter.assertAccountOpen(u.email);
      if (!(await verifyPassword(u.password_hash, password))) {
        const { locked } = await limiter.recordFailure(u.email);
        await audit('reauth_failed', { userId, ip: ctx.ip, userAgent: ctx.userAgent });
        if (locked) {
          metrics.lockouts.inc();
          await audit('account_locked', { userId, ip: ctx.ip, userAgent: ctx.userAgent });
        }
        throw new AppError(403, 'wrong_password', 'Mot de passe incorrect.');
      }
      await limiter.reset(u.email);
      const freshToken = await keyring.signPurpose('reauth', { sub: userId, sid: sessionId }, FRESH_TTL);
      return { freshToken, expiresIn: FRESH_TTL };
    },

    async changePassword(userId, sessionId, { currentPassword, newPassword }, ctx) {
      const u = await svc.assertPassword(userId, currentPassword);
      const passwordHash = await hashPassword(newPassword);
      await db.tx(async (t) => {
        await t.query('UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1', [userId, passwordHash]);
        await t.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL', [userId, sessionId]);
      });
      await audit('password_changed', { userId, ip: ctx.ip, userAgent: ctx.userAgent });
      background.run(() => mailer.sendSecurityNotice(u.email, 'Votre mot de passe a été modifié', 'Votre mot de passe a été changé et vos autres sessions ont été fermées.'));
    },

    async requestEmailChange(userId, { password, newEmail }, ctx) {
      const u = await svc.assertPassword(userId, password);
      await audit('email_change_requested', { userId, ip: ctx.ip, userAgent: ctx.userAgent });
      if (newEmail.toLowerCase() === u.email.toLowerCase()) return;
      const taken = await one('SELECT 1 AS t FROM users WHERE lower(email) = lower($1)', [newEmail]);
      if (taken) return; // réponse identique : on ne révèle pas qu'une adresse est déjà utilisée
      const token = await createEmailToken(db, userId, 'change_email', VERIFY_TTL, newEmail);
      background.run(async () => {
        await mailer.sendEmailChange(newEmail, token);
        await mailer.sendSecurityNotice(u.email, 'Changement d’adresse e-mail demandé', 'Un changement d’adresse e-mail vient d’être demandé sur votre compte. Il ne sera effectif qu’après confirmation de la nouvelle adresse.');
      });
    },

    /* ---------- Double authentification ---------- */
    async setupTwoFactor(userId) {
      const u = await svc.getUser(userId);
      if (u.totp_enabled) throw new AppError(409, 'already_enabled', 'La double authentification est déjà activée.');
      const secret = generateSecret();
      await db.query('UPDATE users SET totp_secret_enc = $2, updated_at = now() WHERE id = $1', [userId, secretBox.encrypt(secret)]);
      const otpauthUrl = generateURI({ issuer: 'Maison Argile', label: u.email, secret });
      return { secret, otpauthUrl, qrCode: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 }) };
    },

    async enableTwoFactor(userId, code, ctx) {
      const u = await svc.getUser(userId);
      if (u.totp_enabled) throw new AppError(409, 'already_enabled', 'La double authentification est déjà activée.');
      if (!u.totp_secret_enc) throw badRequest("Lancez d'abord la configuration.", 'setup_required');
      const res = await verifyTotpCode({ secret: secretBox.decrypt(u.totp_secret_enc), token: String(code).trim() });
      if (!res.valid) throw badRequest('Code incorrect.', 'invalid_code');
      const codes = Array.from({ length: 10 }, newBackupCode);
      const hashes = await Promise.all(codes.map((c) => hashPassword(c)));
      await db.tx(async (t) => {
        await t.query('UPDATE users SET totp_enabled = true, updated_at = now() WHERE id = $1', [userId]);
        await t.query('DELETE FROM backup_codes WHERE user_id = $1', [userId]);
        for (const h of hashes) await t.query('INSERT INTO backup_codes (user_id, code_hash) VALUES ($1, $2)', [userId, h]);
      });
      await audit('two_factor_enabled', { userId, ip: ctx.ip, userAgent: ctx.userAgent });
      return { backupCodes: codes };
    },

    async disableTwoFactor(userId, password, ctx) {
      await svc.assertPassword(userId, password);
      await db.tx(async (t) => {
        await t.query('UPDATE users SET totp_enabled = false, totp_secret_enc = NULL, updated_at = now() WHERE id = $1', [userId]);
        await t.query('DELETE FROM backup_codes WHERE user_id = $1', [userId]);
      });
      await audit('two_factor_disabled', { userId, ip: ctx.ip, userAgent: ctx.userAgent });
    },

    /* ---------- Sessions ---------- */
    async listSessions(userId, currentSessionId) {
      const rows = (
        await db.query(
          'SELECT id, user_agent, ip, created_at, last_seen_at FROM sessions WHERE user_id = $1 AND revoked_at IS NULL ORDER BY last_seen_at DESC',
          [userId],
        )
      ).rows;
      return rows.map((r) => ({
        id: r.id,
        device: describeDevice(r.user_agent),
        ip: r.ip,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        current: r.id === currentSessionId,
      }));
    },

    async revokeSession(userId, sessionId, ctx) {
      const r = await one('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id', [sessionId, userId]);
      if (!r) throw notFound('Session introuvable.');
      await audit('session_revoked', { userId, ip: ctx.ip, userAgent: ctx.userAgent, metadata: { sessionId } });
    },

    async revokeOtherSessions(userId, currentSessionId, ctx) {
      const rows = (await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL RETURNING id', [userId, currentSessionId])).rows;
      await audit('other_sessions_revoked', { userId, ip: ctx.ip, userAgent: ctx.userAgent, metadata: { revoked: rows.length } });
      return { revoked: rows.length };
    },

    /* ---------- RGPD ---------- */
    async exportData(userId, ctx) {
      const u = await svc.getUser(userId);
      const sessions = (await db.query('SELECT user_agent, ip, created_at, last_seen_at, revoked_at FROM sessions WHERE user_id = $1 ORDER BY created_at', [userId])).rows;
      const events = (await db.query('SELECT event, ip, user_agent, created_at FROM audit_log WHERE user_id = $1 ORDER BY created_at', [userId])).rows;
      const remaining = await one('SELECT count(*)::int AS n FROM backup_codes WHERE user_id = $1 AND used_at IS NULL', [userId]);
      await audit('data_exported', { userId, ip: ctx.ip, userAgent: ctx.userAgent });
      return {
        exportedAt: new Date().toISOString(),
        account: { ...publicUser(u), passwordChangedAt: u.password_changed_at, updatedAt: u.updated_at, backupCodesRemaining: remaining.n },
        sessions: sessions.map((s) => ({ device: describeDevice(s.user_agent), ip: s.ip, createdAt: s.created_at, lastSeenAt: s.last_seen_at, revokedAt: s.revoked_at })),
        securityEvents: events,
      };
    },

    async deleteAccount(userId, password) {
      await svc.assertPassword(userId, password);
      await db.tx(async (t) => {
        await t.query('UPDATE audit_log SET ip = NULL, user_agent = NULL WHERE user_id = $1', [userId]);
        await t.query('DELETE FROM users WHERE id = $1', [userId]);
      });
      await audit('account_deleted', { userId, ip: null, userAgent: null });
      background.run(() => internal?.purgeUser(userId));
    },
  };
  return svc;
}
