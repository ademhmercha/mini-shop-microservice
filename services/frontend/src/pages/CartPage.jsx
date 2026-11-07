import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, Minus, Plus, Trash2 } from 'lucide-react';
import { useCart } from '../cart/CartContext.jsx';
import { Illustration } from '../illustrations/Ceramic.jsx';
import { Alert, EmptyState, ErrorState, LinkButton, PageLoader } from '../components/ui.jsx';
import { describeError, useDocumentTitle } from '../lib/hooks.js';
import { formatPrice, plural } from '../lib/format.js';

export function CartPage() {
  useDocumentTitle('Mon panier');
  const cart = useCart();
  const [actionError, setActionError] = useState(null);

  const act = async (fn) => {
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err);
    }
  };

  if (cart.loading) return <PageLoader label="Chargement du panier…" />;
  if (cart.error && cart.lines.length === 0) return <div className="container page"><ErrorState error={cart.error} onRetry={cart.reload} title="Impossible d’afficher le panier" /></div>;

  if (cart.lines.length === 0) {
    return (
      <div className="container page">
        <EmptyState title="Votre panier est vide" action={<LinkButton to="/boutique">Parcourir la boutique</LinkButton>}>
          Les pièces que vous ajoutez apparaissent ici. Rien n’est réservé tant que la commande n’est pas validée.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="container page">
      <header className="page-head">
        <p className="eyebrow">Mon panier</p>
        <h1>Votre <em>sélection</em></h1>
      </header>
      {actionError && <Alert kind="error" title="La modification a échoué" style={{ marginBottom: '1.5rem' }}><p>{describeError(actionError)}</p></Alert>}
      <div className="cart-layout">
        <ul aria-label="Articles du panier">
          {cart.lines.map(({ product, quantity }) => (
            <li key={product.id} className="cart-line">
              <div className="cart-line__media">
                <Illustration name={product.illustration} tone={product.tone} />
              </div>
              <div>
                <h2 className="cart-line__name"><Link to={`/boutique/${product.slug}`}>{product.name}</Link></h2>
                <p className="muted" style={{ margin: 0 }}>{formatPrice(product.priceCents)} · {product.category.name}</p>
                <div className="cart-line__controls">
                  <div className="quantity" role="group" aria-label={`Quantité de ${product.name}`}>
                    <button type="button" aria-label={`Diminuer la quantité de ${product.name}`} disabled={quantity <= 1} onClick={() => act(() => cart.setQuantity(product.id, quantity - 1))}>
                      <Minus className="icon icon--sm" aria-hidden="true" />
                    </button>
                    <output>{quantity}</output>
                    <button type="button" aria-label={`Augmenter la quantité de ${product.name}`} disabled={quantity >= 20} onClick={() => act(() => cart.setQuantity(product.id, quantity + 1))}>
                      <Plus className="icon icon--sm" aria-hidden="true" />
                    </button>
                  </div>
                  <button type="button" className="link-button" onClick={() => act(() => cart.remove(product.id))}>
                    <Trash2 className="icon icon--sm" aria-hidden="true" style={{ display: 'inline', verticalAlign: '-0.15em' }} /> Retirer
                    <span className="sr-only"> {product.name} du panier</span>
                  </button>
                </div>
              </div>
              <p className="cart-line__total">{formatPrice(product.priceCents * quantity)}</p>
            </li>
          ))}
        </ul>

        <aside className="panel summary" aria-labelledby="summary-title">
          <h2 id="summary-title">Récapitulatif</h2>
          <div className="summary__row"><span>{plural(cart.count, 'pièce', 'pièces')}</span><span>{formatPrice(cart.totalCents)}</span></div>
          <div className="summary__row"><span>Retrait ou remise</span><span>Offert</span></div>
          <div className="summary__row summary__row--total"><span>Total</span><span>{formatPrice(cart.totalCents)}</span></div>
          <p className="summary__note"><Banknote className="icon" aria-hidden="true" /> Vous réglez sur place, à la remise de votre commande. Aucun paiement en ligne.</p>
          <LinkButton to="/commande" className="btn--block">Passer la commande</LinkButton>
          <p style={{ textAlign: 'center', margin: '1rem 0 0' }}><Link to="/boutique">Continuer mes achats</Link></p>
        </aside>
      </div>
    </div>
  );
}
