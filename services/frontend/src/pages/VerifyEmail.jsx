import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { AuthLayout } from '../components/AuthLayout.jsx';
import { Alert, LinkButton, Spinner } from '../components/ui.jsx';
import { useDocumentTitle } from '../lib/hooks.js';

// Le lien est à usage unique : en développement, React exécute les effets deux fois, on ne consomme donc le jeton qu'une fois.
const attempts = new Map();
const verifyOnce = (token) => {
  if (!attempts.has(token)) attempts.set(token, authApi.verifyEmail(token));
  return attempts.get(token);
};

export function VerifyEmail() {
  useDocumentTitle('Vérification de l’adresse e-mail');
  const [params] = useSearchParams();
  const token = params.get('token');
  const { status, reloadUser } = useAuth();
  const [state, setState] = useState(token ? { phase: 'loading' } : { phase: 'missing' });

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    verifyOnce(token)
      .then((res) => {
        if (cancelled) return;
        setState({ phase: 'done', purpose: res.purpose });
      })
      .catch((error) => !cancelled && setState({ phase: 'error', error }));
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (state.phase === 'done' && status === 'authenticated') reloadUser().catch(() => {});
  }, [state.phase, status, reloadUser]);

  return (
    <AuthLayout>
      <p className="eyebrow">Adresse e-mail</p>
      {state.phase === 'loading' && (
        <>
          <h1>Vérification <em>en cours</em></h1>
          <p className="muted"><Spinner label="Vérification" /> Un instant…</p>
        </>
      )}
      {state.phase === 'done' && (
        <>
          <h1>{state.purpose === 'change_email' ? <>Nouvelle adresse <em>confirmée</em></> : <>Adresse <em>confirmée</em></>}</h1>
          <Alert kind="success" title="C’est fait">
            <p>{state.purpose === 'change_email' ? 'Votre nouvelle adresse e-mail remplace désormais l’ancienne.' : 'Votre adresse e-mail est vérifiée : vous pouvez passer commande.'}</p>
          </Alert>
          <p style={{ marginTop: '2rem' }}>
            <LinkButton to={status === 'authenticated' ? '/boutique' : '/connexion'}>{status === 'authenticated' ? 'Continuer mes achats' : 'Me connecter'}</LinkButton>
          </p>
        </>
      )}
      {(state.phase === 'error' || state.phase === 'missing') && (
        <>
          <h1>Lien <em>invalide</em></h1>
          <Alert kind="error" title="Nous n’avons pas pu confirmer cette adresse">
            <p>{state.phase === 'missing' ? 'Ce lien est incomplet.' : 'Le lien a expiré ou a déjà été utilisé.'} Connectez-vous pour en recevoir un nouveau.</p>
          </Alert>
          <p className="auth__alt"><Link to="/connexion">Aller à la connexion</Link></p>
        </>
      )}
    </AuthLayout>
  );
}
