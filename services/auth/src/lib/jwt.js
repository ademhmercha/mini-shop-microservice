import fs from 'node:fs';
import path from 'node:path';
import { createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify, createLocalJWKSet } from 'jose';

const ALG = 'EdDSA';

function publicJwk(keyObject, kid) {
  const pub = keyObject.type === 'private' ? createPublicKey(keyObject) : keyObject;
  const jwk = pub.export({ format: 'jwk' });
  return { ...jwk, kid, alg: ALG, use: 'sig' };
}

/**
 * Charge la clé privée active (fichier monté ou variable d'environnement) et les clés publiques
 * retirées (rotation : un fichier <kid>.pem par ancienne clé). Seules les clés publiques sont exposées.
 */
export function createKeyring(cfg) {
  const pem = cfg.JWT_PRIVATE_KEY_FILE
    ? fs.readFileSync(cfg.JWT_PRIVATE_KEY_FILE, 'utf8')
    : cfg.JWT_PRIVATE_KEY.replace(/\\n/g, '\n');
  const privateKey = createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('la clé privée JWT doit être de type Ed25519');

  const keys = [publicJwk(privateKey, cfg.JWT_KEY_ID)];
  if (cfg.JWT_RETIRED_PUBLIC_KEYS_DIR && fs.existsSync(cfg.JWT_RETIRED_PUBLIC_KEYS_DIR)) {
    for (const f of fs.readdirSync(cfg.JWT_RETIRED_PUBLIC_KEYS_DIR).filter((n) => n.endsWith('.pem'))) {
      const kid = path.basename(f, '.pem');
      if (kid === cfg.JWT_KEY_ID) continue;
      keys.push(publicJwk(createPublicKey(fs.readFileSync(path.join(cfg.JWT_RETIRED_PUBLIC_KEYS_DIR, f))), kid));
    }
  }
  const jwks = { keys };
  const localSet = createLocalJWKSet(jwks);
  const base = { issuer: cfg.JWT_ISSUER };

  async function sign(claims, { audience, ttlSeconds }) {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: ALG, kid: cfg.JWT_KEY_ID, typ: 'JWT' })
      .setIssuer(base.issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(privateKey);
  }

  async function verify(token, audience) {
    const { payload } = await jwtVerify(token, localSet, {
      issuer: base.issuer,
      audience,
      algorithms: [ALG],
    });
    return payload;
  }

  return {
    jwks,
    signAccess: (claims) => sign(claims, { audience: cfg.JWT_AUDIENCE, ttlSeconds: cfg.ACCESS_TOKEN_TTL_SECONDS }),
    verifyAccess: (token) => verify(token, cfg.JWT_AUDIENCE),
    // Jetons internes à auth, avec leur propre audience pour qu'ils ne soient jamais acceptés ailleurs.
    signPurpose: (purpose, claims, ttlSeconds) => sign(claims, { audience: `${cfg.JWT_AUDIENCE}:${purpose}`, ttlSeconds }),
    verifyPurpose: (purpose, token) => verify(token, `${cfg.JWT_AUDIENCE}:${purpose}`),
  };
}
