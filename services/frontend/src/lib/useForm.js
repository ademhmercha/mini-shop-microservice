import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Formulaire contrôlé : validation en direct (après le premier passage dans le champ ou la première soumission),
 * erreurs serveur rattachées aux champs, et les valeurs saisies ne sont JAMAIS effacées en cas d'erreur.
 */
export function useForm({ initial, validate }) {
  const [values, setValues] = useState(initial);
  const [touched, setTouched] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const formRef = useRef(null);

  const errors = useMemo(() => validate(values), [validate, values]);

  const setValue = useCallback((name, value) => {
    setValues((v) => ({ ...v, [name]: value }));
    setServerErrors((s) => (s[name] ? { ...s, [name]: undefined } : s));
  }, []);

  const errorFor = (name) => {
    if (serverErrors[name]) return serverErrors[name];
    return touched[name] || submitted ? errors[name] || '' : '';
  };

  const field = (name) => ({
    name,
    value: values[name],
    error: errorFor(name),
    onChange: (e) => setValue(name, e.target.type === 'checkbox' ? e.target.checked : e.target.value),
    onBlur: () => setTouched((t) => ({ ...t, [name]: true })),
  });

  const handleSubmit = (action) => async (event) => {
    event?.preventDefault();
    setSubmitted(true);
    setFormError(null);
    const invalid = Object.keys(errors).find((k) => errors[k]);
    if (invalid) {
      requestAnimationFrame(() => formRef.current?.querySelector(`[name="${invalid}"]`)?.focus());
      return;
    }
    setSubmitting(true);
    try {
      await action(values);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      const mapped = {};
      for (const [path, message] of Object.entries(err?.fields ?? {})) mapped[path.split('.').pop()] = message;
      setServerErrors(mapped);
      setFormError(err);
      const first = Object.keys(mapped)[0];
      if (first) requestAnimationFrame(() => formRef.current?.querySelector(`[name="${first}"]`)?.focus());
    } finally {
      setSubmitting(false);
    }
  };

  const reset = (next = initial) => {
    setValues(next);
    setTouched({});
    setServerErrors({});
    setFormError(null);
    setSubmitted(false);
  };

  return { values, setValue, field, formRef, handleSubmit, submitting, formError, setFormError, reset };
}
