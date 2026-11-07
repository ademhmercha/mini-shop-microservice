import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3004),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.string().url(),
  // Vérification des jetons : clé publique uniquement, via le JWKS du service auth.
  AUTH_JWKS_URL: z.string().url(),
  JWT_ISSUER: z.string().min(1).default('shoplite-auth'),
  JWT_AUDIENCE: z.string().min(1).default('shoplite'),
  CART_URL: z.string().url(),
  CATALOG_URL: z.string().url(),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(3000),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  INTERNAL_API_TOKEN: z.string().min(16).optional(),
});

export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuration invalide :\n${problems}`);
  }
  return Object.freeze(parsed.data);
}
