import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPgDb } from './db.js';

const defaultDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Applique, dans l'ordre, les fichiers .sql pas encore appliqués. Un fichier = une transaction. */
export async function runMigrations(db, migrationsDir = defaultDir, log = () => {}) {
  await db.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const done = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await db.tx(async (t) => {
      await t.query(sql);
      await t.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
    });
    log(`migration appliquée : ${file}`);
    applied += 1;
  }
  return applied;
}

// Erreurs « la base n'est pas (encore) joignable » : réessayer a un sens. Les erreurs d'authentification,
// de syntaxe SQL ou de droits sont définitives et échouent tout de suite.
const TRANSIENT_CODES = new Set([
  '57P03', // the database system is starting up
  '57P01', // terminating connection due to administrator command (redémarrage)
  '57P02', // crash shutdown
  '57P04', // database dropped
  '53300', // too many connections
  '08000', '08001', '08003', '08004', '08006', // erreurs de connexion
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'EHOSTUNREACH', 'EPIPE',
]);

export function isTransientDbError(err) {
  if (!err) return false;
  if (TRANSIENT_CODES.has(err.code)) return true;
  if (Array.isArray(err.errors) && err.errors.some(isTransientDbError)) return true; // AggregateError (IPv4 + IPv6)
  return /starting up|Connection terminated|connection timeout|timeout exceeded when trying to connect/i.test(err.message ?? '');
}

/**
 * Exécute `fn` en réessayant tant que la base est indisponible : délai croissant d'1 s, 2 s, 3 s… jusqu'à `maxDelayMs`,
 * `attempts` tentatives au total, chaque tentative journalisée. Convient aux Jobs de migration Kubernetes
 * (la base peut démarrer après le Job).
 */
export async function withDbRetry(
  fn,
  { attempts = 10, maxDelayMs = 10_000, log = () => {}, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {},
) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (!isTransientDbError(err) || attempt >= attempts) throw err;
      const delay = Math.min(attempt * 1000, maxDelayMs);
      const reason = err.message || err.code || (err.errors && err.errors[0]?.code) || 'erreur de connexion';
      log(`base de données indisponible (${reason}) – tentative ${attempt}/${attempts}, nouvel essai dans ${delay / 1000} s`);
      await sleep(delay);
    }
  }
}

const positive = (value, fallback) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback);

/** Point d'entrée de la commande `node src/migrate.js` (retiré de la couverture : testé via withDbRetry/runMigrations). */
export async function main(env = process.env, { createDb = createPgDb, dir = defaultDir, log = (m) => console.log(m), sleep } = {}) {
  // MIGRATION_DATABASE_URL : propriétaire du schéma (DDL), distinct de l'utilisateur applicatif.
  const url = env.MIGRATION_DATABASE_URL;
  if (!url) {
    console.error('MIGRATION_DATABASE_URL est obligatoire');
    return 1;
  }
  const db = createDb(url, { onError: () => {} });
  try {
    // Toute la migration est réessayée : chaque fichier est transactionnel et déjà enregistré s'il est appliqué,
    // donc un redémarrage de la base au milieu du processus est sans danger.
    const applied = await withDbRetry(
      async () => {
        await db.ping();
        return runMigrations(db, dir, log);
      },
      {
        attempts: positive(env.MIGRATION_RETRY_ATTEMPTS, 10),
        maxDelayMs: positive(env.MIGRATION_RETRY_MAX_DELAY_MS, 10_000),
        log,
        sleep,
      },
    );
    log(`${applied} migration(s) appliquée(s)`);
    return 0;
  } catch (err) {
    console.error('Échec de migration :', err.message || err.code);
    return 1;
  } finally {
    await db.close().catch(() => {});
  }
}

/* c8 ignore start */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
/* c8 ignore stop */
