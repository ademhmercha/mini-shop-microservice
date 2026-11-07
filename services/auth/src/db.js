import pg from 'pg';

/** Adaptateur minimal : query(sql, params) -> { rows }, tx(fn), ping(), close(). */
export function createPgDb(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
  return {
    query: (sql, params = []) => pool.query(sql, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (s, p = []) => client.query(s, p) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async ping() {
      await pool.query('SELECT 1');
    },
    close: () => pool.end(),
  };
}

/** Adaptateur PGlite (tests, sans Docker). `exec` gère les scripts multi-instructions des migrations. */
export function createPgliteDb(pglite) {
  const run = async (target, sql, params) => {
    if (params.length) return target.query(sql, params);
    const results = await target.exec(sql);
    return results.at(-1) ?? { rows: [] };
  };
  return {
    query: (sql, params = []) => run(pglite, sql, params),
    tx: (fn) => pglite.transaction((t) => fn({ query: (s, p = []) => run(t, s, p) })),
    async ping() {
      await pglite.query('SELECT 1');
    },
    close: () => pglite.close(),
  };
}
