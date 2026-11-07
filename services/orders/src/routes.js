import express from 'express';
import { z } from 'zod';
import { validate } from './lib/validate.js';
import { AppError, badRequest, notFound } from './lib/errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Le navigateur n'envoie jamais de prix ni de produits : seulement l'adresse et une note.
const createBody = z
  .object({
    shippingAddress: z
      .object({
        line1: z.string().trim().min(1, 'Adresse requise.').max(120),
        line2: z.string().trim().max(120).optional().default(''),
        postalCode: z.string().trim().min(2, 'Code postal requis.').max(12),
        city: z.string().trim().min(1, 'Ville requise.').max(80),
        country: z.string().trim().min(2).max(60).default('France'),
      })
      .strict(),
    note: z.string().trim().max(300, 'Maximum 300 caractères.').optional().default(''),
  })
  .strict();

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

const reference = (n) => `MA-${String(n).padStart(6, '0')}`;

function toOrder(row, items) {
  return {
    id: row.id,
    reference: reference(row.number),
    status: row.status,
    paymentMethod: row.payment_method,
    totalCents: row.total_cents,
    currency: row.currency,
    shippingAddress: row.shipping_address,
    note: row.note,
    createdAt: row.created_at,
    items: items.map((i) => ({
      productId: i.product_id,
      name: i.name_snapshot,
      unitPriceCents: i.unit_price_cents,
      quantity: i.quantity,
      lineTotalCents: i.unit_price_cents * i.quantity,
    })),
  };
}

export function createRoutes({ cfg, db, upstream, log, auth }) {
  const r = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const base = (u) => u.replace(/\/$/, '');

  async function itemsFor(orderIds) {
    if (!orderIds.length) return new Map();
    const rows = (await db.query('SELECT * FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY name_snapshot', [orderIds])).rows;
    const map = new Map();
    for (const row of rows) map.set(row.order_id, [...(map.get(row.order_id) ?? []), row]);
    return map;
  }

  /** Création d'une commande : utilisateur connecté ET vérifié. Prix et produits viennent du serveur, jamais du navigateur. */
  r.post('/', auth.verified, validate(createBody), wrap(async (req, res) => {
    const headers = { Authorization: `Bearer ${req.bearer}` };
    const cart = await upstream('cart', `${base(cfg.CART_URL)}/`, { headers, requestId: req.id });
    if (!cart?.items?.length) throw badRequest('Votre panier est vide.', 'cart_empty');

    const ids = cart.items.map((i) => i.productId);
    const catalog = await upstream('catalog', `${base(cfg.CATALOG_URL)}/products?pageSize=50&ids=${ids.join(',')}`, { requestId: req.id });
    const products = new Map((catalog?.items ?? []).map((p) => [p.id, p]));

    const lines = [];
    for (const item of cart.items) {
      const product = products.get(item.productId);
      if (!product) throw new AppError(409, 'product_unavailable', "Un produit de votre panier n'est plus disponible.", { productId: item.productId });
      lines.push({ product, quantity: item.quantity });
    }
    const total = lines.reduce((sum, l) => sum + l.product.priceCents * l.quantity, 0);

    const order = await db.tx(async (t) => {
      const row = (
        await t.query(
          'INSERT INTO orders (user_id, total_cents, currency, shipping_address, note) VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING *',
          [req.user.id, total, lines[0].product.currency, JSON.stringify(req.body.shippingAddress), req.body.note],
        )
      ).rows[0];
      const inserted = [];
      for (const l of lines) {
        inserted.push(
          (
            await t.query(
              'INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price_cents, quantity) VALUES ($1, $2, $3, $4, $5) RETURNING *',
              [row.id, l.product.id, l.product.name, l.product.priceCents, l.quantity],
            )
          ).rows[0],
        );
      }
      return toOrder(row, inserted);
    });

    // La commande est enregistrée : un échec de nettoyage du panier ne doit pas la faire échouer.
    try {
      await upstream('cart', `${base(cfg.CART_URL)}/`, { method: 'DELETE', headers, requestId: req.id });
    } catch (err) {
      log.warn({ orderId: order.id, err: { message: err.message } }, 'panier non vidé après la commande');
    }
    log.info({ orderId: order.id, userId: req.user.id, totalCents: total }, 'commande créée');
    res.status(201).json({ order });
  }));

  r.get('/me', auth.any, validate(pageQuery, 'query'), wrap(async (req, res) => {
    const { page, pageSize } = req.validatedQuery;
    const total = (await db.query('SELECT count(*)::int AS n FROM orders WHERE user_id = $1', [req.user.id])).rows[0].n;
    const rows = (
      await db.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC, number DESC LIMIT $2 OFFSET $3', [req.user.id, pageSize, (page - 1) * pageSize])
    ).rows;
    const items = await itemsFor(rows.map((o) => o.id));
    res.set('Cache-Control', 'no-store');
    res.json({ items: rows.map((o) => toOrder(o, items.get(o.id) ?? [])), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  }));

  // Uniquement les commandes de l'utilisateur : une commande d'autrui répond 404 (on ne confirme pas son existence).
  r.get('/:id', auth.any, wrap(async (req, res) => {
    if (!UUID.test(req.params.id)) throw notFound('Commande introuvable.');
    const row = (await db.query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id])).rows[0];
    if (!row) throw notFound('Commande introuvable.');
    const items = await itemsFor([row.id]);
    res.set('Cache-Control', 'no-store');
    res.json({ order: toOrder(row, items.get(row.id) ?? []) });
  }));

  return r;
}
