#!/usr/bin/env node
/**
 * Génère les secrets de développement local, dans des fichiers ignorés par Git :
 *   .secrets/jwt-private.pem   clé privée Ed25519 qui signe les jetons (montée dans le service auth uniquement)
 *   .secrets/jwt-public.pem    clé publique correspondante (informative : le JWKS est publié par auth)
 *   .secrets/retired/<kid>.pem anciennes clés publiques conservées après une rotation
 *   .env                       mots de passe de bases, Redis, clé de chiffrement TOTP, jeton interne
 *
 * Usage :
 *   node scripts/gen-keys.mjs            première génération (ne remplace rien d'existant)
 *   node scripts/gen-keys.mjs --rotate   nouvelle clé de signature ; l'ancienne reste acceptée en vérification
 *   node scripts/gen-keys.mjs --force    régénère tout (invalide sessions et secrets TOTP existants)
 *
 * Toute l'aléa vient du générateur cryptographique du système (node:crypto).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, randomBytes, createPublicKey } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secretsDir = path.join(root, '.secrets');
const retiredDir = path.join(secretsDir, 'retired');
const envFile = path.join(root, '.env');
const privFile = path.join(secretsDir, 'jwt-private.pem');
const pubFile = path.join(secretsDir, 'jwt-public.pem');
const args = new Set(process.argv.slice(2));

const hex = (n) => randomBytes(n).toString('hex');
const readEnv = () =>
  Object.fromEntries(
    (fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );

function writeEnv(values) {
  const lines = [
    '# Généré par scripts/gen-keys.mjs - secrets de DÉVELOPPEMENT, ne jamais commiter.',
    ...Object.entries(values).map(([k, v]) => `${k}=${v}`),
    '',
  ];
  fs.writeFileSync(envFile, lines.join('\n'), { mode: 0o600 });
}

fs.mkdirSync(retiredDir, { recursive: true });
const env = readEnv();
const exists = fs.existsSync(privFile);

if (exists && !args.has('--rotate') && !args.has('--force')) {
  console.log('Les clés existent déjà. Utilisez --rotate pour une rotation ou --force pour tout régénérer.');
  process.exit(0);
}

let kid = 'key-1';
if (exists && args.has('--rotate') && !args.has('--force')) {
  // Rotation : l'ancienne clé publique reste publiée dans le JWKS (jetons encore valides au plus 15 minutes).
  const previous = env.JWT_KEY_ID || 'key-1';
  fs.mkdirSync(retiredDir, { recursive: true });
  const oldPublic = createPublicKey(fs.readFileSync(privFile)).export({ type: 'spki', format: 'pem' });
  fs.writeFileSync(path.join(retiredDir, `${previous}.pem`), oldPublic);
  kid = `key-${Number(previous.replace(/\D/g, '') || 1) + 1}`;
  console.log(`Rotation : ${previous} retirée (publique conservée), nouvelle clé ${kid}.`);
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
// 0644 : lisible par l'utilisateur non-root du conteneur via le montage local. En production, utiliser un Secret Kubernetes.
fs.writeFileSync(privFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o644 });
fs.writeFileSync(pubFile, publicKey.export({ type: 'spki', format: 'pem' }));

const keepSecrets = exists && !args.has('--force');
const values = {
  JWT_KEY_ID: kid,
  POSTGRES_PASSWORD: keepSecrets && env.POSTGRES_PASSWORD ? env.POSTGRES_PASSWORD : hex(24),
  AUTH_DB_OWNER_PASSWORD: keepSecrets && env.AUTH_DB_OWNER_PASSWORD ? env.AUTH_DB_OWNER_PASSWORD : hex(24),
  AUTH_DB_APP_PASSWORD: keepSecrets && env.AUTH_DB_APP_PASSWORD ? env.AUTH_DB_APP_PASSWORD : hex(24),
  CATALOG_DB_OWNER_PASSWORD: keepSecrets && env.CATALOG_DB_OWNER_PASSWORD ? env.CATALOG_DB_OWNER_PASSWORD : hex(24),
  CATALOG_DB_APP_PASSWORD: keepSecrets && env.CATALOG_DB_APP_PASSWORD ? env.CATALOG_DB_APP_PASSWORD : hex(24),
  ORDERS_DB_OWNER_PASSWORD: keepSecrets && env.ORDERS_DB_OWNER_PASSWORD ? env.ORDERS_DB_OWNER_PASSWORD : hex(24),
  ORDERS_DB_APP_PASSWORD: keepSecrets && env.ORDERS_DB_APP_PASSWORD ? env.ORDERS_DB_APP_PASSWORD : hex(24),
  REDIS_PASSWORD: keepSecrets && env.REDIS_PASSWORD ? env.REDIS_PASSWORD : hex(24),
  TOTP_ENCRYPTION_KEY: keepSecrets && env.TOTP_ENCRYPTION_KEY ? env.TOTP_ENCRYPTION_KEY : randomBytes(32).toString('base64'),
  INTERNAL_API_TOKEN: keepSecrets && env.INTERNAL_API_TOKEN ? env.INTERNAL_API_TOKEN : hex(24),
};
writeEnv(values);

console.log('Secrets générés :');
console.log(`  - ${path.relative(root, privFile)}  (clé privée de signature, kid=${kid})`);
console.log(`  - ${path.relative(root, pubFile)}`);
console.log(`  - ${path.relative(root, envFile)}  (mots de passe et clés de chiffrement)`);
console.log('Ces fichiers sont ignorés par Git. Lancez ensuite : docker compose up --build');
