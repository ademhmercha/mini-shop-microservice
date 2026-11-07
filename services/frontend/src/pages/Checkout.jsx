import { useCallback, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Banknote, CircleCheck, Mail } from 'lucide-react';
import { authApi, ordersApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useCart } from '../cart/CartContext.jsx';
import { Field, TextArea } from '../components/Field.jsx';
import { Alert, Button, EmptyState, ErrorState, LinkButton, PageLoader } from '../components/ui.jsx';
import { describeError, useAsync, useDocumentTitle } from '../lib/hooks.js';
import { formatDate, formatPrice, ORDER_STATUS } from '../lib/format.js';
import { requiredError } from '../lib/validators.js';
import { useForm } from '../lib/useForm.js';

const validate = (v) => ({
  line1: requiredError('L’adresse')(v.line1),
  postalCode: requiredError('Le code postal')(v.postalCode),
  city: requiredError('La ville')(v.city),
  country: requiredError('Le pays')(v.country),
  note: v.note.length > 300 ? 'Maximum 300 caractères.' : '',
});

function VerifyEmailNotice({ email }) {
  const [state, setState] = useState({ busy: false, sent: false, error: null });
  const resend = async () => {
    setState({ busy: true, sent: false, error: null });
    try {
      await authApi.resendVerification();
      setState({ busy: false, sent: true, error: null });
    } catch (error) {
      setState({ busy: false, sent: false, error });
    }
  };
  return (
    <Alert kind="info" title="Confirmez votre adresse e-mail pour commander">
      <p>Un lien de confirmation a été envoyé à <strong>{email}</strong>. Cliquez dessus, puis revenez à cette page.</p>
      <p style={{ marginTop: '0.75rem' }}>
        <Button variant="quiet" size="small" onClick={resend} loading={state.busy} loadingLabel="Envoi…">
          <Mail className="icon icon--sm" aria-hidden="true" /> Renvoyer le lien
        </Button>
      </p>
      {state.sent && <p role="status" style={{ marginTop: '0.5rem' }}>Lien renvoyé, vérifiez votre boîte mail.</p>}
      {state.error && <p role="alert" style={{ marginTop: '0.5rem' }}>{describeError(state.error)}</p>}
    </Alert>
  );
}

