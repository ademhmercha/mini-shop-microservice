import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { loadConfig } from '../src/config.js';
import { passwordPolicyError, hashPassword, verifyPassword } from '../src/lib/passwords.js';
import { createSecretBox } from '../src/lib/secretBox.js';
import { createKeyring } from '../src/lib/jwt.js';
import { describeDevice } from '../src/lib/userAgent.js';
import { createPgliteDb } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createMailer } from '../src/lib/mailer.js';
import { createInternalClient } from '../src/services/internal.js';
import { newBackupCode, newOpaqueToken, sha256, safeEqual } from '../src/lib/tokens.js';
import { createBackground } from '../src/lib/background.js';
import { createLogger } from '../src/logger.js';
import { testEnv } from './helpers.js';

describe('configuration', () => {
  it('refuse de démarrer quand une variable obligatoire manque', () => {
    const env = testEnv();
    delete env.DATABASE_URL;
    expect(() => loadConfig(env)).toThrow(/DATABASE_URL/);
  });
  it('exige une clé privée et une clé de chiffrement de 32 octets', () => {
    const env = testEnv();
    delete env.JWT_PRIVATE_KEY;
    expect(() => loadConfig(env)).toThrow(/JWT_PRIVATE_KEY/);
    expect(() => loadConfig(testEnv({ TOTP_ENCRYPTION_KEY: 'court' }))).toThrow(/32 octets/);
  });
  it('accepte une configuration valide avec des valeurs par défaut sûres', () => {
    const cfg = loadConfig(testEnv({ COOKIE_SECURE: undefined }));
    expect(cfg.COOKIE_SECURE).toBe(true);
    expect(cfg.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(cfg.REFRESH_TOKEN_TTL_SECONDS).toBe(604800);
  });
});

describe('mots de passe', () => {
  it('applique la politique', () => {
    expect(passwordPolicyError('court')).toMatch(/12 caractères/);
    expect(passwordPolicyError('a'.repeat(129))).toMatch(/128/);
    expect(passwordPolicyError('abcabcabcabc')).toMatch(/répétitif/);
    expect(passwordPolicyError('Correct-Horse-Battery-9', 'jean.dupont@example.test')).toBeNull();
    expect(passwordPolicyError('xjean.dupontx-Zz9', 'jean.dupont@example.test')).toMatch(/e-mail/);
    expect(passwordPolicyError('jean.dupont@example.test!', 'jean.dupont@example.test')).toMatch(/e-mail/);
  });
  it('refuse un mot de passe de la liste des plus courants (même avec un suffixe)', () => {
    const list = fs.readFileSync(new URL('../src/data/common-passwords.txt', import.meta.url), 'utf8').split(/\r?\n/);
    const longOne = list.find((p) => p.length >= 12);
    expect(longOne).toBeTruthy();
    expect(passwordPolicyError(longOne)).toMatch(/courant/);
    expect(passwordPolicyError(`${longOne}123`)).toMatch(/courant/);
  });
  it('hache en Argon2id avec les paramètres OWASP et vérifie', async () => {
    const h = await hashPassword('Correct-Horse-Battery-9');
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(h, 'Correct-Horse-Battery-9')).toBe(true);
    expect(await verifyPassword(h, 'autre')).toBe(false);
    expect(await verifyPassword('pas-un-hash', 'x')).toBe(false);
  });
});

describe('chiffrement des secrets TOTP', () => {
  const box = createSecretBox(Buffer.alloc(32, 3).toString('base64'));
  it('chiffre puis déchiffre, avec un IV différent à chaque fois', () => {
    const a = box.encrypt('JBSWY3DPEHPK3PXP');
    const b = box.encrypt('JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(b);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.decrypt(a)).toBe('JBSWY3DPEHPK3PXP');
  });
  it('détecte toute altération (GCM) et les formats invalides', () => {
    const enc = box.encrypt('secret');
    const parts = enc.split('.');
    parts[3] = Buffer.from('xxxxxx').toString('base64url');
    expect(() => box.decrypt(parts.join('.'))).toThrow();
    expect(() => box.decrypt('n-importe-quoi')).toThrow(/format/);
    expect(() => createSecretBox('court')).toThrow();
  });
});

describe('trousseau de clés et rotation', () => {
  it('un jeton signé par une ancienne clé reste valide tant que sa clé publique est publiée', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-'));
    const oldKeys = generateKeyPairSync('ed25519');
    const newKeys = generateKeyPairSync('ed25519');
    fs.writeFileSync(path.join(dir, 'key-1.pem'), oldKeys.publicKey.export({ type: 'spki', format: 'pem' }));
    const base = loadConfig(testEnv());
    const oldRing = createKeyring({ ...base, JWT_PRIVATE_KEY: oldKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }), JWT_KEY_ID: 'key-1' });
    const newRing = createKeyring({
      ...base,
      JWT_PRIVATE_KEY: newKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      JWT_KEY_ID: 'key-2',
      JWT_RETIRED_PUBLIC_KEYS_DIR: dir,
    });
    expect(newRing.jwks.keys.map((k) => k.kid).sort()).toEqual(['key-1', 'key-2']);
    expect(newRing.jwks.keys.every((k) => k.d === undefined)).toBe(true);
    const token = await oldRing.signAccess({ sub: 'u1' });
    expect((await newRing.verifyAccess(token)).sub).toBe('u1');
    await expect(oldRing.verifyAccess(await newRing.signAccess({ sub: 'u1' }))).rejects.toThrow();
    fs.rmSync(dir, { recursive: true });
  });
  it('lit la clé privée depuis un fichier monté et refuse une clé qui n’est pas Ed25519', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-'));
    const { privateKey } = generateKeyPairSync('ed25519');
    const file = path.join(dir, 'jwt.pem');
    fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const base = loadConfig(testEnv());
    const ring = createKeyring({ ...base, JWT_PRIVATE_KEY: undefined, JWT_PRIVATE_KEY_FILE: file });
    expect(ring.jwks.keys[0].x).toBe(createPublicKey(privateKey).export({ format: 'jwk' }).x);
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() => createKeyring({ ...base, JWT_PRIVATE_KEY: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }) })).toThrow(/Ed25519/);
    fs.rmSync(dir, { recursive: true });
  });
});

