import { useCallback, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { safeRedirect } from '../auth/RequireAuth.jsx';
import { AuthLayout } from '../components/AuthLayout.jsx';
import { Field, PasswordField } from '../components/Field.jsx';
import { Alert, Button } from '../components/ui.jsx';
import { emailError } from '../lib/validators.js';
import { describeError, useDocumentTitle } from '../lib/hooks.js';
import { useForm } from '../lib/useForm.js';

const validateCredentials = (v) => ({
  email: emailError(v.email),
  password: v.password ? '' : 'Saisissez votre mot de passe.',
});
const validateCode = (v) => ({ code: v.code.trim().length >= 6 ? '' : 'Saisissez le code à 6 chiffres ou un code de secours.' });

export function Login() {
  useDocumentTitle('Connexion');
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [challenge, setChallenge] = useState(null);
  const target = safeRedirect(params.get('retour') ?? location.state?.from, '/compte');
  const expired = params.get('session') === 'expiree';

  const stableCredentials = useCallback(validateCredentials, []);
  const stableCode = useCallback(validateCode, []);
  const creds = useForm({ initial: { email: '', password: '' }, validate: stableCredentials });
  const second = useForm({ initial: { code: '' }, validate: stableCode });

  const submitCredentials = creds.handleSubmit(async ({ email, password }) => {
    const result = await auth.login(email.trim(), password);
    if (result.twoFactorRequired) setChallenge(result.challengeToken);
    else navigate(target, { replace: true });
  });

  const submitCode = second.handleSubmit(async ({ code }) => {
    try {
      await auth.completeTwoFactor(challenge, code.trim());
      navigate(target, { replace: true });
    } catch (err) {
      if (err.code === 'challenge_invalid') {
        // Le défi a expiré : retour à la première étape, l'e-mail saisi est conservé.
        setChallenge(null);
        second.reset({ code: '' });
        creds.setFormError(err);
        return;
      }
      throw err;
    }
  });

  if (challenge) {
    return (
      <AuthLayout>
        <p className="eyebrow">Double authentification</p>
        <h1>Un <em>second</em> facteur</h1>
        <p className="muted">Ouvrez votre application d’authentification et saisissez le code à 6 chiffres. Vous pouvez aussi utiliser l’un de vos codes de secours.</p>
        <form className="form" onSubmit={submitCode} noValidate ref={second.formRef} style={{ marginTop: '2rem' }}>
          {second.formError && <Alert kind="error" title="Code refusé"><p>{describeError(second.formError)}</p></Alert>}
          <Field label="Code de vérification" autoComplete="one-time-code" inputMode="text" autoCapitalize="none" spellCheck="false" autoFocus required {...second.field('code')} hint="Exemple : 123456, ou abcde-12345 pour un code de secours." />
          <Button type="submit" loading={second.submitting} loadingLabel="Vérification…" block>
            <ShieldCheck className="icon" aria-hidden="true" /> Valider
          </Button>
        </form>
        <p className="auth__alt"><button className="link-button" onClick={() => { setChallenge(null); second.reset({ code: '' }); }}>Retour à la connexion</button></p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <p className="eyebrow">Connexion</p>
      <h1>Content de <em>vous revoir</em></h1>
      <form className="form" onSubmit={submitCredentials} noValidate ref={creds.formRef} style={{ marginTop: '2rem' }}>
        {expired && !creds.formError && <Alert kind="info"><p>Votre session a expiré. Reconnectez-vous pour continuer.</p></Alert>}
        {creds.formError && <Alert kind="error" title="Connexion impossible"><p>{describeError(creds.formError)}</p></Alert>}
        <Field label="Adresse e-mail" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck="false" required {...creds.field('email')} />
        <PasswordField label="Mot de passe" autoComplete="current-password" required {...creds.field('password')} />
        <div className="auth__links"><Link to="/mot-de-passe-oublie">Mot de passe oublié ?</Link></div>
        <Button type="submit" loading={creds.submitting} loadingLabel="Connexion…" block>Se connecter</Button>
      </form>
      <p className="auth__alt">Nouveau ici ? <Link to="/inscription">Créer un compte</Link></p>
    </AuthLayout>
  );
}
