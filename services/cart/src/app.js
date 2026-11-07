import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { createMetrics } from './lib/metrics.js';
import { errorHandler, notFound, forbidden } from './lib/errors.js';
import { authenticate, createJwtVerifier } from './lib/auth.js';
import { createRoutes } from './routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REQUEST_ID = /^[\w.-]{8,64}$/;
const UUID_LIKE = /^[0-9a-f-]{36}$/i;

export function createApp({ cfg, redis, log, verifyToken }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.TRUST_PROXY);
  const metrics = createMetrics('cart');
  const verify = verifyToken ?? createJwtVerifier(cfg);

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

  const strict = helmet();
  const docs = helmet({ contentSecurityPolicy: false });
  app.use((req, res, next) => (req.path.startsWith('/docs') ? docs : strict)(req, res, next));

  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', async (_req, res) => {
    try {
      await redis.ping();
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

  app.use(cors({ origin: cfg.APP_ORIGIN, credentials: true, allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id'], maxAge: 600 }));
  app.use(express.json({ limit: '5kb' }));
  app.use(cookieParser());

  // Appel interne (non exposé par Nginx) : effacement RGPD du panier d'un compte supprimé.
  app.delete('/internal/users/:id', async (req, res, next) => {
    try {
      const given = Buffer.from(req.get('x-internal-token') ?? '');
      const expected = Buffer.from(cfg.INTERNAL_API_TOKEN ?? '');
      if (!expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) {
        throw forbidden('Accès interne refusé.', 'internal_forbidden');
      }
      if (!UUID_LIKE.test(req.params.id)) throw forbidden('Identifiant invalide.', 'bad_id');
      await redis.del(`cart:user:${req.params.id}`);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  app.use(authenticate(verify));
  app.use(createRoutes({ cfg, redis }));

  app.use((_req, _res, next) => next(notFound()));
  app.use(errorHandler(log));
  return { app, metrics };
}
