import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { createKeyring } from './lib/jwt.js';
import { createRateLimiter } from './lib/rateLimit.js';
import { createSecretBox } from './lib/secretBox.js';
import { createMetrics } from './lib/metrics.js';
import { createBackground } from './lib/background.js';
import { errorHandler, notFound } from './lib/errors.js';
import { createMailer } from './lib/mailer.js';
import { createAudit } from './services/audit.js';
import { createAuthService } from './services/authService.js';
import { createInternalClient } from './services/internal.js';
import { createRoutes } from './routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REQUEST_ID = /^[\w.-]{8,64}$/;

export function createApp({ cfg, db, redis, log, mailer: injectedMailer, internal: injectedInternal }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.TRUST_PROXY);

  const keyring = createKeyring(cfg);
  const limiter = createRateLimiter(redis, cfg);
  const mailer = injectedMailer ?? createMailer(cfg);
  const metrics = createMetrics();
  const background = createBackground(log);
  const audit = createAudit(db, log);
  const internal = injectedInternal ?? createInternalClient(cfg, log);
  const svc = createAuthService({
    db, cfg, keyring, limiter, mailer, secretBox: createSecretBox(cfg.TOTP_ENCRYPTION_KEY), audit, metrics, background, log, internal,
  });
  const ctxOf = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') ?? '' });

  // Identifiant de requête propagé d'un service à l'autre (X-Request-Id).
  app.use((req, res, next) => {
    const incoming = req.get('x-request-id');
    req.id = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.set('X-Request-Id', req.id);
    next();
  });
  app.use(
    pinoHttp({
      logger: log,
      genReqId: (req) => req.id,
      autoLogging: { ignore: (req) => ['/healthz', '/readyz', '/metrics'].includes(req.url) },
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url.split('?')[0], remoteAddress: req.remoteAddress }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(metrics.middleware);

  // En-têtes de sécurité partout ; seule l'interface Swagger a besoin d'une CSP assouplie.
  const strict = helmet();
  const docs = helmet({ contentSecurityPolicy: false });
  app.use((req, res, next) => (req.path.startsWith('/docs') ? docs : strict)(req, res, next));

  /* ---------- Opérations (sans CORS ni CSP) ---------- */
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', async (_req, res) => {
    try {
      await Promise.all([db.ping(), redis.ping()]);
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', metrics.registry.contentType);
    res.send(await metrics.registry.metrics());
  });

  const spec = YAML.parse(fs.readFileSync(path.join(here, '..', 'openapi.yaml'), 'utf8'));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
  app.get('/openapi.json', (_req, res) => res.json(spec));

  /* ---------- API ---------- */
  app.get('/.well-known/jwks.json', cors({ origin: '*' }), (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(keyring.jwks);
  });
  app.use(cors({ origin: cfg.APP_ORIGIN, credentials: true, allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Fresh-Token', 'X-Request-Id'], maxAge: 600 }));
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());
  app.use(createRoutes({ cfg, svc, keyring, ctxOf }));

  app.use((_req, _res, next) => next(notFound()));
  app.use(errorHandler(log));

  return { app, svc, metrics, background, keyring, limiter };
}
