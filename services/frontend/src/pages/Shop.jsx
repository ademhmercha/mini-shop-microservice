import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { catalogApi } from '../api/endpoints.js';
import { EmptyState, ErrorState } from '../components/ui.jsx';
import { ProductCard, ProductGridSkeleton } from '../components/ProductCard.jsx';
import { useAsync, useDocumentTitle } from '../lib/hooks.js';

const PAGE_SIZE = 9;

export function Shop() {
  const [params, setParams] = useSearchParams();
  const category = params.get('categorie') || '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  useDocumentTitle('La boutique');

  const categories = useAsync(() => catalogApi.categories(), []);
  const products = useAsync(() => catalogApi.products({ category, page, pageSize: PAGE_SIZE }), [category, page]);
  const current = categories.data?.items.find((c) => c.slug === category);

  const select = (slug) => setParams(slug ? { categorie: slug } : {});
  const goto = (p) => setParams({ ...(category ? { categorie: category } : {}), page: String(p) });

  return (
    <div className="container page">
      <header className="page-head">
        <p className="eyebrow">La boutique</p>
        <h1>{current ? current.name : <>Toutes nos <em>pièces</em></>}</h1>
        <p className="lead">{current?.description ?? 'Des formes simples, des émaux de terre. Choisissez une famille ou parcourez tout l’atelier.'}</p>
      </header>

      <nav className="shop-filters" aria-label="Filtrer par catégorie">
        <div className="tabs">
          <button className="chip" aria-current={!category} onClick={() => select('')}>
            Tout
          </button>
          {categories.data?.items.map((c) => (
            <button key={c.id} className="chip" aria-current={category === c.slug} onClick={() => select(c.slug)}>
              {c.name} <span className="chip__count">{c.productCount}</span>
            </button>
          ))}
        </div>
        {products.data && (
          <p className="muted" role="status" aria-live="polite" style={{ margin: 0 }}>
            {products.data.total} pièce{products.data.total > 1 ? 's' : ''}
          </p>
        )}
      </nav>

      {products.loading && <ProductGridSkeleton count={6} />}
      {products.error && <ErrorState error={products.error} onRetry={products.retry} title="Impossible d’afficher la boutique" />}
      {products.data && products.data.items.length === 0 && (
        <EmptyState title="Rien dans cette famille pour le moment" action={<button className="btn btn--secondary" onClick={() => select('')}>Voir toute la boutique</button>}>
          L’atelier prépare de nouvelles pièces. Revenez bientôt.
        </EmptyState>
      )}
      {products.data && products.data.items.length > 0 && (
        <>
          <div className="grid-asym">
            {products.data.items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
          {products.data.totalPages > 1 && (
            <nav className="pagination" aria-label="Pagination">
              <button className="btn btn--quiet btn--small" disabled={page <= 1} onClick={() => goto(page - 1)}>
                <ChevronLeft className="icon icon--sm" aria-hidden="true" /> Précédent
              </button>
              <span aria-live="polite">Page {page} sur {products.data.totalPages}</span>
              <button className="btn btn--quiet btn--small" disabled={page >= products.data.totalPages} onClick={() => goto(page + 1)}>
                Suivant <ChevronRight className="icon icon--sm" aria-hidden="true" />
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
