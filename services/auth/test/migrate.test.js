import { describe, it, expect, vi, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createPgliteDb } from '../src/db.js';
import { isTransientDbError, withDbRetry, main } from '../src/migrate.js';

const transient = (code = '57P03', message = 'the database system is starting up') => Object.assign(new Error(message), { code });

afterEach(() => vi.restoreAllMocks());

describe('classification des erreurs de connexion', () => {
  it('reconnaît une base qui démarre, redémarre ou refuse la connexion', () => {
    expect(isTransientDbError(transient())).toBe(true);
    expect(isTransientDbError(transient('57P01', 'terminating connection due to administrator command'))).toBe(true);
    expect(isTransientDbError(transient('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.2:5432'))).toBe(true);
    expect(isTransientDbError(transient('EAI_AGAIN', 'getaddrinfo EAI_AGAIN postgres'))).toBe(true);
    expect(isTransientDbError(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isTransientDbError(new Error('timeout exceeded when trying to connect'))).toBe(true);
    expect(isTransientDbError(new Error('the database system is starting up'))).toBe(true);
    const aggregate = Object.assign(new Error(''), { errors: [transient('ECONNREFUSED', 'x'), transient('ECONNREFUSED', 'y')] });
    expect(isTransientDbError(aggregate)).toBe(true); // Node renvoie un AggregateError (IPv4 + IPv6)
  });

  it('ne réessaie pas les erreurs définitives (mot de passe, SQL, droits)', () => {
    expect(isTransientDbError(transient('28P01', 'password authentication failed for user "auth_owner"'))).toBe(false);
    expect(isTransientDbError(transient('42601', 'syntax error at or near "SELEC"'))).toBe(false);
    expect(isTransientDbError(transient('42501', 'permission denied for schema public'))).toBe(false);
    expect(isTransientDbError(new Error('boom'))).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
  });
});

describe('withDbRetry', () => {
  it('réessaie avec un délai croissant (1 s, 2 s, 3 s…) et journalise chaque tentative', async () => {
    const sleep = vi.fn(async () => {});
    const log = vi.fn();
    let calls = 0;
    const result = await withDbRetry(async (attempt) => {
      calls += 1;
      if (attempt <= 3) throw transient();
      return 'ok';
    }, { sleep, log });
    expect(result).toBe('ok');
    expect(calls).toBe(4);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 3000]);
    expect(log).toHaveBeenCalledTimes(3);
    expect(log.mock.calls[0][0]).toMatch(/starting up.*tentative 1\/10.*1 s/);
    expect(log.mock.calls[2][0]).toMatch(/tentative 3\/10.*3 s/);
  });

  it('plafonne le délai et abandonne après le nombre de tentatives prévu (10 par défaut, 1 à 9 s)', async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => { throw transient('ECONNREFUSED', 'connect ECONNREFUSED'); });
    await expect(withDbRetry(fn, { sleep })).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    expect(fn).toHaveBeenCalledTimes(10);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000]);

    const capped = vi.fn(async () => {});
    await expect(withDbRetry(async () => { throw transient(); }, { attempts: 5, maxDelayMs: 2500, sleep: capped })).rejects.toBeTruthy();
    expect(capped.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 2500, 2500]);
  });

  it('échoue immédiatement sur une erreur définitive, sans attendre', async () => {
    const sleep = vi.fn();
    const fn = vi.fn(async () => { throw transient('28P01', 'password authentication failed'); });
    await expect(withDbRetry(fn, { sleep })).rejects.toThrow(/password authentication failed/);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('utilise une vraie temporisation par défaut', async () => {
    const started = Date.now();
    let n = 0;
    await withDbRetry(async () => { if ((n += 1) < 2) throw transient(); }, { maxDelayMs: 5, log: () => {} });
    expect(n).toBe(2);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('commande de migration (node src/migrate.js)', () => {
  const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});
  const freshDb = () => createPgliteDb(new PGlite());

  it('refuse de démarrer sans MIGRATION_DATABASE_URL', async () => {
    const err = quiet();
    expect(await main({})).toBe(1);
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/MIGRATION_DATABASE_URL/));
  });

  it('attend que PostgreSQL soit prêt puis applique les migrations (premier lancement de docker compose)', async () => {
    const db = freshDb();
    const realPing = db.ping;
    let pings = 0;
    db.ping = async () => {
      pings += 1;
      if (pings <= 2) throw transient(); // le serveur temporaire de l'initialisation redémarre
      return realPing();
    };
    const log = vi.fn();
    const sleep = vi.fn(async () => {});
    const code = await main({ MIGRATION_DATABASE_URL: 'postgres://x' }, { createDb: () => db, log, sleep });
    expect(code).toBe(0);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
    const lines = log.mock.calls.map((c) => c[0]);
    expect(lines.filter((l) => /tentative \d+\/10/.test(l))).toHaveLength(2);
    expect(lines.some((l) => /migration appliquée : 001_/.test(l))).toBe(true);
    expect(lines.at(-1)).toMatch(/\d+ migration\(s\) appliquée\(s\)/);
  });

  it('reprend sans dégât si la base redémarre pendant une migration', async () => {
    const db = freshDb();
    const realTx = db.tx;
    db.close = async () => {}; // on interroge la base après la commande
    let failed = false;
    db.tx = async (fn) => {
      if (!failed) {
        failed = true;
        throw transient('57P01', 'terminating connection due to administrator command');
      }
      return realTx(fn);
    };
    const log = vi.fn();
    const code = await main({ MIGRATION_DATABASE_URL: 'postgres://x' }, { createDb: () => db, log, sleep: async () => {} });
    expect(code).toBe(0);
    const applied = (await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name);
    expect(new Set(applied).size).toBe(applied.length); // aucune migration enregistrée deux fois
    expect(applied.length).toBeGreaterThan(0);
  });

  it('échoue après le nombre de tentatives configuré si la base ne répond jamais', async () => {
    const err = quiet();
    const sleep = vi.fn(async () => {});
    const db = { ping: async () => { throw transient('ECONNREFUSED', 'connect ECONNREFUSED'); }, close: vi.fn(async () => {}) };
    const code = await main(
      { MIGRATION_DATABASE_URL: 'postgres://x', MIGRATION_RETRY_ATTEMPTS: '3', MIGRATION_RETRY_MAX_DELAY_MS: '1500' },
      { createDb: () => db, log: () => {}, sleep },
    );
    expect(code).toBe(1);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 1500]);
    expect(err).toHaveBeenCalledWith('Échec de migration :', expect.stringMatching(/ECONNREFUSED/));
    expect(db.close).toHaveBeenCalled();
  });

  it('échoue tout de suite sur un mauvais mot de passe (pas de tentatives inutiles)', async () => {
    const err = quiet();
    const sleep = vi.fn();
    const db = { ping: async () => { throw transient('28P01', 'password authentication failed for user "auth_owner"'); }, close: async () => {} };
    expect(await main({ MIGRATION_DATABASE_URL: 'postgres://x' }, { createDb: () => db, log: () => {}, sleep })).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith('Échec de migration :', expect.stringMatching(/password authentication/));
  });

  it('ignore des valeurs de configuration invalides et garde les valeurs par défaut', async () => {
    const sleep = vi.fn(async () => {});
    const db = { ping: async () => { throw transient(); }, close: async () => {} };
    quiet();
    await main({ MIGRATION_DATABASE_URL: 'x', MIGRATION_RETRY_ATTEMPTS: 'abc', MIGRATION_RETRY_MAX_DELAY_MS: '-4' }, { createDb: () => db, log: () => {}, sleep });
    expect(sleep).toHaveBeenCalledTimes(9);
  });
});
