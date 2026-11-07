import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ApiError } from '../src/api/http.js';

const authApi = vi.hoisted(() => ({ register: vi.fn(), forgotPassword: vi.fn(), resetPassword: vi.fn(), verifyEmail: vi.fn() }));
const useAuth = vi.hoisted(() => vi.fn());
vi.mock('../src/api/endpoints.js', () => ({ authApi }));
vi.mock('../src/auth/AuthContext.jsx', () => ({ useAuth }));

const { Register } = await import('../src/pages/Register.jsx');
const { Login } = await import('../src/pages/Login.jsx');
const { ForgotPassword, ResetPassword } = await import('../src/pages/PasswordReset.jsx');
const { VerifyEmail } = await import('../src/pages/VerifyEmail.jsx');
const { PasswordField } = await import('../src/components/Field.jsx');

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname}{loc.search}</p>;
}
const renderAt = (ui, path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      {ui}
      <Where />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ status: 'anonymous', user: null, login: vi.fn(), completeTwoFactor: vi.fn(), reloadUser: vi.fn() });
});

describe('formulaire d’inscription', () => {
  it('valide en direct, affiche l’indicateur de solidité et ne soumet rien tant que c’est invalide', async () => {
    const user = userEvent.setup();
    renderAt(<Register />);
    const email = screen.getByLabelText('Adresse e-mail');
    const pwd = screen.getByLabelText('Mot de passe');

    await user.type(email, 'pas-un-email');
    await user.tab();
    expect(await screen.findByText(/ne semble pas valide/)).toBeInTheDocument();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription(/ne semble pas valide/);

    await user.type(pwd, 'court');
    expect(screen.getByText(/Solidité : Trop faible/)).toBeInTheDocument();
    expect(screen.getByText(/Encore 7 caractères/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    expect(authApi.register).not.toHaveBeenCalled();
    await waitFor(() => expect(email).toHaveFocus()); // le focus va sur le premier champ en erreur
  });

  it('permet d’afficher et de masquer le mot de passe', async () => {
    const user = userEvent.setup();
    renderAt(<Register />);
    const pwd = screen.getByLabelText('Mot de passe');
    expect(pwd).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Afficher le mot de passe' }));
    expect(pwd).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Masquer le mot de passe' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('refuse un mot de passe contenant l’e-mail', async () => {
    const user = userEvent.setup();
    renderAt(<Register />);
    await user.type(screen.getByLabelText('Adresse e-mail'), 'camille.dupont@example.fr');
    await user.type(screen.getByLabelText('Mot de passe'), 'camille.dupont-2026!');
    expect(screen.getByText(/ne doit pas contenir votre adresse e-mail/)).toBeInTheDocument();
  });

  it('envoie l’inscription puis affiche un message générique (sans révéler si le compte existe)', async () => {
    const user = userEvent.setup();
    authApi.register.mockResolvedValue({ message: 'ok' });
    renderAt(<Register />);
    await user.type(screen.getByLabelText('Adresse e-mail'), ' camille@example.fr ');
    await user.type(screen.getByLabelText('Mot de passe'), 'Correct-Horse-Battery-9');
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    await waitFor(() => expect(authApi.register).toHaveBeenCalledWith('camille@example.fr', 'Correct-Horse-Battery-9'));
    expect(await screen.findByText(/Si l’adresse/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/boîte mail/);
  });

  it('conserve les valeurs saisies et affiche les erreurs du serveur sous les champs', async () => {
    const user = userEvent.setup();
    authApi.register.mockRejectedValue(new ApiError(400, { error: { code: 'validation_error', message: 'Certains champs sont invalides.', fields: { password: 'Ce mot de passe est trop courant. Choisissez-en un autre.' } } }));
    renderAt(<Register />);
    await user.type(screen.getByLabelText('Adresse e-mail'), 'camille@example.fr');
    await user.type(screen.getByLabelText('Mot de passe'), 'Correct-Horse-Battery-9');
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    expect(await screen.findByText(/trop courant/)).toBeInTheDocument();
    expect(screen.getByLabelText('Adresse e-mail')).toHaveValue('camille@example.fr');
    expect(screen.getByLabelText('Mot de passe')).toHaveValue('Correct-Horse-Battery-9');
    expect(screen.getByLabelText('Mot de passe')).toHaveAttribute('aria-invalid', 'true');
  });

  it('affiche une erreur réseau sans vider le formulaire', async () => {
    const user = userEvent.setup();
    authApi.register.mockRejectedValue(new ApiError(0, { error: { code: 'network_error', message: 'Connexion impossible. Vérifiez votre réseau et réessayez.' } }));
    renderAt(<Register />);
    await user.type(screen.getByLabelText('Adresse e-mail'), 'camille@example.fr');
    await user.type(screen.getByLabelText('Mot de passe'), 'Correct-Horse-Battery-9');
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Connexion impossible/);
    expect(screen.getByLabelText('Adresse e-mail')).toHaveValue('camille@example.fr');
  });
});

describe('formulaire de connexion', () => {
  it('exige e-mail et mot de passe', async () => {
    const user = userEvent.setup();
    renderAt(<Login />, '/connexion');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText('Saisissez votre adresse e-mail.')).toBeInTheDocument();
    expect(screen.getByText('Saisissez votre mot de passe.')).toBeInTheDocument();
  });

  it('affiche un message générique et conserve l’e-mail après un échec', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockRejectedValue(new ApiError(401, { error: { code: 'invalid_credentials', message: 'Adresse e-mail ou mot de passe incorrect.' } }));
    useAuth.mockReturnValue({ status: 'anonymous', login });
    renderAt(<Login />, '/connexion');
    await user.type(screen.getByLabelText('Adresse e-mail'), 'camille@example.fr');
    await user.type(screen.getByLabelText('Mot de passe'), 'mauvais-mot-de-passe');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText('Adresse e-mail ou mot de passe incorrect.')).toBeInTheDocument();
    expect(screen.getByLabelText('Adresse e-mail')).toHaveValue('camille@example.fr');
    expect(screen.getByLabelText('Mot de passe')).toHaveValue('mauvais-mot-de-passe');
  });

  it('indique le délai en cas de limitation de débit', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockRejectedValue(new ApiError(429, { error: { code: 'too_many_attempts', message: 'Trop de tentatives.' } }, 120));
    useAuth.mockReturnValue({ status: 'anonymous', login });
    renderAt(<Login />, '/connexion');
    await user.type(screen.getByLabelText('Adresse e-mail'), 'camille@example.fr');
    await user.type(screen.getByLabelText('Mot de passe'), 'xxxxxxxxxxxxx');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText(/Réessayez dans 2 minutes/)).toBeInTheDocument();
  });

  it('revient à la page demandée après la connexion', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockResolvedValue({ user: { id: 'u' } });
    useAuth.mockReturnValue({ status: 'anonymous', login });
    renderAt(<Routes><Route path="/connexion" element={<Login />} /><Route path="*" element={null} /></Routes>, '/connexion?retour=%2Fcommande');
    await user.type(screen.getByLabelText('Adresse e-mail'), 'camille@example.fr');
    await user.type(screen.getByLabelText('Mot de passe'), 'Correct-Horse-Battery-9');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/commande'));
  });

  it('ignore un paramètre de retour pointant vers un autre site', async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ status: 'anonymous', login: vi.fn().mockResolvedValue({ user: {} }) });
    renderAt(<Routes><Route path="/connexion" element={<Login />} /><Route path="*" element={null} /></Routes>, '/connexion?retour=https%3A%2F%2Fevil.example');
    await user.type(screen.getByLabelText('Adresse e-mail'), 'camille@example.fr');
    await user.type(screen.getByLabelText('Mot de passe'), 'Correct-Horse-Battery-9');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/compte'));
  });

  it('propose l’étape de double authentification quand elle est activée', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockResolvedValue({ twoFactorRequired: true, challengeToken: 'defi-123' });
    const completeTwoFactor = vi.fn().mockRejectedValueOnce(new ApiError(401, { error: { code: 'invalid_code', message: 'Code incorrect.' } })).mockResolvedValueOnce({ id: 'u' });
    useAuth.mockReturnValue({ status: 'anonymous', login, completeTwoFactor });
    renderAt(<Routes><Route path="/connexion" element={<Login />} /><Route path="*" element={null} /></Routes>, '/connexion?retour=%2Fcompte%2Fsecurite');
    await user.type(screen.getByLabelText('Adresse e-mail'), 'camille@example.fr');
    await user.type(screen.getByLabelText('Mot de passe'), 'Correct-Horse-Battery-9');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    const code = await screen.findByLabelText('Code de vérification');
    await user.type(code, '000000');
    await user.click(screen.getByRole('button', { name: /Valider/ }));
    expect(await screen.findByText('Code incorrect.')).toBeInTheDocument();
    expect(code).toHaveValue('000000'); // le code saisi n’est pas effacé

    await user.clear(code);
    await user.type(code, '123456');
    await user.click(screen.getByRole('button', { name: /Valider/ }));
    await waitFor(() => expect(completeTwoFactor).toHaveBeenLastCalledWith('defi-123', '123456'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/compte/securite'));
  });

  it('revient à la première étape quand le défi a expiré', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockResolvedValue({ twoFactorRequired: true, challengeToken: 'defi' });
    const completeTwoFactor = vi.fn().mockRejectedValue(new ApiError(401, { error: { code: 'challenge_invalid', message: 'Le défi a expiré. Reconnectez-vous.' } }));
    useAuth.mockReturnValue({ status: 'anonymous', login, completeTwoFactor });
    renderAt(<Login />, '/connexion');
    await user.type(screen.getByLabelText('Adresse e-mail'), 'camille@example.fr');
    await user.type(screen.getByLabelText('Mot de passe'), 'Correct-Horse-Battery-9');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    await user.type(await screen.findByLabelText('Code de vérification'), '123456');
    await user.click(screen.getByRole('button', { name: /Valider/ }));
    expect(await screen.findByText('Le défi a expiré. Reconnectez-vous.')).toBeInTheDocument();
    expect(screen.getByLabelText('Adresse e-mail')).toHaveValue('camille@example.fr');
  });
});

