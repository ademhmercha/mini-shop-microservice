import { useCallback, useEffect, useState } from 'react';

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} – Maison Argile` : 'Maison Argile – Céramique artisanale';
  }, [title]);
}

/** Chargement de données avec états chargement / erreur / réessai, et annulation au démontage. */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [attempt, setAttempt] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    run()
      .then((data) => !cancelled && setState({ loading: false, error: null, data }))
      .catch((error) => !cancelled && setState({ loading: false, error, data: null }));
    return () => {
      cancelled = true;
    };
  }, [run, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

/** Message d'erreur lisible pour un formulaire (inclut le délai en cas de limitation de débit). */
export function describeError(err) {
  if (!err) return '';
  if (err.status === 429) {
    return err.retryAfter
      ? `Trop de tentatives. Réessayez dans ${err.retryAfter > 90 ? `${Math.ceil(err.retryAfter / 60)} minutes` : `${err.retryAfter} secondes`}.`
      : 'Trop de tentatives. Réessayez dans quelques instants.';
  }
  return err.message;
}
