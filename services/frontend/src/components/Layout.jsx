import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ShoppingBag, UserRound } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useCart } from '../cart/CartContext.jsx';
import { GrainDefs } from '../illustrations/Ceramic.jsx';

function CartLink() {
  const { count } = useCart();
  return (
    <NavLink to="/panier" className="icon-link" aria-label={`Panier, ${count} article${count > 1 ? 's' : ''}`}>
      <ShoppingBag className="icon" aria-hidden="true" />
      <span className="icon-link__label">Panier</span>
      {/* key : relance l'animation à chaque changement du compteur (désactivée avec prefers-reduced-motion) */}
      <span key={count} className={`cart-count ${count > 0 ? 'cart-count--bump' : ''}`} aria-hidden="true">
        {count}
      </span>
    </NavLink>
  );
}

function Header() {
  const { status, user } = useAuth();
  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link to="/" className="brand" aria-label="Maison Argile, accueil">
          Maison <em>Argile</em>
        </Link>
        <nav className="site-nav" aria-label="Navigation principale">
          <NavLink to="/boutique" className="site-nav__link">
            Boutique
          </NavLink>
          <CartLink />
          {status === 'authenticated' ? (
            <NavLink to="/compte" className="icon-link">
              <UserRound className="icon" aria-hidden="true" />
              <span className="icon-link__label">{user.firstName || 'Mon compte'}</span>
            </NavLink>
          ) : (
            <NavLink to="/connexion" className="icon-link">
              <UserRound className="icon" aria-hidden="true" />
              <span className="icon-link__label">Connexion</span>
            </NavLink>
          )}
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="site-footer__grid">
          <div>
            <p className="brand" style={{ marginBottom: '0.75rem' }}>
              Maison <em>Argile</em>
            </p>
            <p>Céramique artisanale, tournée et émaillée à la main. Chaque pièce est unique ; les petites irrégularités sont signées.</p>
          </div>
          <div>
            <h2>La boutique</h2>
            <ul>
              <li><Link to="/boutique?categorie=bols">Bols</Link></li>
              <li><Link to="/boutique?categorie=tasses">Tasses</Link></li>
              <li><Link to="/boutique?categorie=vases">Vases</Link></li>
              <li><Link to="/boutique?categorie=theieres">Théières</Link></li>
            </ul>
          </div>
          <div>
            <h2>Commander</h2>
            <ul>
              <li>Paiement sur place, à la remise</li>
              <li><Link to="/compte/commandes">Suivre mes commandes</Link></li>
              <li><Link to="/compte">Mon compte</Link></li>
            </ul>
          </div>
        </div>
        <p className="site-footer__legal">© {new Date().getFullYear()} Maison Argile. Boutique de démonstration.</p>
      </div>
    </footer>
  );
}

export function Layout() {
  const { pathname } = useLocation();
  const { acknowledgeLogout } = useAuth();
  const main = useRef(null);
  const first = useRef(true);

  // À chaque changement de page : retour en haut et focus sur le contenu (utile aux lecteurs d'écran et au clavier).
  useEffect(() => {
    window.scrollTo(0, 0);
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.focus({ preventScroll: true });
    // Une fois revenu à l'accueil après une déconnexion volontaire, les routes protégées redemandent la connexion.
    acknowledgeLogout();
  }, [pathname, acknowledgeLogout]);

  return (
    <>
      <GrainDefs />
      <a className="skip-link" href="#contenu">Aller au contenu</a>
      <Header />
      <main id="contenu" ref={main} tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
    </>
  );
}
