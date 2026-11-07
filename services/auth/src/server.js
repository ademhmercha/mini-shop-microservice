import { Redis } from 'ioredis';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createPgDb } from './db.js';
import { createApp } from './app.js';

/* c8 ignore start */
let cfg;
try {
  cfg = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const log = createLogger(cfg.LOG_LEVEL);
const db = createPgDb(cfg.DATABASE_URL);
const redis = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: 2, enableReadyCheck: true });
redis.on('error', (err) => log.error({ err: { message: err.message } }, 'erreur Redis'));

const { app, background } = createApp({ cfg, db, redis, log });
const server = app.listen(cfg.PORT, () => log.info({ port: cfg.PORT }, 'service auth démarré'));

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, 'arrêt propre en cours');
  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();
  server.close(async () => {
    await background.drain();
    await Promise.allSettled([db.close(), redis.quit()]);
    log.info('arrêt terminé');
    process.exit(0);
  });
  server.closeIdleConnections?.();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
/* c8 ignore stop */
