import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../src/App.jsx';
import { session } from '../src/api/http.js';
import { clearFreshToken } from '../src/auth/useReauth.jsx';
import { Illustration, HeroArt, AuthArt, EmptyBowl, GrainDefs } from '../src/illustrations/Ceramic.jsx';
import { installFakeBackend, PRODUCTS } from './fakeBackend.js';

const PASSWORD = 'Correct-Horse-Battery-9';
let backend;

const open = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

beforeEach(() => {
  session.clear();
  clearFreshToken();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn() }, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

describe('navigation et catalogue', () => {
  it('affiche l’accueil éditorial avec la sélection et les catégories', async () => {
    backend = installFakeBackend();
    open('/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Des objets\s*de terre, faits\s*pour durer/);
    expect(await screen.findByRole('link', { name: /Théière Sérénade/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Bolss*2 pièces$/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Aller au contenu' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toBeInTheDocument();
  });

  it('filtre la boutique par catégorie', async () => {
    backend = installFakeBackend();
    const user = userEvent.setup();
    open('/boutique');
    expect(await screen.findByRole('link', { name: /Bol Fumée/ })).toBeInTheDocument();
    expect(screen.getByText(/3 pièces/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Théières/ }));
    await waitFor(() => expect(screen.queryByRole('link', { name: /Bol Fumée/ })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Théières');
    expect(screen.getByRole('button', { name: /Théières/ })).toHaveAttribute('aria-current', 'true');
  });

  it('affiche une erreur claire avec réessai quand le catalogue est indisponible', async () => {
    backend = installFakeBackend();
    backend.failProducts = true;
    const user = userEvent.setup();
    open('/boutique');
    expect(await screen.findByText('Le service est momentanément indisponible')).toBeInTheDocument();
    expect(screen.getByText(/Référence : req-test/)).toBeInTheDocument();
    backend.failProducts = false;
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('link', { name: /Bol Aube/ })).toBeInTheDocument();
  });

  it('affiche une page 404 pour une pièce ou une route inconnue', async () => {
    backend = installFakeBackend();
    open('/boutique/piece-inconnue');
    expect(await screen.findByText(/n’existe pas ou n’est plus disponible/)).toBeInTheDocument();
    const second = render(<MemoryRouter initialEntries={['/nimporte']}><App /></MemoryRouter>);
    expect(await within(second.container).findByRole('heading', { name: 'Introuvable' })).toBeInTheDocument();
  });
});

describe('panier invité', () => {
  it('ajoute une pièce, met à jour le compteur puis gère les quantités et le panier vide', async () => {
    backend = installFakeBackend();
    const user = userEvent.setup();
    open('/boutique/bol-aube');
    expect(await screen.findByRole('heading', { level: 1, name: 'Bol Aube' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Panier, 0 article' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Augmenter la quantité' }));
    await user.click(screen.getByRole('button', { name: 'Ajouter au panier' }));
    expect(await screen.findByText(/Ajouté au panier/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Panier, 2 articles' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Voir mon panier' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Bol Aube' })).toBeInTheDocument();
    expect(screen.getAllByText('48,00 €').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Augmenter la quantité de Bol Aube' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Panier, 3 articles' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Retirer/ }));
    expect(await screen.findByRole('heading', { name: 'Votre panier est vide' })).toBeInTheDocument();
  });
});

describe('parcours de commande', () => {
  it('redirige vers la connexion, revient à la commande et enregistre la commande', async () => {
    backend = installFakeBackend();
    const user = userEvent.setup();
    open('/boutique/theiere-serenade');
    await user.click(await screen.findByRole('button', { name: 'Ajouter au panier' }));
    await screen.findByText(/Ajouté au panier/);
    await user.click(screen.getByRole('link', { name: 'Voir mon panier' }));
    await user.click(await screen.findByRole('link', { name: 'Passer la commande' }));

    // visiteur : redirigé vers la connexion
    expect(await screen.findByRole('heading', { level: 1, name: /Content de vous revoir/ })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Adresse e-mail'), 'camille@example.fr');
    await user.type(screen.getByLabelText('Mot de passe'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    // retour automatique sur la page demandée, panier fusionné
    expect(await screen.findByRole('heading', { level: 1, name: /Où vous livrer/ })).toBeInTheDocument();
    expect(backend.calls.some((c) => c.path === '/api/cart/merge')).toBe(true);
    await user.click(screen.getByRole('button', { name: /Confirmer la commande/ }));
    expect(await screen.findByText('L’adresse est requis.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Adresse'), '12 rue des Potiers');
    await user.type(screen.getByLabelText('Code postal'), '69001');
    await user.type(screen.getByLabelText('Ville'), 'Lyon');
    await user.click(screen.getByRole('button', { name: /Confirmer la commande/ }));

    expect(await screen.findByRole('heading', { level: 1, name: /votre commande est enregistrée/ })).toBeInTheDocument();
    expect(screen.getAllByText('MA-000007').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/78,00 €/).length).toBeGreaterThan(0);
    // le navigateur n'envoie ni prix ni produit
    const post = backend.calls.find((c) => c.path === '/api/orders/' && c.method === 'POST');
    expect(Object.keys(post.body).sort()).toEqual(['note', 'shippingAddress']);
    expect(screen.getByRole('link', { name: 'Panier, 0 article' })).toBeInTheDocument();
  });

  it('garde le formulaire rempli et explique l’erreur quand un service est indisponible', async () => {
    backend = installFakeBackend({ loggedIn: true });
    backend.cart.set(PRODUCTS[0].id, 1);
    backend.failOrders = new Response(JSON.stringify({ error: { code: 'service_unavailable', message: 'Le service panier est momentanément indisponible. Réessayez dans un instant.', upstream: 'cart' } }), { status: 503, headers: { 'content-type': 'application/json' } });
    const user = userEvent.setup();
    open('/commande');
    await user.type(await screen.findByLabelText('Adresse'), '12 rue des Potiers');
    await user.type(screen.getByLabelText('Code postal'), '69001');
    await user.type(screen.getByLabelText('Ville'), 'Lyon');
    await user.click(screen.getByRole('button', { name: /Confirmer la commande/ }));
    expect(await screen.findByText('Service momentanément indisponible')).toBeInTheDocument();
    expect(screen.getByText(/Votre panier est conservé/)).toBeInTheDocument();
    expect(screen.getByLabelText('Adresse')).toHaveValue('12 rue des Potiers');
  });

  it('bloque la commande tant que l’e-mail n’est pas vérifié, et permet de renvoyer le lien', async () => {
    backend = installFakeBackend({ loggedIn: true, verified: false });
    backend.cart.set(PRODUCTS[0].id, 1);
    const user = userEvent.setup();
    open('/commande');
    expect(await screen.findByText(/Confirmez votre adresse e-mail pour commander/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmer la commande/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Renvoyer le lien/ }));
    expect(await screen.findByText(/Lien renvoyé/)).toBeInTheDocument();
  });

  it('affiche une commande vide si le panier est vide', async () => {
    backend = installFakeBackend({ loggedIn: true });
    open('/commande');
    expect(await screen.findByRole('heading', { name: 'Votre panier est vide' })).toBeInTheDocument();
  });

  it('refuse l’accès à la confirmation d’une commande inconnue', async () => {
    backend = installFakeBackend({ loggedIn: true });
    open('/commande/confirmation/99999999-9999-4999-8999-999999999999');
    expect(await screen.findByRole('heading', { name: 'Commande introuvable' })).toBeInTheDocument();
  });
});

describe('espace « Mon compte »', () => {
  it('redirige un visiteur vers la connexion', async () => {
    backend = installFakeBackend();
    open('/compte/securite');
    expect(await screen.findByRole('heading', { level: 1, name: /Content de vous revoir/ })).toBeInTheDocument();
  });

  it('met à jour les informations et l’adresse par défaut', async () => {
    backend = installFakeBackend({ loggedIn: true });
    const user = userEvent.setup();
    open('/compte');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Camille');
    expect(screen.getByText('Vérifiée')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Adresse'), '12 rue des Potiers');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Le code postal est requis.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Code postal'), '69001');
    await user.type(screen.getByLabelText('Ville'), 'Lyon');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Vos informations ont été enregistrées.')).toBeInTheDocument();
    expect(backend.user.shippingAddress).toMatchObject({ line1: '12 rue des Potiers', city: 'Lyon' });
  });

  it('change le mot de passe en conservant les saisies en cas d’erreur', async () => {
    backend = installFakeBackend({ loggedIn: true });
    const user = userEvent.setup();
    open('/compte/securite');
    await screen.findByRole('heading', { name: 'Mot de passe' });
    const inputs = () => ({ current: screen.getAllByLabelText('Mot de passe actuel')[0], next: screen.getByLabelText('Nouveau mot de passe') });
    await user.type(inputs().current, 'mauvais-mot-de-passe');
    await user.type(inputs().next, 'Nouveau-Mot-De-Passe-2026');
    await user.click(screen.getByRole('button', { name: 'Changer le mot de passe' }));
    expect(await screen.findByText('Mot de passe incorrect.')).toBeInTheDocument();
    expect(inputs().next).toHaveValue('Nouveau-Mot-De-Passe-2026');
    await user.clear(inputs().current);
    await user.type(inputs().current, PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Changer le mot de passe' }));
    expect(await screen.findByText('Vos autres appareils ont été déconnectés.')).toBeInTheDocument();
    expect(inputs().next).toHaveValue(''); // champs vidés seulement après un succès
  });

  it('demande la nouvelle adresse e-mail et affiche un message générique', async () => {
    backend = installFakeBackend({ loggedIn: true });
    const user = userEvent.setup();
    open('/compte/securite');
    await screen.findByRole('heading', { name: 'Adresse e-mail' });
    await user.type(screen.getByLabelText('Nouvelle adresse e-mail'), 'camille@example.fr');
    await user.click(screen.getByRole('button', { name: 'Changer l’adresse' }));
    expect(await screen.findByText('C’est déjà votre adresse actuelle.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Nouvelle adresse e-mail'));
    await user.type(screen.getByLabelText('Nouvelle adresse e-mail'), 'nouvelle@example.fr');
    await user.type(within(screen.getByRole('region', { name: 'Adresse e-mail' })).getByLabelText('Mot de passe'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Changer l’adresse' }));
    expect(await screen.findByText('Vérifiez votre boîte mail')).toBeInTheDocument();
  });

  it('active la double authentification après confirmation du mot de passe, puis la désactive', async () => {
    backend = installFakeBackend({ loggedIn: true });
    const user = userEvent.setup();
    open('/compte/securite');
    await user.click(await screen.findByRole('button', { name: /Activer la double authentification/ }));

    // confirmation récente du mot de passe demandée
    const dialog = await screen.findByRole('dialog', { name: /Confirmez votre mot de passe/ });
    await user.type(within(dialog).getByLabelText('Mot de passe actuel'), 'faux');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(await within(dialog).findByText('Mot de passe incorrect.')).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Mot de passe actuel'));
    await user.type(within(dialog).getByLabelText('Mot de passe actuel'), PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer' }));

    expect(await screen.findByAltText(/QR code/)).toBeInTheDocument();
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Code à 6 chiffres'), '000000');
    await user.click(screen.getByRole('button', { name: 'Activer' }));
    expect(await screen.findByText('Code incorrect.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Code à 6 chiffres'));
    await user.type(screen.getByLabelText('Code à 6 chiffres'), '123456');
    await user.click(screen.getByRole('button', { name: 'Activer' }));

    const codes = await screen.findByRole('list', { name: 'Codes de secours' });
    expect(within(codes).getAllByRole('listitem')).toHaveLength(10);
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(screen.getByRole('button', { name: /Copier/ }));
    expect(write).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Télécharger/ }));
    await user.click(screen.getByRole('button', { name: /J’ai conservé mes codes/ }));

    expect(await screen.findByText('Activée')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Désactiver…/ }));
    await user.type(screen.getAllByLabelText('Mot de passe').at(-1), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Désactiver la double authentification' }));
    expect(await screen.findByRole('button', { name: /Activer la double authentification/ })).toBeInTheDocument();
  });

  it('liste les sessions et déconnecte les autres appareils', async () => {
    backend = installFakeBackend({ loggedIn: true });
    const user = userEvent.setup();
    open('/compte/sessions');
    expect(await screen.findByText('Chrome sur Windows')).toBeInTheDocument();
    expect(screen.getByText('Cet appareil')).toBeInTheDocument();
    expect(screen.getAllByText(/Safari sur iOS/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /Déconnecter toutes les autres sessions/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Mot de passe actuel'), PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByText('Les autres sessions ont été déconnectées.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByText(/Safari sur iOS/)).toHaveLength(0));
  });

  it('peut annuler la confirmation du mot de passe avec Échap', async () => {
    backend = installFakeBackend({ loggedIn: true });
    const user = userEvent.setup();
    open('/compte/sessions');
    await user.click(await screen.findByRole('button', { name: /Déconnecter Safari sur iOS/ }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getAllByText(/Safari sur iOS/).length).toBeGreaterThan(0);
  });

  it('affiche l’historique des commandes', async () => {
    backend = installFakeBackend({ loggedIn: true });
    open('/compte/commandes');
    expect(await screen.findByRole('heading', { name: 'Aucune commande pour le moment' })).toBeInTheDocument();
    backend.orders.push({
      id: 'o1', reference: 'MA-000003', status: 'pending', paymentMethod: 'on_site', totalCents: 4800, currency: 'EUR', createdAt: '2026-11-03T10:00:00Z',
      items: [{ productId: 'p1', name: 'Bol Aube', unitPriceCents: 2400, quantity: 2, lineTotalCents: 4800 }],
    });
    render(<MemoryRouter initialEntries={['/compte/commandes']}><App /></MemoryRouter>);
    expect(await screen.findByRole('article', { name: 'Commande MA-000003' })).toBeInTheDocument();
    expect(screen.getByText('2 × Bol Aube')).toBeInTheDocument();
    expect(screen.getAllByText('À régler sur place').length).toBeGreaterThan(0);
  });

  it('exporte les données personnelles en JSON (confirmation récente requise)', async () => {
    backend = installFakeBackend({ loggedIn: true });
    const user = userEvent.setup();
    open('/compte/donnees');
    await user.click(await screen.findByRole('button', { name: /Télécharger mes données/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Mot de passe actuel'), PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByText('Votre export a été téléchargé.')).toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalled();
    const blob = URL.createObjectURL.mock.calls[0][0];
    const exported = JSON.parse(await blob.text());
    expect(exported.account.email).toBe('camille@example.fr');
    expect(exported.orders).toEqual([]);
  });

  it('supprime le compte après confirmation du mot de passe', async () => {
    backend = installFakeBackend({ loggedIn: true });
    const user = userEvent.setup();
    open('/compte/donnees');
    const submit = await screen.findByRole('button', { name: 'Supprimer définitivement mon compte' });
    await user.click(submit);
    expect(await screen.findByText('Saisissez votre mot de passe pour confirmer.')).toBeInTheDocument();
    expect(screen.getByText('Cochez la case pour confirmer la suppression.')).toBeInTheDocument();
    const field = screen.getAllByLabelText('Mot de passe').at(-1);
    await user.type(field, 'mauvais');
    await user.click(screen.getByRole('checkbox'));
    await user.click(submit);
    expect(await screen.findByText('Mot de passe incorrect.')).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, PASSWORD);
    await user.click(submit);
    expect(await screen.findByRole('heading', { level: 1, name: /Des objets/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connexion' })).toBeInTheDocument();
  });

  it('déconnecte l’utilisateur et retourne à l’accueil', async () => {
    backend = installFakeBackend({ loggedIn: true });
    const user = userEvent.setup();
    open('/compte');
    await user.click(await screen.findByRole('button', { name: /Se déconnecter/ }));
    expect(await screen.findByRole('heading', { level: 1, name: /Des objets/ })).toBeInTheDocument();
    expect(session.getToken()).toBeNull();
    expect(backend.calls.some((c) => c.path === '/api/auth/logout')).toBe(true);
  });
});

describe('illustrations', () => {
  it('génère une illustration SVG pour chaque produit, sans image externe', () => {
    const keys = ['bowl-aube', 'bowl-fumee', 'cup-sieste', 'cup-brume', 'cup-sillon', 'vase-lune', 'vase-souffle', 'vase-colline', 'plate-ecume', 'plate-mie', 'teapot-serenade', 'teapot-matin'];
    for (const tone of ['terracotta', 'sauge', 'creme', 'charbon']) {
      for (const key of keys) {
        const { container, unmount } = render(<><GrainDefs /><Illustration name={key} tone={tone} title={`${key} ${tone}`} /></>);
        expect(container.querySelector('svg[role="img"]')).toBeInTheDocument();
        expect(container.querySelectorAll('image, img')).toHaveLength(0);
        unmount();
      }
    }
    const { container } = render(<><HeroArt /><AuthArt /><AuthArt variant="b" /><EmptyBowl /><Illustration name="inconnu" tone="inconnu" /></>);
    expect(container.querySelectorAll('svg').length).toBe(5);
  });
});
