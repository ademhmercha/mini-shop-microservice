import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { authApi } from '../api/endpoints.js';
import { AuthLayout } from '../components/AuthLayout.jsx';
import { Field, PasswordField } from '../components/Field.jsx';
import { Alert, Button } from '../components/ui.jsx';
import { emailError, passwordError } from '../lib/validators.js';
import { describeError, useDocumentTitle } from '../lib/hooks.js';
import { useForm } from '../lib/useForm.js';

const validate = (v) => ({ email: emailError(v.email), password: passwordError(v.password, v.email) });

export function Register() {
  useDocumentTitle('Créer un compte');
  const [sentTo, setSentTo] = useState(null);
  const stableValidate = useCallback(validate, []);
  const form = useForm({ initial: { email: '', password: '' }, validate: stableValidate });

  const submit = form.handleSubmit(async ({ email, password }) => {
    await authApi.register(email.trim(), password);
    setSentTo(email.trim());
  });

  if (sentTo) {
    return (
      <AuthLayout variant="b">
        <p className="eyebrow">Presque terminé</p>
        <h1>Vérifiez votre <em>boîte mail</em></h1>
        <Alert kind="success" title="Demande enregistrée">
          <p>Si l’adresse <strong>{sentTo}</strong> est valide, un e-mail contenant un lien de confirmation vient de lui être envoyé. Le lien est valable 24 heures.</p>
        </Alert>
        <p className="auth__alt"><Mail className="icon icon--sm" aria-hidden="true" style={{ display: 'inline', verticalAlign: '-0.15em' }} /> Rien reçu après quelques minutes ? Regardez dans vos courriers indésirables, ou <button className="link-button" onClick={() => setSentTo(null)}>modifiez l’adresse</button>.</p>
        <p><Link to="/connexion">Aller à la connexion</Link></p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout variant="b">
      <p className="eyebrow">Nouveau compte</p>
      <h1>Rejoignez la <em>maison</em></h1>
      <p className="muted">Un compte vous permet de passer commande, de suivre vos achats et de retrouver votre panier partout.</p>
      <form className="form" onSubmit={submit} noValidate ref={form.formRef} style={{ marginTop: '2rem' }}>
        {form.formError && <Alert kind="error" title="Inscription impossible"><p>{describeError(form.formError)}</p></Alert>}
        <Field label="Adresse e-mail" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck="false" required {...form.field('email')} />
        <PasswordField label="Mot de passe" autoComplete="new-password" showStrength email={form.values.email} required {...form.field('password')} />
        <Button type="submit" loading={form.submitting} loadingLabel="Création du compte…" block>Créer mon compte</Button>
        <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>Votre mot de passe est haché avec Argon2id : nous ne pouvons jamais le lire.</p>
      </form>
      <p className="auth__alt">Déjà client ? <Link to="/connexion">Se connecter</Link></p>
    </AuthLayout>
  );
}
