import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyBowl } from '../illustrations/Ceramic.jsx';

export function Spinner({ label = 'Chargement' }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Button({ loading = false, loadingLabel, children, className = '', variant, size, block, ...rest }) {
  const cls = ['btn', variant && `btn--${variant}`, size && `btn--${size}`, block && 'btn--block', className].filter(Boolean).join(' ');
  return (
    <button className={cls} disabled={loading || rest.disabled} aria-busy={loading || undefined} {...rest}>
      {loading && <span className="spinner" aria-hidden="true" />}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}

export function LinkButton({ to, children, variant, size, className = '', ...rest }) {
  const cls = ['btn', variant && `btn--${variant}`, size && `btn--${size}`, className].filter(Boolean).join(' ');
  return (
    <Link to={to} className={cls} {...rest}>
      {children}
    </Link>
  );
}

const ICONS = { error: CircleAlert, success: CircleCheck, info: Info };

export function Alert({ kind = 'info', title, children, ...rest }) {
  const Icon = ICONS[kind];
  return (
    <div className={`alert alert--${kind}`} role={kind === 'error' ? 'alert' : 'status'} {...rest}>
      <Icon className="icon" aria-hidden="true" />
      <div>
        {title && <p className="alert__title">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}

/** Message d'erreur d'API présentable, avec réessai lorsque c'est utile. */
export function ErrorState({ error, onRetry, title = 'Impossible de charger cette page' }) {
  const unavailable = error?.status === 503 || error?.status === 0 || error?.status === 502;
  return (
    <div className="state" role="alert">
      <h2>{unavailable ? 'Le service est momentanément indisponible' : title}</h2>
      <p>{error?.message ?? 'Une erreur est survenue.'}</p>
      {error?.requestId && <p className="muted mono">Référence : {error.requestId}</p>}
      {onRetry && (
        <button className="btn btn--secondary" onClick={onRetry}>
          Réessayer
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="state">
      <EmptyBowl className="state__art" />
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function PageLoader({ label = 'Chargement…' }) {
  return (
    <div className="state" aria-busy="true">
      <Spinner label={label} />
      <p>{label}</p>
    </div>
  );
}
