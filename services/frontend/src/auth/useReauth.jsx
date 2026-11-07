import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { authApi } from '../api/endpoints.js';
import { PasswordField } from '../components/Field.jsx';
import { Alert, Button } from '../components/ui.jsx';
import { describeError } from '../lib/hooks.js';

// Jeton de confirmation récente, gardé en mémoire uniquement et valable moins que sa durée de vie serveur (5 min).
const cache = { token: null, at: 0 };
const FRESH_MS = 4 * 60 * 1000;

function ReauthDialog({ onConfirm, onCancel }) {
  const [password, setPassword] = useState('');
  const [state, setState] = useState({ busy: false, error: null });
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.querySelector('input')?.focus();
    const onKey = (e) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = async (e) => {
    e.preventDefault();
    if (!password) {
      setState({ busy: false, error: { message: 'Saisissez votre mot de passe.' } });
      return;
    }
    setState({ busy: true, error: null });
    try {
      await onConfirm(password);
    } catch (error) {
      setState({ busy: false, error });
    }
  };

  return (
    <div className="modal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal__box" role="dialog" aria-modal="true" aria-labelledby="reauth-title" ref={ref}>
        <h2 id="reauth-title" style={{ fontSize: '1.6rem' }}><ShieldCheck className="icon" aria-hidden="true" style={{ display: 'inline', verticalAlign: '-0.2em' }} /> Confirmez votre mot de passe</h2>
        <p className="muted">Cette action est sensible : nous vérifions que c’est bien vous.</p>
        <form className="form" onSubmit={submit} noValidate>
          {state.error && <Alert kind="error"><p>{describeError(state.error)}</p></Alert>}
          <PasswordField label="Mot de passe actuel" name="reauth-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="row">
            <Button type="submit" loading={state.busy} loadingLabel="Vérification…">Confirmer</Button>
            <Button type="button" variant="quiet" onClick={onCancel}>Annuler</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Confirmation récente du mot de passe pour les actions sensibles.
 * `withFresh(fn)` demande le mot de passe si nécessaire puis appelle fn(freshToken).
 */
export function useReauth() {
  const [pending, setPending] = useState(null);

  const ensureFresh = useCallback(
    () =>
      cache.token && Date.now() - cache.at < FRESH_MS
        ? Promise.resolve(cache.token)
        : new Promise((resolve, reject) => setPending({ resolve, reject })),
    [],
  );

  const withFresh = useCallback(
    async (fn) => {
      let token = await ensureFresh();
      try {
        return await fn(token);
      } catch (err) {
        if (err.code !== 'reauth_required') throw err;
        cache.token = null;
        token = await ensureFresh();
        return fn(token);
      }
    },
    [ensureFresh],
  );

  const onConfirm = async (password) => {
    const res = await authApi.reauth(password);
    cache.token = res.freshToken;
    cache.at = Date.now();
    pending.resolve(res.freshToken);
    setPending(null);
  };
  const onCancel = useCallback(() => {
    setPending((p) => {
      p?.reject(Object.assign(new Error('Action annulée.'), { name: 'AbortError' }));
      return null;
    });
  }, []);

  return { withFresh, dialog: pending ? <ReauthDialog onConfirm={onConfirm} onCancel={onCancel} /> : null };
}

export const clearFreshToken = () => {
  cache.token = null;
};
