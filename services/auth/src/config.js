import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  APP_ORIGIN: z.string().url(),
  JWT_ISSUER: z.string().min(1).default('shoplite-auth'),
  JWT_AUDIENCE: z.string().min(1).default('shoplite'),
  // Clé privée Ed25519 (PEM PKCS8) : fichier monté OU variable d'environnement.
  JWT_PRIVATE_KEY_FILE: z.string().optional(),
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_KEY_ID: z.string().min(1).default('key-1'),
  // Clés publiques retirées (rotation) : dossier de fichiers <kid>.pem
  JWT_RETIRED_PUBLIC_KEYS_DIR: z.string().optional(),
  // Clé AES-256 (32 octets en base64) qui chiffre les secrets TOTP.
  TOTP_ENCRYPTION_KEY: z.string().min(1),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().default(1025),
  MAIL_FROM: z.string().min(3).default('Maison Argile <no-reply@maison-argile.local>'),
  COOKIE_SECURE: bool.default(true),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().default(604800),
  MAX_FAILED_LOGINS: z.coerce.number().int().default(5),
  LOCKOUT_SECONDS: z.coerce.number().int().default(900),
  IP_RATE_LIMIT_MAX: z.coerce.number().int().default(30),
  IP_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().default(60),
  // Appel interne vers orders pour l'anonymisation RGPD et l'export.
  ORDERS_INTERNAL_URL: z.string().url().optional(),
  CART_INTERNAL_URL: z.string().url().optional(),
  INTERNAL_API_TOKEN: z.string().min(16).optional(),
});

export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuration invalide :\n${problems}`);
  }
  const cfg = parsed.data;
  if (!cfg.JWT_PRIVATE_KEY_FILE && !cfg.JWT_PRIVATE_KEY) {
    throw new Error('Configuration invalide :\n  - JWT_PRIVATE_KEY_FILE ou JWT_PRIVATE_KEY est obligatoire');
  }
  if (Buffer.from(cfg.TOTP_ENCRYPTION_KEY, 'base64').length !== 32) {
    throw new Error('Configuration invalide :\n  - TOTP_ENCRYPTION_KEY doit contenir 32 octets encodés en base64');
  }
  return Object.freeze(cfg);
}
