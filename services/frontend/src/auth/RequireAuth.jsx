import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { PageLoader } from '../components/ui.jsx';

/** Route protégée : redirige vers la connexion, qui renvoie ensuite vers la page demandée. */
export function RequireAuth({ children }) {
  const { status, reason } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageLoader label="Vérification de votre session…" />;
  // Déconnexion volontaire (ou suppression du compte) : retour à l'accueil, pas à la page de connexion.
  if (status !== 'authenticated' && reason === 'logout') return <Navigate to="/" replace />;
  if (status !== 'authenticated') {
    const from = `${location.pathname}${location.search}`;
    const expired = reason === 'expired' ? '&session=expiree' : '';
    return <Navigate to={`/connexion?retour=${encodeURIComponent(from)}${expired}`} replace state={{ from }} />;
  }
  return children;
}

/** Évite les redirections ouvertes : seuls les chemins internes sont acceptés. */
export function safeRedirect(target, fallback = '/compte') {
  if (typeof target !== 'string') return fallback;
  if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\')) return fallback;
  return target;
}
