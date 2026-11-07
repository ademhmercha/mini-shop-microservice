import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { cartApi, catalogApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const { status, user } = useAuth();
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const previousUser = useRef(null);

  /** Recharge le panier serveur puis récupère les fiches produit (le catalogue reste la source des prix). */
  const reload = useCallback(async () => {
    try {
      const cart = await cartApi.get();
      if (cart.items.length === 0) {
        setLines([]);
        setError(null);
        return;
      }
      const catalog = await catalogApi.products({ ids: cart.items.map((i) => i.productId), pageSize: 50 });
      const byId = new Map(catalog.items.map((p) => [p.id, p]));
      setLines(
        cart.items
          .filter((i) => byId.has(i.productId))
          .map((i) => ({ product: byId.get(i.productId), quantity: i.quantity })),
      );
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // À la connexion : le panier invité est fusionné dans le panier du compte, puis tout est rechargé.
  useEffect(() => {
    if (status === 'loading') return;
    const userId = user?.id ?? null;
    (async () => {
      if (userId && previousUser.current !== userId) {
        try {
          await cartApi.merge();
        } catch {
          /* la fusion sera retentée à la prochaine connexion */
        }
      }
      previousUser.current = userId;
      await reload();
    })();
  }, [status, user?.id, reload]);

  const run = useCallback(async (fn) => {
    setError(null);
    await fn();
    await reload();
  }, [reload]);

  const value = useMemo(() => {
    const count = lines.reduce((n, l) => n + l.quantity, 0);
    const totalCents = lines.reduce((n, l) => n + l.product.priceCents * l.quantity, 0);
    return {
      lines, count, totalCents, loading, error, reload,
      add: (productId, quantity = 1) => run(() => cartApi.add(productId, quantity)),
      setQuantity: (productId, quantity) => run(() => cartApi.setQuantity(productId, quantity)),
      remove: (productId) => run(() => cartApi.remove(productId)),
      clearLocal: () => setLines([]),
    };
  }, [lines, loading, error, reload, run]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart doit être utilisé dans <CartProvider>');
  return ctx;
}
