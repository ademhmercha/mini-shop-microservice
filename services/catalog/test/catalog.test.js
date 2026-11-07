import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { createPgliteDb } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'http://localhost:8080';
let db;
let agent;
let built;

beforeAll(async () => {
  db = createPgliteDb(new PGlite());
  await runMigrations(db, path.join(here, '..', 'migrations'));
  const cfg = loadConfig({ DATABASE_URL: 'postgres://x', APP_ORIGIN: ORIGIN, NODE_ENV: 'test' });
  built = createApp({ cfg, db, log: createLogger('silent') });
  agent = request(built.app);
});
afterAll(() => db.close());

describe('configuration', () => {
  it('refuse de démarrer sans variable obligatoire', () => {
    expect(() => loadConfig({ APP_ORIGIN: ORIGIN })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'x', APP_ORIGIN: 'pas-une-url' })).toThrow(/APP_ORIGIN/);
  });
});

describe('GET /products', () => {
  it('liste les produits de démonstration avec pagination', async () => {
    const res = await agent.get('/products').expect(200);
    expect(res.body.total).toBe(12);
    expect(res.body.items).toHaveLength(12);
    expect(res.body.totalPages).toBe(1);
    const p = res.body.items[0];
    expect(p).toMatchObject({ currency: 'EUR' });
    expect(p.priceCents).toBeGreaterThan(0);
    expect(res.headers['cache-control']).toMatch(/max-age/);
    const page2 = await agent.get('/products?pageSize=5&page=3').expect(200);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.totalPages).toBe(3);
  });

  it('filtre par catégorie et par sélection', async () => {
    const res = await agent.get('/products?category=theieres').expect(200);
    expect(res.body.items.map((p) => p.category.slug)).toEqual(['theieres', 'theieres']);
    const featured = await agent.get('/products?featured=true').expect(200);
    expect(featured.body.items.every((p) => p.featured)).toBe(true);
    const ids = res.body.items.map((p) => p.id).join(',');
    const byIds = await agent.get(`/products?ids=${ids}`).expect(200);
    expect(byIds.body.total).toBe(2);
    const empty = await agent.get('/products?category=inconnue').expect(200);
    expect(empty.body.items).toEqual([]);
  });

  it('valide strictement les paramètres', async () => {
    await agent.get('/products?page=0').expect(400);
    await agent.get('/products?pageSize=500').expect(400);
    await agent.get('/products?category=a;DROP TABLE products').expect(400);
    await agent.get('/products?ids=pas-un-uuid').expect(400);
    const injection = await agent.get("/products?category=bols'%20OR%20'1'='1").expect(400);
    expect(injection.body.error.code).toBe('validation_error');
  });
});

describe('GET /products/:id et /categories', () => {
  it('retourne un produit par identifiant ou par slug', async () => {
    const list = await agent.get('/products?pageSize=1').expect(200);
    const { id, slug } = list.body.items[0];
    const byId = await agent.get(`/products/${id}`).expect(200);
    const bySlug = await agent.get(`/products/${slug}`).expect(200);
    expect(byId.body).toEqual(bySlug.body);
    expect(byId.body.description.length).toBeGreaterThan(20);
  });

  it('renvoie 404 pour un produit inconnu et 400 pour un identifiant invalide', async () => {
    await agent.get('/products/00000000-0000-4000-8000-000000000000').expect(404);
    await agent.get('/products/produit-inexistant').expect(404);
    await agent.get("/products/a'b").expect(400);
  });

  it('liste les catégories avec leur nombre de produits', async () => {
    const res = await agent.get('/categories').expect(200);
    expect(res.body.items.map((c) => c.slug)).toEqual(['bols', 'tasses', 'vases', 'assiettes', 'theieres']);
    expect(res.body.items.reduce((n, c) => n + c.productCount, 0)).toBe(12);
  });

  it('n’expose pas les produits désactivés', async () => {
    await db.query("UPDATE products SET active = false WHERE slug = 'bol-aube'");
    await agent.get('/products/bol-aube').expect(404);
    expect((await agent.get('/products')).body.total).toBe(11);
    await db.query("UPDATE products SET active = true WHERE slug = 'bol-aube'");
  });
});

describe('opérations', () => {
  it('expose healthz, readyz, metrics, docs et propage X-Request-Id', async () => {
    await agent.get('/healthz').expect(200);
    await agent.get('/readyz').expect(200);
    const m = await agent.get('/metrics').expect(200);
    expect(m.text).toMatch(/http_requests_total\{method="GET",route="\/products"/);
    expect(m.text).toMatch(/http_request_duration_seconds/);
    expect(m.text).toMatch(/http_request_errors_total/);
    await agent.get('/docs/').expect(200);
    const res = await agent.get('/healthz').set('X-Request-Id', 'abc12345-req').expect(200);
    expect(res.headers['x-request-id']).toBe('abc12345-req');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const nf = await agent.get('/nimporte').expect(404);
    expect(nf.body.error.code).toBe('not_found');
    expect(nf.body.error.requestId).toBeTruthy();
  });

  it('/readyz renvoie 503 si la base est injoignable', async () => {
    const broken = createApp({
      cfg: loadConfig({ DATABASE_URL: 'x', APP_ORIGIN: ORIGIN }),
      db: { ping: async () => { throw new Error('down'); }, query: async () => { throw new Error('down'); } },
      log: createLogger('silent'),
    });
    await request(broken.app).get('/readyz').expect(503);
    const res = await request(broken.app).get('/products').expect(500);
    expect(res.body.error.message).not.toMatch(/down/); // aucun détail interne exposé
  });

  it('répond proprement aux corps invalides ou trop volumineux', async () => {
    const big = await agent.post('/products').send({ x: 'a'.repeat(20000) }).expect(413);
    expect(big.body.error.code).toBe('payload_too_large');
    const bad = await agent.post('/products').set('Content-Type', 'application/json').send('{oops').expect(400);
    expect(bad.body.error.code).toBe('invalid_json');
    await agent.post('/products').send({}).expect(404);
  });

  it('les migrations sont idempotentes', async () => {
    expect(await runMigrations(db, path.join(here, '..', 'migrations'))).toBe(0);
  });
});
