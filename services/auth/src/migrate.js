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

/* c8 ignore start */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // MIGRATION_DATABASE_URL : propriétaire du schéma (DDL), distinct de l'utilisateur applicatif.
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    console.error('MIGRATION_DATABASE_URL est obligatoire');
    process.exit(1);
  }
  const db = createPgDb(url);
  try {
    const n = await runMigrations(db, defaultDir, (m) => console.log(m));
    console.log(`${n} migration(s) appliquée(s)`);
  } catch (e) {
    console.error('Échec de migration :', e.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
/* c8 ignore stop */
