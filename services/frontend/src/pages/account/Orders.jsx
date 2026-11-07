import { useState } from 'react';
import { ordersApi } from '../../api/endpoints.js';
import { EmptyState, ErrorState, LinkButton, PageLoader } from '../../components/ui.jsx';
import { useAsync, useDocumentTitle } from '../../lib/hooks.js';
import { formatDate, formatPrice, ORDER_STATUS } from '../../lib/format.js';

export function Orders() {
  useDocumentTitle('Mes commandes');
  const [page, setPage] = useState(1);
  const { data, loading, error, retry } = useAsync(() => ordersApi.mine({ page, pageSize: 5 }), [page]);

  if (loading && !data) return <PageLoader label="Chargement de vos commandes…" />;
  if (error) return <ErrorState error={error} onRetry={retry} title="Impossible d’afficher vos commandes" />;
  if (data.total === 0) {
    return (
      <EmptyState title="Aucune commande pour le moment" action={<LinkButton to="/boutique">Découvrir la boutique</LinkButton>}>
        Vos commandes apparaîtront ici, avec leur statut.
      </EmptyState>
    );
  }
  return (
    <section aria-labelledby="orders-title">
      <h2 id="orders-title" className="sr-only">Mes commandes</h2>
      {data.items.map((o) => (
        <article key={o.id} className="order-card" aria-label={`Commande ${o.reference}`}>
          <div className="order-card__head">
            <h3 style={{ margin: 0 }}><span className="mono">{o.reference}</span> <span className="muted" style={{ fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}>· {formatDate(o.createdAt)}</span></h3>
            <span className="badge badge--neutral">{ORDER_STATUS[o.status] ?? o.status}</span>
          </div>
          <ul>
            {o.items.map((i) => (
              <li key={i.productId}><span>{i.quantity} × {i.name}</span><span>{formatPrice(i.lineTotalCents)}</span></li>
            ))}
          </ul>
          <p className="summary__row summary__row--total" style={{ fontSize: '1.2rem', marginBottom: 0 }}><span>Total à régler sur place</span><span>{formatPrice(o.totalCents)}</span></p>
        </article>
      ))}
      {data.totalPages > 1 && (
        <nav className="pagination" aria-label="Pagination des commandes">
          <button className="btn btn--quiet btn--small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédent</button>
          <span>Page {page} sur {data.totalPages}</span>
          <button className="btn btn--quiet btn--small" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Suivant</button>
        </nav>
      )}
    </section>
  );
}
