import client from 'prom-client';

export function createMetrics() {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry, prefix: 'auth_' });

  const requests = new client.Counter({
    name: 'http_requests_total',
    help: 'Nombre de requêtes HTTP',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });
  const duration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Durée des requêtes HTTP',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });
  const errors = new client.Counter({
    name: 'http_request_errors_total',
    help: 'Requêtes HTTP en erreur (statut >= 400)',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });
  const loginsSucceeded = new client.Counter({
    name: 'auth_logins_succeeded_total',
    help: 'Connexions réussies',
    registers: [registry],
  });
  const loginsFailed = new client.Counter({
    name: 'auth_logins_failed_total',
    help: 'Connexions échouées',
    registers: [registry],
  });
  const lockouts = new client.Counter({
    name: 'auth_lockouts_total',
    help: 'Comptes verrouillés temporairement',
    registers: [registry],
  });

  const middleware = (req, res, next) => {
    const end = duration.startTimer();
    res.on('finish', () => {
      const route = req.route ? `${req.baseUrl ?? ''}${req.route.path}` : 'unmatched';
      const labels = { method: req.method, route, status: String(res.statusCode) };
      requests.inc(labels);
      end(labels);
      if (res.statusCode >= 400) errors.inc(labels);
    });
    next();
  };

  return { registry, middleware, loginsSucceeded, loginsFailed, lockouts };
}
