import { NavLink, Outlet } from 'react-router-dom';
import { Database, KeyRound, LogOut, Monitor, Package, User } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { clearFreshToken } from '../../auth/useReauth.jsx';
import { Button } from '../../components/ui.jsx';
import { useDocumentTitle } from '../../lib/hooks.js';

const links = [
  { to: '/compte', label: 'Informations', icon: User, end: true },
  { to: '/compte/securite', label: 'Sécurité', icon: KeyRound },
  { to: '/compte/sessions', label: 'Sessions', icon: Monitor },
  { to: '/compte/commandes', label: 'Commandes', icon: Package },
  { to: '/compte/donnees', label: 'Mes données', icon: Database },
];

export function Account() {
  useDocumentTitle('Mon compte');
  const { user, logout } = useAuth();
  const signOut = async () => {
    clearFreshToken();
    await logout(); // la route protégée renvoie alors vers l'accueil
  };
  return (
    <div className="container page">
      <header className="page-head">
        <p className="eyebrow">Mon compte</p>
        <h1>Bonjour{user.firstName ? <>, <em>{user.firstName}</em></> : ''}</h1>
      </header>
      <div className="account">
        <nav className="account__nav" aria-label="Espace client">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon className="icon" aria-hidden="true" /> {label}
            </NavLink>
          ))}
          <Button variant="quiet" size="small" onClick={signOut}>
            <LogOut className="icon icon--sm" aria-hidden="true" /> Se déconnecter
          </Button>
        </nav>
        <div>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
