import express from 'express';
import { z } from 'zod';
import { validate } from './lib/validate.js';
import { notFound } from './lib/errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const listQuery = z.object({
  category: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,40}$/, 'Catégorie invalide.').optional(),
  featured: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
  // Liste d'identifiants (panier / commande) : jusqu'à 50 UUID séparés par des virgules.
  ids: z
    .string()
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(z.string().regex(UUID, 'Identifiant invalide.')).min(1).max(50))
    .optional(),
});

const idParam = z.object({ id: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9-]+$/, 'Identifiant invalide.') });

const SELECT = `SELECT p.id, p.slug, p.name, p.description, p.details, p.price_cents, p.currency,
  p.illustration_key, p.tone, p.featured, c.slug AS category_slug, c.name AS category_name
  FROM products p JOIN categories c ON c.id = p.category_id`;

const toProduct = (r) => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  description: r.description,
  details: r.details,
  priceCents: r.price_cents,
  currency: r.currency,
  illustration: r.illustration_key,
  tone: r.tone,
  featured: r.featured,
  category: { slug: r.category_slug, name: r.category_name },
});

export function createRoutes({ db }) {
  const r = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  r.get('/products', validate(listQuery, 'query'), wrap(async (req, res) => {
    const { category, featured, page, pageSize, ids } = req.validatedQuery;
    // Requêtes toujours paramétrées : les valeurs ne sont jamais concaténées au SQL.
    const where = ['p.active'];
    const params = [];
    if (category) { params.push(category); where.push(`c.slug = $${params.length}`); }
    if (featured) { params.push(featured === 'true'); where.push(`p.featured = $${params.length}`); }
    if (ids) { params.push(ids); where.push(`p.id = ANY($${params.length}::uuid[])`); }
    const clause = where.join(' AND ');
    const total = (await db.query(`SELECT count(*)::int AS n FROM products p JOIN categories c ON c.id = p.category_id WHERE ${clause}`, params)).rows[0].n;
    const rows = (
      await db.query(`${SELECT} WHERE ${clause} ORDER BY p.featured DESC, c.position, p.name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, pageSize, (page - 1) * pageSize])
    ).rows;
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ items: rows.map(toProduct), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  }));

  r.get('/products/:id', validate(idParam, 'params'), wrap(async (req, res) => {
    const { id } = req.params;
    const byId = UUID.test(id);
    const row = (await db.query(`${SELECT} WHERE p.active AND ${byId ? 'p.id = $1::uuid' : 'p.slug = $1'}`, [id])).rows[0];
    if (!row) throw notFound('Produit introuvable.');
    res.set('Cache-Control', 'public, max-age=60');
    res.json(toProduct(row));
  }));

  r.get('/categories', wrap(async (_req, res) => {
    const rows = (
      await db.query(`SELECT c.id, c.slug, c.name, c.description, count(p.id)::int AS product_count
        FROM categories c LEFT JOIN products p ON p.category_id = c.id AND p.active
        GROUP BY c.id ORDER BY c.position`)
    ).rows;
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ items: rows.map((c) => ({ id: c.id, slug: c.slug, name: c.name, description: c.description, productCount: c.product_count })) });
  }));

  return r;
}
