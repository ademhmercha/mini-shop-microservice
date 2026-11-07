import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Banknote, CircleCheck, Hand, Minus, Package, Plus } from 'lucide-react';
import { catalogApi } from '../api/endpoints.js';
import { useCart } from '../cart/CartContext.jsx';
import { Illustration } from '../illustrations/Ceramic.jsx';
import { Alert, Button, ErrorState, PageLoader } from '../components/ui.jsx';
import { describeError, useAsync, useDocumentTitle } from '../lib/hooks.js';
import { formatPrice } from '../lib/format.js';
import { NotFound } from './NotFound.jsx';

export function ProductPage() {
  const { slug } = useParams();
  const { data: product, loading, error, retry } = useAsync(() => catalogApi.product(slug), [slug]);
  const cart = useCart();
  const [quantity, setQuantity] = useState(1);
  const [state, setState] = useState({ busy: false, added: false, error: null });
  useDocumentTitle(product?.name);

  if (loading) return <PageLoader label="Chargement de la pièce…" />;
  if (error?.status === 404) return <NotFound message="Cette pièce n’existe pas ou n’est plus disponible." />;
  if (error) return <ErrorState error={error} onRetry={retry} />;

  const add = async () => {
    setState({ busy: true, added: false, error: null });
    try {
      await cart.add(product.id, quantity);
      setState({ busy: false, added: true, error: null });
    } catch (err) {
      setState({ busy: false, added: false, error: err });
    }
  };

  return (
    <div className="container page">
      <nav className="breadcrumb" aria-label="Fil d’Ariane">
        <Link to="/boutique">Boutique</Link> /
        <Link to={`/boutique?categorie=${product.category.slug}`}>{product.category.name}</Link> /
        <span aria-current="page">{product.name}</span>
      </nav>
      <div className="product">
        <div className="product__media">
          <Illustration name={product.illustration} tone={product.tone} title={`${product.name}, ${product.category.name.toLowerCase()} en céramique`} />
        </div>
        <div>
          <p className="eyebrow">{product.category.name}</p>
          <h1 style={{ fontSize: 'clamp(2.4rem, 4.5vw, 4rem)' }}>{product.name}</h1>
          <p className="product__price">{formatPrice(product.priceCents)}</p>
          <p className="lead" style={{ color: 'var(--text)' }}>{product.description}</p>
          <p className="muted">{product.details}</p>

          <div className="product__buy">
            <div className="quantity" role="group" aria-label="Quantité">
              <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} disabled={quantity <= 1} aria-label="Diminuer la quantité">
                <Minus className="icon icon--sm" aria-hidden="true" />
              </button>
              <output aria-live="polite">{quantity}</output>
              <button type="button" onClick={() => setQuantity((q) => Math.min(20, q + 1))} disabled={quantity >= 20} aria-label="Augmenter la quantité">
                <Plus className="icon icon--sm" aria-hidden="true" />
              </button>
            </div>
            <Button onClick={add} loading={state.busy} loadingLabel="Ajout…">Ajouter au panier</Button>
          </div>

          <div aria-live="polite">
            {state.added && (
              <Alert kind="success">
                <p><CircleCheck className="icon icon--sm" aria-hidden="true" style={{ display: 'inline', verticalAlign: '-0.15em' }} /> Ajouté au panier. <Link to="/panier">Voir mon panier</Link></p>
              </Alert>
            )}
            {state.error && <Alert kind="error" title="L’ajout a échoué"><p>{describeError(state.error)}</p></Alert>}
          </div>

          <ul className="product__notes">
            <li><Hand className="icon" aria-hidden="true" /> Pièce tournée à la main : de légères variations de teinte et de forme sont normales.</li>
            <li><Banknote className="icon" aria-hidden="true" /> Règlement sur place, à la remise de votre commande.</li>
            <li><Package className="icon" aria-hidden="true" /> Emballée avec soin dans du papier kraft et de la laine de bois.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