describe('mot de passe oublié et réinitialisation', () => {
  it('affiche la même confirmation quel que soit le compte', async () => {
    const user = userEvent.setup();
    authApi.forgotPassword.mockResolvedValue({ message: 'ok' });
    renderAt(<ForgotPassword />);
    await user.type(screen.getByLabelText('Adresse e-mail'), 'inconnu@example.fr');
    await user.click(screen.getByRole('button', { name: 'Envoyer le lien' }));
    expect(await screen.findByText(/Si un compte correspond à cette adresse/)).toBeInTheDocument();
  });

  it('refuse un mot de passe trop court et envoie le jeton du lien', async () => {
    const user = userEvent.setup();
    authApi.resetPassword.mockResolvedValue({ reset: true });
    renderAt(<ResetPassword />, '/reinitialiser-mot-de-passe?token=jeton-de-reinitialisation-123');
    await user.type(screen.getByLabelText('Nouveau mot de passe'), 'court');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }));
    expect(authApi.resetPassword).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('Nouveau mot de passe'));
    await user.type(screen.getByLabelText('Nouveau mot de passe'), 'Nouveau-Mot-De-Passe-2026');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }));
    await waitFor(() => expect(authApi.resetPassword).toHaveBeenCalledWith('jeton-de-reinitialisation-123', 'Nouveau-Mot-De-Passe-2026'));
    expect(await screen.findByText(/Toutes vos sessions ont été fermées/)).toBeInTheDocument();
  });

  it('signale un lien expiré ou déjà utilisé', async () => {
    const user = userEvent.setup();
    authApi.resetPassword.mockRejectedValue(new ApiError(400, { error: { code: 'invalid_token', message: 'Ce lien est invalide ou a expiré.' } }));
    renderAt(<ResetPassword />, '/reinitialiser-mot-de-passe?token=jeton-de-reinitialisation-123');
    await user.type(screen.getByLabelText('Nouveau mot de passe'), 'Nouveau-Mot-De-Passe-2026');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }));
    expect(await screen.findByText(/invalide ou a expiré/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Demander un nouveau lien' })).toBeInTheDocument();
  });

  it('refuse un lien sans jeton', () => {
    renderAt(<ResetPassword />, '/reinitialiser-mot-de-passe');
    expect(screen.getByText(/Ce lien de réinitialisation est invalide/)).toBeInTheDocument();
  });
});

