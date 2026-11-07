import { AuthArt } from '../illustrations/Ceramic.jsx';

/** Page d'authentification : une colonne de formulaire, une colonne d'illustration de céramique. */
export function AuthLayout({ children, variant = 'a', quote, author }) {
  return (
    <div className="auth">
      <section className="auth__form">
        <div className="auth__inner">{children}</div>
      </section>
      <aside className="auth__art" aria-hidden="true">
        <AuthArt variant={variant} />
        <blockquote className="auth__quote" style={{ margin: 0 }}>
          {quote ?? '« Une tasse bien faite change le premier geste de la journée. »'}
          <small>{author ?? 'Atelier Maison Argile, Lyon'}</small>
        </blockquote>
      </aside>
    </div>
  );
}
