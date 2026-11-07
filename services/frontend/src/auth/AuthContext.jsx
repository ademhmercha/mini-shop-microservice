import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { authApi } from '../api/endpoints.js';
import { refreshSession, session } from '../api/http.js';

const AuthContext = createContext(null);
const RENEW_BEFORE_MS = 60_000;

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, reason: null });
  const timer = useRef(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  // Renouvellement silencieux : une minute avant l'expiration du jeton d'accès (gardé en mémoire uniquement).
  useEffect(() => {
    const off = session.onChange(({ token, expiresInSeconds }) => {
      clearTimer();
      if (!token) return;
      const delay = Math.max(5_000, expiresInSeconds * 1000 - RENEW_BEFORE_MS);
      timer.current = setTimeout(() => {
        refreshSession().catch((err) => {
          if (err.status === 401 || err.status === 403) setState({ status: 'anonymous', user: null, reason: 'expired' });
        });
      }, delay);
    });
    return () => {
      off();
      clearTimer();
    };
  }, []);

  // Restauration de session au chargement, grâce au cookie de rafraîchissement HttpOnly.
  useEffect(() => {
    let cancelled = false;
    refreshSession()
      .then((data) => !cancelled && setState({ status: 'authenticated', user: data.user, reason: null }))
      .catch(() => !cancelled && setState({ status: 'anonymous', user: null, reason: null }));
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const result = await authApi.login(email, password);
    if (result.twoFactorRequired) return { twoFactorRequired: true, challengeToken: result.challengeToken };
    setState({ status: 'authenticated', user: result.user, reason: null });
    return { user: result.user };
  }, []);

  const completeTwoFactor = useCallback(async (challengeToken, code) => {
    const result = await authApi.loginSecondFactor(challengeToken, code);
    setState({ status: 'authenticated', user: result.user, reason: null });
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      /* la session locale est de toute façon fermée */
    }
    setState({ status: 'anonymous', user: null, reason: 'logout' });
  }, []);

  const reloadUser = useCallback(async () => {
    const { user } = await authApi.me();
    setState({ status: 'authenticated', user, reason: null });
    return user;
  }, []);

  const markAnonymous = useCallback(() => {
    session.clear();
    setState({ status: 'anonymous', user: null, reason: 'logout' });
  }, []);

  // La déconnexion volontaire n'ajoute pas de redirection ultérieure vers la page d'accueil.
  const acknowledgeLogout = useCallback(() => setState((s) => (s.reason === 'logout' ? { ...s, reason: null } : s)), []);

  const value = useMemo(
    () => ({ ...state, login, completeTwoFactor, logout, reloadUser, markAnonymous, acknowledgeLogout }),
    [state, login, completeTwoFactor, logout, reloadUser, markAnonymous, acknowledgeLogout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}
