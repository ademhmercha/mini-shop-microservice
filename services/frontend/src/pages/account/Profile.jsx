import { useCallback, useState } from 'react';
import { CircleCheck } from 'lucide-react';
import { authApi } from '../../api/endpoints.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Field } from '../../components/Field.jsx';
import { Alert, Button } from '../../components/ui.jsx';
import { describeError, useDocumentTitle } from '../../lib/hooks.js';
import { useForm } from '../../lib/useForm.js';

// L'adresse est facultative, mais si on commence à la remplir, elle doit être complète.
const validate = (v) => {
  const any = [v.line1, v.postalCode, v.city].some((x) => x.trim());
  return {
    firstName: v.firstName.length > 80 ? 'Maximum 80 caractères.' : '',
    lastName: v.lastName.length > 80 ? 'Maximum 80 caractères.' : '',
    line1: any && !v.line1.trim() ? 'L’adresse est requise.' : '',
    postalCode: any && !v.postalCode.trim() ? 'Le code postal est requis.' : '',
    city: any && !v.city.trim() ? 'La ville est requise.' : '',
  };
};

export function Profile() {
  useDocumentTitle('Mes informations');
  const { user, reloadUser } = useAuth();
  const [saved, setSaved] = useState(false);
  const a = user.shippingAddress ?? {};
  const stable = useCallback(validate, []);
  const form = useForm({
    initial: { firstName: user.firstName, lastName: user.lastName, line1: a.line1 ?? '', line2: a.line2 ?? '', postalCode: a.postalCode ?? '', city: a.city ?? '', country: a.country ?? 'France' },
    validate: stable,
  });

  const submit = form.handleSubmit(async (v) => {
    setSaved(false);
    const hasAddress = v.line1.trim() || v.postalCode.trim() || v.city.trim();
    await authApi.updateProfile({
      firstName: v.firstName.trim(),
      lastName: v.lastName.trim(),
      shippingAddress: hasAddress
        ? { line1: v.line1.trim(), line2: v.line2.trim(), postalCode: v.postalCode.trim(), city: v.city.trim(), country: v.country.trim() || 'France' }
        : null,
    });
    await reloadUser();
    setSaved(true);
  });

  return (
    <>
      <section className="panel" aria-labelledby="id-title">
        <h2 id="id-title" style={{ fontSize: '1.5rem' }}>Identifiant</h2>
        <dl className="meta">
          <dt>Adresse e-mail</dt>
          <dd>{user.email} {user.emailVerified ? <span className="badge"><CircleCheck className="icon icon--sm" aria-hidden="true" /> Vérifiée</span> : <span className="badge badge--accent">À vérifier</span>}</dd>
        </dl>
        <p className="muted" style={{ margin: '1rem 0 0', fontSize: '0.9rem' }}>Pour changer d’adresse, rendez-vous dans l’onglet Sécurité.</p>
      </section>

      <section className="panel" aria-labelledby="info-title">
        <h2 id="info-title" style={{ fontSize: '1.5rem' }}>Mes informations</h2>
        <p className="panel__intro">Ces informations pré-remplissent vos commandes. L’adresse de livraison par défaut est facultative.</p>
        <form className="form" onSubmit={submit} noValidate ref={form.formRef}>
          {saved && <Alert kind="success"><p>Vos informations ont été enregistrées.</p></Alert>}
          {form.formError && <Alert kind="error" title="Enregistrement impossible"><p>{describeError(form.formError)}</p></Alert>}
          <div className="field-row">
            <Field label="Prénom" autoComplete="given-name" {...form.field('firstName')} />
            <Field label="Nom" autoComplete="family-name" {...form.field('lastName')} />
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '1.5rem' }}>
            <legend className="field__label" style={{ marginBottom: '0.75rem' }}>Adresse de livraison par défaut</legend>
            <Field label="Adresse" autoComplete="address-line1" {...form.field('line1')} />
            <Field label="Complément" autoComplete="address-line2" optional {...form.field('line2')} />
            <div className="field-row">
              <Field label="Code postal" autoComplete="postal-code" inputMode="numeric" {...form.field('postalCode')} />
              <Field label="Ville" autoComplete="address-level2" {...form.field('city')} />
            </div>
            <Field label="Pays" autoComplete="country-name" {...form.field('country')} />
          </fieldset>
          <div><Button type="submit" loading={form.submitting} loadingLabel="Enregistrement…">Enregistrer</Button></div>
        </form>
      </section>
    </>
  );
}
