import { Link } from 'react-router-dom';
import { Illustration } from '../illustrations/Ceramic.jsx';
import { formatPrice } from '../lib/format.js';

export function ProductCard({ product, badge }) {
  return (
    <Link to={`/boutique/${product.slug}`} className="product-card">
      <div className="product-card__media">
        <Illustration name={product.illustration} tone={product.tone} />
        {badge && <span className="product-card__quick">{badge}</span>}
      </div>
      <div className="product-card__body">
        <div>
          <h3 className="product-card__name">{product.name}</h3>
          <p className="product-card__cat">{product.category.name}</p>
        </div>
        <span className="product-card__price">{formatPrice(product.priceCents)}</span>
      </div>
    </Link>
  );
}

export function ProductGridSkeleton({ count = 6 }) {
  return (
    <div className="grid-asym" aria-busy="true" aria-label="Chargement des produits">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="skeleton skeleton-card" />
          <div className="skeleton" style={{ height: '1.2rem', width: '60%', marginTop: '0.75rem' }} />
        </div>
      ))}
    </div>
  );
}
