import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Jeton opaque aléatoire (CSPRNG du système), 256 bits, encodé base64url. */
export const newOpaqueToken = () => randomBytes(32).toString('base64url');

/** Empreinte SHA-256 : suffisante pour un jeton à 256 bits d'entropie (pas besoin de sel ni de KDF lent). */
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Code de secours lisible : 10 caractères base32 (sans I/L/O/U) au format xxxxx-xxxxx. */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export function newBackupCode() {
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i += 1) out += ALPHABET[bytes[i] % 32];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}
