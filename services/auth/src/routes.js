import express from 'express';
import { z } from 'zod';
import { validate } from './lib/validate.js';
import { AppError, forbidden, unauthorized } from './lib/errors.js';
import { passwordPolicyError } from './lib/passwords.js';

const email = z.string().trim().toLowerCase().pipe(z.email('Adresse e-mail invalide.').max(254, 'Adresse e-mail trop longue.'));
const loginPassword = z.string().min(1, 'Mot de passe requis.').max(128);
const name = z.string().trim().max(80, 'Maximum 80 caractères.');
const token = z.string().min(20).max(200);
const code = z.string().trim().min(6).max(12);

const withPolicy = (field = 'password', emailField = 'email') => (value, ctx) => {
  const msg = passwordPolicyError(value[field], value[emailField] ?? '');
  if (msg) ctx.addIssue({ code: 'custom', path: [field], message: msg });
};

const registerBody = z.object({ email, password: z.string().max(128) }).strict().superRefine(withPolicy());
const loginBody = z.object({ email, password: loginPassword }).strict();
const login2faBody = z.object({ challengeToken: z.string().min(20).max(2000), code }).strict();
const tokenBody = z.object({ token }).strict();
const forgotBody = z.object({ email }).strict();
const resetBody = z.object({ token, newPassword: z.string().max(128) }).strict();
const reauthBody = z.object({ password: loginPassword }).strict();
const profileBody = z
  .object({
    firstName: name.optional(),
    lastName: name.optional(),
    shippingAddress: z
      .object({
        line1: z.string().trim().min(1, 'Adresse requise.').max(120),
        line2: z.string().trim().max(120).optional().default(''),
        postalCode: z.string().trim().min(2, 'Code postal requis.').max(12),
        city: z.string().trim().min(1, 'Ville requise.').max(80),
        country: z.string().trim().min(2).max(60).default('France'),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
const changePasswordBody = z.object({ currentPassword: loginPassword, newPassword: z.string().max(128) }).strict();
const changeEmailBody = z.object({ password: loginPassword, newEmail: email }).strict();
const enableBody = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Code à 6 chiffres.') }).strict();
const passwordOnlyBody = z.object({ password: loginPassword }).strict();

export function createRoutes({ cfg, svc, keyring, ctxOf }) {
  const r = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  const setRefreshCookie = (res, value) =>
    res.cookie('refresh_token', value, {
      httpOnly: true,
      secure: cfg.COOKIE_SECURE,
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: cfg.REFRESH_TOKEN_TTL_SECONDS * 1000,
    });
  const clearRefreshCookie = (res) =>
    res.clearCookie('refresh_token', { httpOnly: true, secure: cfg.COOKIE_SECURE, sameSite: 'strict', path: '/api/auth' });

  /** Protection CSRF : en-tête personnalisé obligatoire + Origin identique à celle du site. */
  const csrfGuard = (req, _res, next) => {
    if (req.get('x-requested-with') !== 'shoplite') return next(forbidden('En-tête de sécurité manquant.', 'csrf_header'));
    if (req.get('origin') !== cfg.APP_ORIGIN) return next(forbidden('Origine non autorisée.', 'csrf_origin'));
    return next();
  };

  const requireAuth = wrap(async (req, _res, next) => {
    const header = req.get('authorization') ?? '';
    const [scheme, bearer] = header.split(' ');
    if (scheme !== 'Bearer' || !bearer) throw unauthorized();
    let claims;
    try {
      claims = await keyring.verifyAccess(bearer);
    } catch {
      throw unauthorized('Jeton invalide ou expiré.', 'invalid_token');
    }
    if (!(await svc.isSessionActive(claims.sid, claims.sub))) throw unauthorized('Session terminée.', 'session_revoked');
    req.auth = { userId: claims.sub, sessionId: claims.sid, email: claims.email };
    next();
  });

  /** Confirmation récente du mot de passe (jeton "fresh" de 5 minutes obtenu via POST /reauth). */
  const requireFresh = wrap(async (req, _res, next) => {
    const raw = req.get('x-fresh-token');
    if (!raw) throw new AppError(403, 'reauth_required', 'Confirmez votre mot de passe pour continuer.');
    try {
      const claims = await keyring.verifyPurpose('reauth', raw);
      if (claims.sub !== req.auth.userId || claims.sid !== req.auth.sessionId) throw new Error('mismatch');
    } catch {
      throw new AppError(403, 'reauth_required', 'Confirmez votre mot de passe pour continuer.');
    }
    next();
  });

  const checkPolicy = (password, mail) => {
    const msg = passwordPolicyError(password, mail);
    if (msg) throw new AppError(400, 'validation_error', 'Certains champs sont invalides.', { fields: { newPassword: msg } });
  };

  /* ---------- Public ---------- */
  r.post('/register', validate(registerBody), (req, res) => {
    svc.register(req.body, ctxOf(req));
    res.status(202).json({ message: 'Si cette adresse est valide, un e-mail de confirmation vient de vous être envoyé.' });
  });

  r.post('/verify-email', validate(tokenBody), wrap(async (req, res) => {
    const out = await svc.confirmEmailToken(req.body.token, ctxOf(req));
    res.json({ verified: true, purpose: out.purpose });
  }));

  r.post('/login', csrfGuard, validate(loginBody), wrap(async (req, res) => {
    const result = await svc.login(req.body, ctxOf(req));
    if (result.twoFactorRequired) return res.json(result);
    setRefreshCookie(res, result.refreshToken);
    const { refreshToken: _omit, ...body } = result;
    return res.json(body);
  }));

  r.post('/login/2fa', csrfGuard, validate(login2faBody), wrap(async (req, res) => {
    const result = await svc.loginSecondFactor(req.body, ctxOf(req));
    setRefreshCookie(res, result.refreshToken);
    const { refreshToken: _omit, ...body } = result;
    res.json(body);
  }));

  r.post('/refresh', csrfGuard, wrap(async (req, res) => {
    try {
      const result = await svc.refresh(req.cookies?.refresh_token, ctxOf(req));
      setRefreshCookie(res, result.refreshToken);
      const { refreshToken: _omit, ...body } = result;
      res.json(body);
    } catch (err) {
      clearRefreshCookie(res);
      throw err;
    }
  }));

  r.post('/logout', csrfGuard, wrap(async (req, res) => {
    await svc.logout(req.cookies?.refresh_token, ctxOf(req));
    clearRefreshCookie(res);
    res.status(204).end();
  }));

  r.post('/forgot-password', validate(forgotBody), (req, res) => {
    svc.forgotPassword(req.body, ctxOf(req));
    res.status(202).json({ message: 'Si un compte correspond à cette adresse, un e-mail de réinitialisation vient d’être envoyé.' });
  });

  r.post('/reset-password', validate(resetBody), wrap(async (req, res) => {
    await svc.resetPassword(req.body, ctxOf(req), checkPolicy);
    res.json({ reset: true });
  }));

  /* ---------- Authentifié ---------- */
  r.post('/reauth', requireAuth, validate(reauthBody), wrap(async (req, res) => {
    res.json(await svc.reauth(req.auth.userId, req.auth.sessionId, req.body.password, ctxOf(req)));
  }));

  r.post('/resend-verification', requireAuth, wrap(async (req, res) => {
    res.status(202).json(await svc.resendVerification(req.auth.userId));
  }));

  r.get('/me', requireAuth, wrap(async (req, res) => {
    res.json({ user: svc.publicUser(await svc.getUser(req.auth.userId)) });
  }));

  r.patch('/me', requireAuth, validate(profileBody), wrap(async (req, res) => {
    res.json({ user: await svc.updateProfile(req.auth.userId, req.body) });
  }));

  r.post('/me/password', requireAuth, validate(changePasswordBody), wrap(async (req, res) => {
    const user = await svc.getUser(req.auth.userId);
    checkPolicy(req.body.newPassword, user.email);
    await svc.changePassword(req.auth.userId, req.auth.sessionId, req.body, ctxOf(req));
    res.json({ changed: true });
  }));

  r.post('/me/email', requireAuth, validate(changeEmailBody), wrap(async (req, res) => {
    await svc.requestEmailChange(req.auth.userId, req.body, ctxOf(req));
    res.status(202).json({ message: 'Si cette adresse est disponible, un e-mail de confirmation vient d’y être envoyé.' });
  }));

  r.post('/me/2fa/setup', requireAuth, requireFresh, wrap(async (req, res) => {
    res.json(await svc.setupTwoFactor(req.auth.userId));
  }));
  r.post('/me/2fa/enable', requireAuth, requireFresh, validate(enableBody), wrap(async (req, res) => {
    res.json(await svc.enableTwoFactor(req.auth.userId, req.body.code, ctxOf(req)));
  }));
  r.post('/me/2fa/disable', requireAuth, requireFresh, validate(passwordOnlyBody), wrap(async (req, res) => {
    await svc.disableTwoFactor(req.auth.userId, req.body.password, ctxOf(req));
    res.json({ disabled: true });
  }));

  r.get('/me/sessions', requireAuth, wrap(async (req, res) => {
    res.json({ sessions: await svc.listSessions(req.auth.userId, req.auth.sessionId) });
  }));
  r.delete('/me/sessions', requireAuth, requireFresh, wrap(async (req, res) => {
    res.json(await svc.revokeOtherSessions(req.auth.userId, req.auth.sessionId, ctxOf(req)));
  }));
  r.delete('/me/sessions/:id', requireAuth, requireFresh, validate(z.object({ id: z.uuid() }), 'params'), wrap(async (req, res) => {
    await svc.revokeSession(req.auth.userId, req.params.id, ctxOf(req));
    res.status(204).end();
  }));

  r.get('/me/export', requireAuth, requireFresh, wrap(async (req, res) => {
    res.set('Content-Disposition', 'attachment; filename="mes-donnees-maison-argile.json"');
    res.json(await svc.exportData(req.auth.userId, ctxOf(req)));
  }));

  r.delete('/me', requireAuth, validate(passwordOnlyBody), wrap(async (req, res) => {
    await svc.deleteAccount(req.auth.userId, req.body.password);
    clearRefreshCookie(res);
    res.status(204).end();
  }));

  return r;
}
