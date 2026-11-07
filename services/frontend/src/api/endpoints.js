import { api, session } from './http.js';

const post = (path, body, opts) => api(path, { method: 'POST', body, ...opts });
const withFresh = (fresh) => ({ 'X-Fresh-Token': fresh });

export const authApi = {
  register: (email, password) => post('/api/auth/register', { email, password }),
  verifyEmail: (token) => post('/api/auth/verify-email', { token }),
  login: async (email, password) => {
    const data = await post('/api/auth/login', { email, password });
    if (data.accessToken) session.set(data.accessToken, data.expiresIn);
    return data;
  },
  loginSecondFactor: async (challengeToken, code) => {
    const data = await post('/api/auth/login/2fa', { challengeToken, code });
    session.set(data.accessToken, data.expiresIn);
    return data;
  },
  logout: async () => {
    try {
      await post('/api/auth/logout');
    } finally {
      session.clear();
    }
  },
  forgotPassword: (email) => post('/api/auth/forgot-password', { email }),
  resetPassword: (token, newPassword) => post('/api/auth/reset-password', { token, newPassword }),
  resendVerification: () => post('/api/auth/resend-verification', undefined, { auth: true }),
  me: () => api('/api/auth/me', { auth: true }),
  updateProfile: (body) => api('/api/auth/me', { method: 'PATCH', body, auth: true }),
  changePassword: (currentPassword, newPassword) => post('/api/auth/me/password', { currentPassword, newPassword }, { auth: true }),
  changeEmail: (password, newEmail) => post('/api/auth/me/email', { password, newEmail }, { auth: true }),
  reauth: (password) => post('/api/auth/reauth', { password }, { auth: true }),
  twoFactorSetup: (fresh) => post('/api/auth/me/2fa/setup', undefined, { auth: true, headers: withFresh(fresh) }),
  twoFactorEnable: (fresh, code) => post('/api/auth/me/2fa/enable', { code }, { auth: true, headers: withFresh(fresh) }),
  twoFactorDisable: (fresh, password) => post('/api/auth/me/2fa/disable', { password }, { auth: true, headers: withFresh(fresh) }),
  sessions: () => api('/api/auth/me/sessions', { auth: true }),
  revokeSession: (fresh, id) => api(`/api/auth/me/sessions/${id}`, { method: 'DELETE', auth: true, headers: withFresh(fresh) }),
  revokeOtherSessions: (fresh) => api('/api/auth/me/sessions', { method: 'DELETE', auth: true, headers: withFresh(fresh) }),
  exportData: (fresh) => api('/api/auth/me/export', { auth: true, headers: withFresh(fresh) }),
  deleteAccount: (password) => api('/api/auth/me', { method: 'DELETE', body: { password }, auth: true }),
};

export const catalogApi = {
  products: ({ category, page = 1, pageSize = 9, featured, ids } = {}) => {
    const q = new URLSearchParams();
    if (category) q.set('category', category);
    if (featured) q.set('featured', 'true');
    if (ids?.length) q.set('ids', ids.join(','));
    q.set('page', String(page));
    q.set('pageSize', String(pageSize));
    return api(`/api/catalog/products?${q}`);
  },
  product: (idOrSlug) => api(`/api/catalog/products/${encodeURIComponent(idOrSlug)}`),
  categories: () => api('/api/catalog/categories'),
};

export const cartApi = {
  get: () => api('/api/cart/', { auth: 'optional' }),
  add: (productId, quantity = 1) => post('/api/cart/items', { productId, quantity }, { auth: 'optional' }),
  setQuantity: (productId, quantity) => api(`/api/cart/items/${productId}`, { method: 'PUT', body: { quantity }, auth: 'optional' }),
  remove: (productId) => api(`/api/cart/items/${productId}`, { method: 'DELETE', auth: 'optional' }),
  clear: () => api('/api/cart/', { method: 'DELETE', auth: 'optional' }),
  merge: () => post('/api/cart/merge', undefined, { auth: true }),
};

export const ordersApi = {
  create: (shippingAddress, note) => post('/api/orders/', { shippingAddress, note }, { auth: true }),
  mine: ({ page = 1, pageSize = 10 } = {}) => api(`/api/orders/me?page=${page}&pageSize=${pageSize}`, { auth: true }),
  get: (id) => api(`/api/orders/${id}`, { auth: true }),
};
