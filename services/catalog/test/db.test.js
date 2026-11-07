import { describe, it, expect, vi, beforeEach } from 'vitest';

const client = { query: vi.fn(), release: vi.fn() };
const pool = { query: vi.fn(), connect: vi.fn(async () => client), end: vi.fn(), on: vi.fn() };
vi.mock('pg', () => ({ default: { Pool: function Pool() { return pool; } } }));

const { createPgDb } = await import('../src/db.js');

describe('adaptateur PostgreSQL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.query.mockResolvedValue({ rows: [] });
    pool.query.mockResolvedValue({ rows: [{ ok: 1 }] });
  });

  it('délègue les requêtes paramétrées au pool, ping et fermeture', async () => {
    const db = createPgDb('postgres://u:p@h/db');
    expect((await db.query('SELECT $1', [1])).rows[0].ok).toBe(1);
    expect(pool.query).toHaveBeenCalledWith('SELECT $1', [1]);
    await db.ping();
    await db.close();
    expect(pool.end).toHaveBeenCalled();
  });

  it('gère les erreurs du pool (redémarrage de PostgreSQL) sans faire tomber le processus', () => {
    const onError = vi.fn();
    createPgDb('x', { onError });
    expect(pool.on).toHaveBeenCalledWith('error', onError);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createPgDb('x');
    pool.on.mock.calls.at(-1)[1](Object.assign(new Error('terminating connection'), { code: '57P01' }));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('57P01'));
    spy.mockRestore();
  });

  it('valide une transaction réussie', async () => {
    const db = createPgDb('x');
    const out = await db.tx(async (t) => {
      await t.query('INSERT 1');
      return 'ok';
    });
    expect(out).toBe('ok');
    expect(client.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'INSERT 1', 'COMMIT']);
    expect(client.release).toHaveBeenCalled();
  });

  it('annule la transaction en cas d’erreur et libère la connexion', async () => {
    const db = createPgDb('x');
    await expect(db.tx(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(client.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalled();
  });
});