export function Checkout() {
  useDocumentTitle('Passer la commande');
  const { user, reloadUser } = useAuth();
  const cart = useCart();
  const navigate = useNavigate();
  const saved = user.shippingAddress ?? {};
  const stable = useCallback(validate, []);
  const form = useForm({
    initial: { line1: saved.line1 ?? '', line2: saved.line2 ?? '', postalCode: saved.postalCode ?? '', city: saved.city ?? '', country: saved.country ?? 'France', note: '' },
    validate: stable,
  });

  const submit = form.handleSubmit(async (v) => {
    const { note, ...address } = v;
    try {
      const { order } = await ordersApi.create({ ...address, line2: address.line2.trim() || undefined }, note.trim());
      cart.clearLocal();
      await cart.reload();
      navigate(`/commande/confirmation/${order.id}`, { replace: true, state: { order } });
    } catch (err) {
      // Le jeton a pu être émis avant la vérification de l'e-mail : on resynchronise le profil.
      if (err.code === 'email_not_verified') reloadUser().catch(() => {});
      throw err;
    }
  });

  if (cart.loading) return <PageLoader label="Préparation de la commande…" />;
  if (cart.lines.length === 0) {
    return (
      <div className="container page">
        <EmptyState title="Votre panier est vide" action={<LinkButton to="/boutique">Parcourir la boutique</LinkButton>}>
          Ajoutez des pièces à votre panier avant de passer commande.
        </EmptyState>
      </div>
    );
  }

  const err = form.formError;
  return (
    <div className="container page">
      <header className="page-head">
        <p className="eyebrow">Commande</p>
        <h1>Où vous <em>livrer</em> ?</h1>
      </header>
      <div className="cart-layout">
        <div>
          {!user.emailVerified && <div style={{ marginBottom: '1.5rem' }}><VerifyEmailNotice email={user.email} /></div>}
          <form className="form" onSubmit={submit} noValidate ref={form.formRef}>
            {err && (
              <Alert kind="error" title={err.code === 'product_unavailable' ? 'Un produit n’est plus disponible' : err.status === 503 ? 'Service momentanément indisponible' : 'La commande n’a pas pu être enregistrée'}>
                <p>{describeError(err)}</p>
                {err.code === 'product_unavailable' && <p><Link to="/panier">Revoir mon panier</Link></p>}
                {err.status === 503 && <p>Votre panier est conservé : réessayez dans un instant.</p>}
              </Alert>
            )}
            <Field label="Adresse" autoComplete="address-line1" required {...form.field('line1')} />
            <Field label="Complément d’adresse" autoComplete="address-line2" optional {...form.field('line2')} />
            <div className="field-row">
              <Field label="Code postal" autoComplete="postal-code" inputMode="numeric" required {...form.field('postalCode')} />
              <Field label="Ville" autoComplete="address-level2" required {...form.field('city')} />
            </div>
            <Field label="Pays" autoComplete="country-name" required {...form.field('country')} />
            <TextArea label="Note pour l’atelier" optional rows={3} maxLength={320} hint="Horaires de passage, étage, code d’entrée…" {...form.field('note')} />
            <Button type="submit" loading={form.submitting} loadingLabel="Enregistrement…" disabled={!user.emailVerified}>
              Confirmer la commande · {formatPrice(cart.totalCents)}
            </Button>
          </form>
        </div>
        <aside className="panel summary" aria-labelledby="recap-title">
          <h2 id="recap-title">Votre commande</h2>
          <ul>
            {cart.lines.map(({ product, quantity }) => (
              <li key={product.id} className="summary__row">
                <span>{quantity} × {product.name}</span>
                <span>{formatPrice(product.priceCents * quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="summary__row summary__row--total"><span>Total</span><span>{formatPrice(cart.totalCents)}</span></div>
          <p className="summary__note"><Banknote className="icon" aria-hidden="true" /> Règlement sur place, à la remise. Les prix sont confirmés par le catalogue au moment de la commande.</p>
        </aside>
      </div>
    </div>
  );
}

export function OrderConfirmation() {
  const { id } = useParams();
  const location = useLocation();
  useDocumentTitle('Commande confirmée');
  const fromState = location.state?.order?.id === id ? location.state.order : null;
  const { data, loading, error, retry } = useAsync(() => (fromState ? Promise.resolve({ order: fromState }) : ordersApi.get(id)), [id]);

  if (loading) return <PageLoader label="Chargement de la commande…" />;
  if (error?.status === 404) return <div className="container page"><EmptyState title="Commande introuvable" action={<LinkButton to="/compte/commandes">Mes commandes</LinkButton>}>Cette commande n’existe pas ou ne vous appartient pas.</EmptyState></div>;
  if (error) return <div className="container page"><ErrorState error={error} onRetry={retry} /></div>;
  const { order } = data;

  return (
    <div className="container page confirmation">
      <div className="confirmation__mark"><CircleCheck className="icon" aria-hidden="true" /></div>
      <p className="eyebrow">Commande {order.reference}</p>
      <h1>Merci, votre commande est <em>enregistrée</em></h1>
      <p className="lead">Nous préparons vos pièces avec soin. Vous réglerez <strong>{formatPrice(order.totalCents)}</strong> sur place, à la remise.</p>
      <section className="panel" aria-labelledby="detail-title" style={{ marginTop: '2rem' }}>
        <h2 id="detail-title" style={{ fontSize: '1.4rem' }}>Détail</h2>
        <dl className="meta" style={{ marginBottom: '1.5rem' }}>
          <dt>Référence</dt><dd className="mono">{order.reference}</dd>
          <dt>Date</dt><dd>{formatDate(order.createdAt)}</dd>
          <dt>Statut</dt><dd><span className="badge">{ORDER_STATUS[order.status] ?? order.status}</span></dd>
          <dt>Adresse</dt><dd>{[order.shippingAddress?.line1, order.shippingAddress?.line2, `${order.shippingAddress?.postalCode} ${order.shippingAddress?.city}`].filter(Boolean).join(', ')}</dd>
        </dl>
        <table className="table">
          <thead><tr><th scope="col">Pièce</th><th scope="col">Qté</th><th scope="col" style={{ textAlign: 'right' }}>Montant</th></tr></thead>
          <tbody>
            {order.items.map((i) => (
              <tr key={i.productId}><td>{i.name}</td><td>{i.quantity}</td><td style={{ textAlign: 'right' }}>{formatPrice(i.lineTotalCents)}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="summary__row summary__row--total"><span>Total à régler sur place</span><span>{formatPrice(order.totalCents)}</span></p>
      </section>
      <p className="row" style={{ marginTop: '2rem' }}>
        <LinkButton to="/compte/commandes" variant="secondary">Voir mes commandes</LinkButton>
        <LinkButton to="/boutique" variant="quiet">Continuer mes achats</LinkButton>
      </p>
    </div>
  );
}