describe('vérification de l’adresse e-mail', () => {
  it('confirme l’adresse avec le jeton du lien (une seule fois)', async () => {
    authApi.verifyEmail.mockResolvedValue({ verified: true, purpose: 'verify' });
    renderAt(<VerifyEmail />, '/verifier-email?token=jeton-unique-0001');
    expect(await screen.findByText(/Votre adresse e-mail est vérifiée/)).toBeInTheDocument();
    expect(authApi.verifyEmail).toHaveBeenCalledTimes(1);
  });
  it('explique un lien invalide ou absent', async () => {
    authApi.verifyEmail.mockRejectedValue(new ApiError(400, { error: { code: 'invalid_token', message: 'Ce lien est invalide ou a expiré.' } }));
    renderAt(<VerifyEmail />, '/verifier-email?token=jeton-unique-0002');
    expect(await screen.findByText(/a expiré ou a déjà été utilisé/)).toBeInTheDocument();
  });
  it('signale un lien incomplet', () => {
    renderAt(<VerifyEmail />, '/verifier-email');
    expect(screen.getByText(/Ce lien est incomplet/)).toBeInTheDocument();
  });
});

describe('champ mot de passe', () => {
  it('relie l’erreur au champ pour les technologies d’assistance', () => {
    render(<PasswordField label="Mot de passe" name="p" value="" onChange={() => {}} error="Trop court" />);
    const input = screen.getByLabelText('Mot de passe');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Trop court');
  });
});