describe('utilitaires', () => {
  it('décrit l’appareil à partir du User-Agent', () => {
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537')).toBe('Chrome sur Windows');
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 14) Firefox/121.0')).toBe('Firefox sur macOS');
    expect(describeDevice('Mozilla/5.0 (Linux; Android 14) Chrome/120 Edg/120')).toBe('Edge sur Android');
    expect(describeDevice('curl/8')).toBe('Appareil inconnu');
    expect(describeDevice('')).toBe('Appareil inconnu');
  });
  it('génère des jetons et codes de secours uniques et bien formés', () => {
    expect(newOpaqueToken()).not.toBe(newOpaqueToken());
    expect(newOpaqueToken().length).toBeGreaterThanOrEqual(43);
    expect(newBackupCode()).toMatch(/^[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}$/);
    expect(sha256('a')).toHaveLength(64);
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
  it('les tâches de fond n’interrompent jamais le processus', async () => {
    const bg = createBackground(createLogger('silent'));
    let done = false;
    bg.run(async () => { throw new Error('boom'); });
    bg.run(async () => { await new Promise((r) => setTimeout(r, 10)); done = true; });
    await bg.drain();
    expect(done).toBe(true);
  });
});

describe('migrations', () => {
  it('sont versionnées et idempotentes', async () => {
    const db = createPgliteDb(new PGlite());
    const dir = fileURLToPath(new URL('../migrations', import.meta.url));
    const first = await runMigrations(db, dir);
    const second = await runMigrations(db, dir);
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    const tables = (await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).rows.map((r) => r.table_name);
    for (const t of ['users', 'sessions', 'refresh_tokens', 'email_tokens', 'backup_codes', 'audit_log', 'schema_migrations']) expect(tables).toContain(t);
    await db.close();
  });
});

describe('e-mails', () => {
  it('construit des liens vers le site et échappe le contenu HTML', async () => {
    const sent = [];
    const cfg = loadConfig(testEnv());
    const mailer = createMailer(cfg, { sendMail: async (m) => sent.push(m), verify: async () => true });
    await mailer.sendVerification('a@example.test', 'tok en&1');
    await mailer.sendAlreadyRegistered('a@example.test');
    await mailer.sendPasswordReset('a@example.test', 'tok2');
    await mailer.sendEmailChange('a@example.test', 'tok3');
    await mailer.sendSecurityNotice('a@example.test', 'Sujet <b>', 'Corps');
    await mailer.verify();
    expect(sent[0].text).toContain('http://localhost:8080/verifier-email?token=tok%20en%261');
    expect(sent[0].html).not.toContain('tok en&1');
    expect(sent[2].text).toContain('/reinitialiser-mot-de-passe?token=tok2');
    expect(sent[4].html).not.toContain('<b>');
    expect(sent).toHaveLength(5);
  });
});

describe('client interne (effacement RGPD)', () => {
  it('appelle orders et cart avec le jeton interne, sans jamais échouer', async () => {
    const calls = [];
    const cfg = loadConfig(testEnv({
      ORDERS_INTERNAL_URL: 'http://orders:3004', CART_INTERNAL_URL: 'http://cart:3003', INTERNAL_API_TOKEN: 'x'.repeat(24),
    }));
    const fetchImpl = async (url, init) => {
      calls.push({ url, token: init.headers['x-internal-token'], method: init.method });
      if (url.includes('cart')) throw new Error('injoignable');
      return { ok: false, status: 500 };
    };
    await createInternalClient(cfg, createLogger('silent'), fetchImpl).purgeUser('u-1');
    expect(calls.map((c) => c.url).sort()).toEqual(['http://cart:3003/internal/users/u-1', 'http://orders:3004/internal/users/u-1']);
    expect(calls.every((c) => c.method === 'DELETE' && c.token === 'x'.repeat(24))).toBe(true);
    const none = await createInternalClient(loadConfig(testEnv()), createLogger('silent'), fetchImpl).purgeUser('u-2');
    expect(none).toBeUndefined();
  });
});
