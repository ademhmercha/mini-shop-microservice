import { randomBytes } from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { validate } from './lib/validate.js';
import { forbidden, unauthorized, AppError } from './lib/errors.js';

const MAX_LINES = 50;
const MAX_QTY = 20;
const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Identifiant de produit invalide.');
const qty = z.number().int('Quantité invalide.').min(1, 'Quantité minimale : 1.').max(MAX_QTY, `Quantité maximale : ${MAX_QTY}.`);

const addBody = z.object({ productId: UUID, quantity: qty.default(1) }).strict();
const setBody = z.object({ quantity: z.number().int().min(0).max(MAX_QTY) }).strict();
const productParam = z.object({ productId: UUID });
const GUEST_ID = /^[A-Za-z0-9_-]{22,64}$/;

export function createRoutes({ cfg, redis }) {
  const r = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const cookieOpts = { httpOnly: true, secure: cfg.COOKIE_SECURE, sameSite: 'strict', path: '/api/cart' };

  /** Les requêtes qui n'utilisent que le cookie invité exigent l'en-tête personnalisé et l'origine du site. */
  const csrfGuard = (req, _res, next) => {
    if (req.user || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('x-requested-with') !== 'shoplite') return next(forbidden('En-tête de sécurité manquant.', 'csrf_header'));
    if (req.get('origin') !== cfg.APP_ORIGIN) return next(forbidden('Origine non autorisée.', 'csrf_origin'));
    return next();
  };

  /** Panier du compte si connecté, sinon panier invité identifié par un identifiant de session aléatoire (cookie HttpOnly). */
  const cartKey = (req, res, { create = false } = {}) => {
    if (req.user) return { key: `cart:user:${req.user.id}`, ttl: cfg.USER_CART_TTL_SECONDS };
    let sid = req.cookies?.cart_sid;
    if (!sid || !GUEST_ID.test(sid)) {
      if (!create) return null;
      sid = randomBytes(24).toString('base64url');
      res.cookie('cart_sid', sid, { ...cookieOpts, maxAge: cfg.GUEST_CART_TTL_SECONDS * 1000 });
    }
    return { key: `cart:guest:${sid}`, ttl: cfg.GUEST_CART_TTL_SECONDS };
  };

  const read = async (key) => {
    const h = key ? await redis.hgetall(key) : {};
    return Object.entries(h)
      .map(([productId, q]) => ({ productId, quantity: Number(q) }))
      .sort((a, b) => a.productId.localeCompare(b.productId));
  };
  const body = (items) => ({ items, itemCount: items.reduce((n, i) => n + i.quantity, 0) });

  r.use(csrfGuard);

  r.get('/', wrap(async (req, res) => {
    const c = cartKey(req, res);
    res.set('Cache-Control', 'no-store');
    res.json(body(await read(c?.key)));
  }));

  r.post('/items', validate(addBody), wrap(async (req, res) => {
    const c = cartKey(req, res, { create: true });
    const { productId, quantity } = req.body;
    const existing = Number(await redis.hget(c.key, productId)) || 0;
    if (!existing && (await redis.hlen(c.key)) >= MAX_LINES) throw new AppError(409, 'cart_full', 'Le panier contient trop de références.');
    await redis.hset(c.key, productId, Math.min(MAX_QTY, existing + quantity));
    await redis.expire(c.key, c.ttl);
    res.status(201).json(body(await read(c.key)));
  }));

  r.put('/items/:productId', validate(productParam, 'params'), validate(setBody), wrap(async (req, res) => {
    const c = cartKey(req, res, { create: true });
    const { productId } = req.params;
    if (req.body.quantity === 0) {
      await redis.hdel(c.key, productId);
    } else {
      if (!(await redis.hexists(c.key, productId)) && (await redis.hlen(c.key)) >= MAX_LINES) {
        throw new AppError(409, 'cart_full', 'Le panier contient trop de références.');
      }
      await redis.hset(c.key, productId, req.body.quantity);
      await redis.expire(c.key, c.ttl);
    }
    res.json(body(await read(c.key)));
  }));

  r.delete('/items/:productId', validate(productParam, 'params'), wrap(async (req, res) => {
    const c = cartKey(req, res);
    if (c) await redis.hdel(c.key, req.params.productId);
    res.json(body(await read(c?.key)));
  }));

  r.delete('/', wrap(async (req, res) => {
    const c = cartKey(req, res);
    if (c) await redis.del(c.key);
    res.status(204).end();
  }));

  /** Fusion du panier invité dans le panier du compte, à la connexion. */
  r.post('/merge', wrap(async (req, res) => {
    if (!req.user) throw unauthorized();
    const sid = req.cookies?.cart_sid;
    const userKey = `cart:user:${req.user.id}`;
    if (sid && GUEST_ID.test(sid)) {
      const guestKey = `cart:guest:${sid}`;
      const guest = await redis.hgetall(guestKey);
      for (const [productId, q] of Object.entries(guest)) {
        const current = Number(await redis.hget(userKey, productId)) || 0;
        if (!current && (await redis.hlen(userKey)) >= MAX_LINES) continue;
        await redis.hset(userKey, productId, Math.min(MAX_QTY, current + Number(q)));
      }
      await redis.del(guestKey);
      await redis.expire(userKey, cfg.USER_CART_TTL_SECONDS);
    }
    res.clearCookie('cart_sid', cookieOpts);
    res.json(body(await read(userKey)));
  }));

  return r;
}
