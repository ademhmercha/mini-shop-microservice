import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const useAuth = vi.hoisted(() => vi.fn());
vi.mock('../src/auth/AuthContext.jsx', () => ({ useAuth }));

const { RequireAuth } = await import('../src/auth/RequireAuth.jsx');

function Probe() {
  const loc = useLocation();
  return (
    <div>
      <p data-testid="path">{loc.pathname}</p>
      <p data-testid="search">{loc.search}</p>
      <p data-testid="from">{loc.state?.from ?? ''}</p>
    </div>
  );
}

const tree = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/connexion" element={<Probe />} />
        <Route path="/commande" element={<RequireAuth><h1>Page de commande</h1></RequireAuth>} />
        <Route path="/compte/securite" element={<RequireAuth><h1>Page sécurité</h1></RequireAuth>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => vi.clearAllMocks());

describe('routes protégées', () => {
  it('redirige un visiteur vers la connexion en mémorisant la page demandée', () => {
    useAuth.mockReturnValue({ status: 'anonymous', user: null });
    tree('/commande');
    expect(screen.queryByText('Page de commande')).not.toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/connexion');
    expect(screen.getByTestId('search')).toHaveTextContent('?retour=%2Fcommande');
    expect(screen.getByTestId('from')).toHaveTextContent('/commande');
  });

  it('conserve les paramètres de la page demandée', () => {
    useAuth.mockReturnValue({ status: 'anonymous', user: null });
    tree('/compte/securite?onglet=2fa');
    expect(screen.getByTestId('search')).toHaveTextContent(encodeURIComponent('/compte/securite?onglet=2fa'));
  });

  it('affiche la page protégée pour un utilisateur connecté', () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u' } });
    tree('/commande');
    expect(screen.getByRole('heading', { name: 'Page de commande' })).toBeInTheDocument();
  });

  it('attend la restauration de la session avant de décider (pas de redirection prématurée)', () => {
    useAuth.mockReturnValue({ status: 'loading', user: null });
    tree('/commande');
    expect(screen.getByText(/Vérification de votre session/)).toBeInTheDocument();
    expect(screen.queryByTestId('path')).not.toBeInTheDocument();
    expect(screen.queryByText('Page de commande')).not.toBeInTheDocument();
  });
});
