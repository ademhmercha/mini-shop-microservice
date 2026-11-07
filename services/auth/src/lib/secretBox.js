import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Chiffrement AES-256-GCM (primitive standard de node:crypto) pour les secrets TOTP au repos. */
export function createSecretBox(base64Key) {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('clé de chiffrement invalide');
  return {
    encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
    },
    decrypt(payload) {
      const [version, iv, tag, data] = String(payload).split('.');
      if (version !== 'v1' || !iv || !tag || !data) throw new Error('format chiffré invalide');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    },
  };
}
