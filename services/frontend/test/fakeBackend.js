import { vi } from 'vitest';

const CATEGORIES = [
  { id: 'c1', slug: 'bols', name: 'Bols', description: 'Pour le riz du soir.', productCount: 2 },
  { id: 'c2', slug: 'theieres', name: 'Théières', description: 'Pour laisser infuser le temps.', productCount: 1 },
];
const mk = (n, slug, name, price, cat, illustration, tone, featured = false) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, slug, name, description: `${name} : une description poétique et soignée.`,
  details: 'Ø 14 cm · grès émaillé', priceCents: price, currency: 'EUR', illustration, tone, featured, category: cat,
});
export const PRODUCTS = [
  mk(1, 'bol-aube', 'Bol Aube', 2400, { slug: 'bols', name: 'Bols' }, 'bowl-aube', 'creme', true),
  mk(2, 'bol-fumee', 'Bol Fumée', 2800, { slug: 'bols', name: 'Bols' }, 'bowl-fumee', 'charbon'),
  mk(3, 'theiere-serenade', 'Théière Sérénade', 7800, { slug: 'theieres', name: 'Théières' }, 'teapot-serenade', 'sauge', true),
];

const reply = (status, body, headers = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const err = (status, code, message, extra = {}) => reply(status, { error: { code, message, requestId: 'req-test', ...extra } });

/** Faux backend en mémoire : remplace fetch pour exercer toute l'application sans réseau. */
export function installFakeBackend(options = {}) {
  const state = {
    loggedIn: options.loggedIn ?? false,
    user: {
      id: 'u1', email: 'camille@example.fr', emailVerified: options.verified ?? true, firstName: 'Camille', lastName: 'Dupont',
      shippingAddress: null, twoFactorEnabled: false, createdAt: '2026-01-01T10:00:00Z',
    },
    cart: new Map(),
    orders: [],
    sessions: [
      { id: 's1', device: 'Chrome sur Windows', ip: '::1', createdAt: '2026-11-01T10:00:00Z', lastSeenAt: '2026-11-06T09:00:00Z', current: true },
      { id: 's2', device: 'Safari sur iOS', ip: '10.0.0.2', createdAt: '2026-11-02T10:00:00Z', lastSeenAt: '2026-11-05T09:00:00Z', current: false },
    ],
    failProducts: false,
    failOrders: null,
    calls: [],
    loginError: null,
    twoFactor: false,
  };
  const cartBody = () => {
    const items = [...state.cart.entries()].map(([productId, quantity]) => ({ productId, quantity }));
    return { items, itemCount: items.reduce((n, i) => n + i.quantity, 0) };
  };
  const session = () => ({ accessToken: 'tok', expiresIn: 900, user: state.user });

  const handler = async (url, init = {}) => {
    const u = new URL(url, 'http://localhost');
    const path = u.pathname;
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : {};
    state.calls.push({ method, path, body, headers: init.headers });

    if (path === '/api/auth/refresh') return state.loggedIn ? reply(200, session()) : err(401, 'invalid_session', 'Session absente.');
    if (path === '/api/auth/login') {
      if (state.loginError) return state.loginError;
      if (state.twoFactor) return reply(200, { twoFactorRequired: true, challengeToken: 'x'.repeat(30) });
      state.loggedIn = true;
      return reply(200, session());
    }
    if (path === '/api/auth/login/2fa') {
      state.loggedIn = true;
      return reply(200, session());
    }
    if (path === '/api/auth/logout') {
      state.loggedIn = false;
      return reply(204, null);
    }
    if (path === '/api/auth/register' || path === '/api/auth/forgot-password') return reply(202, { message: 'ok' });
    if (path === '/api/auth/resend-verification') return reply(202, { sent: true });
    if (path === '/api/auth/me' && method === 'GET') return reply(200, { user: state.user });
    if (path === '/api/auth/me' && method === 'PATCH') {
      state.user = { ...state.user, ...body };
      return reply(200, { user: state.user });
    }
    if (path === '/api/auth/me' && method === 'DELETE') {
      if (body.password !== 'Correct-Horse-Battery-9') return err(403, 'wrong_password', 'Mot de passe incorrect.');
      state.loggedIn = false;
      return reply(204, null);
    }
    if (path === '/api/auth/me/password') {
      if (body.currentPassword !== 'Correct-Horse-Battery-9') return err(403, 'wrong_password', 'Mot de passe incorrect.');
      return reply(200, { changed: true });
    }
    if (path === '/api/auth/me/email') return reply(202, { message: 'ok' });
    if (path === '/api/auth/reauth') {
      return body.password === 'Correct-Horse-Battery-9' ? reply(200, { freshToken: 'fresh-1', expiresIn: 300 }) : err(403, 'wrong_password', 'Mot de passe incorrect.');
    }
    if (path === '/api/auth/me/2fa/setup') return reply(200, { secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/x', qrCode: 'data:image/png;base64,iVBORw0KGgo=' });
    if (path === '/api/auth/me/2fa/enable') {
      if (body.code !== '123456') return err(400, 'invalid_code', 'Code incorrect.');
      state.user = { ...state.user, twoFactorEnabled: true };
      return reply(200, { backupCodes: Array.from({ length: 10 }, (_, i) => `abcd${i}-efgh${i}`) });
    }
    if (path === '/api/auth/me/2fa/disable') {
      state.user = { ...state.user, twoFactorEnabled: false };
      return reply(200, { disabled: true });
    }
    if (path === '/api/auth/me/sessions' && method === 'GET') return reply(200, { sessions: state.sessions });
    if (path === '/api/auth/me/sessions' && method === 'DELETE') {
      state.sessions = state.sessions.filter((s) => s.current);
      return reply(200, { revoked: 1 });
    }
    if (path.startsWith('/api/auth/me/sessions/')) {
      state.sessions = state.sessions.filter((s) => s.id !== path.split('/').pop());
      return reply(204, null);
    }
    if (path === '/api/auth/me/export') return reply(200, { exportedAt: '2026-11-06T10:00:00Z', account: { email: state.user.email }, sessions: [], securityEvents: [] });

    if (path === '/api/catalog/categories') return reply(200, { items: CATEGORIES });
    if (path === '/api/catalog/products') {
      if (state.failProducts) return err(503, 'service_unavailable', 'Le service est momentanément indisponible.');
      let items = PRODUCTS;
      const cat = u.searchParams.get('category');
      if (cat) items = items.filter((p) => p.category.slug === cat);
      if (u.searchParams.get('featured')) items = items.filter((p) => p.featured);
      const ids = u.searchParams.get('ids');
      if (ids) items = items.filter((p) => ids.split(',').includes(p.id));
      const pageSize = Number(u.searchParams.get('pageSize') ?? 9);
      const page = Number(u.searchParams.get('page') ?? 1);
      return reply(200, { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: items.length, totalPages: Math.max(1, Math.ceil(items.length / pageSize)) });
    }
    if (path.startsWith('/api/catalog/products/')) {
      const p = PRODUCTS.find((x) => x.slug === decodeURIComponent(path.split('/').pop()));
      return p ? reply(200, p) : err(404, 'not_found', 'Produit introuvable.');
    }

    if (path === '/api/cart/' || path === '/api/cart') {
      if (method === 'DELETE') {
        state.cart.clear();
        return reply(204, null);
      }
      return reply(200, cartBody());
    }
    if (path === '/api/cart/merge') return reply(200, cartBody());
    if (path === '/api/cart/items') {
      state.cart.set(body.productId, (state.cart.get(body.productId) ?? 0) + body.quantity);
      return reply(201, cartBody());
    }
    if (path.startsWith('/api/cart/items/')) {
      const id = path.split('/').pop();
      if (method === 'PUT') body.quantity === 0 ? state.cart.delete(id) : state.cart.set(id, body.quantity);
      if (method === 'DELETE') state.cart.delete(id);
      return reply(200, cartBody());
    }

    if (path === '/api/orders/' && method === 'POST') {
      if (state.failOrders) return state.failOrders;
      const items = [...state.cart.entries()].map(([productId, quantity]) => {
        const p = PRODUCTS.find((x) => x.id === productId);
        return { productId, name: p.name, unitPriceCents: p.priceCents, quantity, lineTotalCents: p.priceCents * quantity };
      });
      const order = {
        id: '11111111-1111-4111-8111-111111111111', reference: 'MA-000007', status: 'pending', paymentMethod: 'on_site',
        totalCents: items.reduce((n, i) => n + i.lineTotalCents, 0), currency: 'EUR', shippingAddress: body.shippingAddress,
        note: body.note, createdAt: '2026-11-06T10:00:00Z', items,
      };
      state.orders.unshift(order);
      state.cart.clear();
      return reply(201, { order });
    }
    if (path === '/api/orders/me') return reply(200, { items: state.orders, page: 1, pageSize: 10, total: state.orders.length, totalPages: 1 });
    if (path.startsWith('/api/orders/')) {
      const o = state.orders.find((x) => x.id === path.split('/').pop());
      return o ? reply(200, { order: o }) : err(404, 'not_found', 'Commande introuvable.');
    }
    return err(404, 'not_found', `Route inconnue ${path}`);
  };

  globalThis.fetch = vi.fn(handler);
  return state;
}
