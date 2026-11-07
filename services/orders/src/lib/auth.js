import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AppError, unauthorized } from './errors.js';

/** Vérifie les jetons avec la clé publique du service auth (JWKS). Ce service ne connaît jamais la clé privée. */
export function createJwtVerifier(cfg) {
  const jwks = createRemoteJWKSet(new URL(cfg.AUTH_JWKS_URL), {
    timeoutDuration: 3000,
    cooldownDuration: 10000,
    cacheMaxAge: 600000,
  });
  return async (token) =>
    (await jwtVerify(token, jwks, { issuer: cfg.JWT_ISSUER, audience: cfg.JWT_AUDIENCE, algorithms: ['EdDSA'] })).payload;
}

/** Exige un jeton Bearer valide ; `verified` exige en plus une adresse e-mail confirmée. */
export function authenticate(verifyToken, { verified = false } = {}) {
  return async (req, _res, next) => {
    try {
      const [scheme, token] = (req.get('authorization') ?? '').split(' ');
      if (scheme !== 'Bearer' || !token) throw unauthorized();
      let claims;
      try {
        claims = await verifyToken(token);
      } catch {
        throw unauthorized('Jeton invalide ou expiré.', 'invalid_token');
      }
      req.user = { id: claims.sub, emailVerified: claims.email_verified === true };
      req.bearer = token;
      if (verified && !req.user.emailVerified) {
        throw new AppError(403, 'email_not_verified', 'Confirmez votre adresse e-mail pour passer commande.');
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
