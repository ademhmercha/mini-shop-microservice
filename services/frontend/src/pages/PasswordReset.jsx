import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authApi } from '../api/endpoints.js';
import { AuthLayout } from '../components/AuthLayout.jsx';
import { Field, PasswordField } from '../components/Field.jsx';
import { Alert, Button, LinkButton } from '../components/ui.jsx';
import { emailError, passwordError } from '../lib/validators.js';
import { describeError, useDocumentTitle } from '../lib/hooks.js';
import { useForm } from '../lib/useForm.js';

const validateEmail = (v) => ({ email: emailError(v.email) });
const validatePassword = (v) => ({ newPassword: passwordError(v.newPassword) });

export function ForgotPassword() {
  useDocumentTitle('Mot de passe oublié');
  const [sent, setSent] = useState(false);
  const stable = useCallback(validateEmail, []);
  const form = useForm({ initial: { email: '' }, validate: stable });
  const submit = form.handleSubmit(async ({ email }) => {
    await authApi.forgotPassword(email.trim());
    setSent(true);
  });

  return (
    <AuthLayout variant="b" quote="« La terre pardonne beaucoup, sauf les mots de passe oubliés. »" author="Atelier Maison Argile">
      <p className="eyebrow">Mot de passe oublié</p>
      <h1>On vous <em>dépanne</em></h1>
      {sent ? (
        <>
          <Alert kind="success" title="Demande envoyée">
            <p>Si un compte correspond à cette adresse, un e-mail contenant un lien de réinitialisation vient d’être envoyé. Le lien est valable 30 minutes et ne sert qu’une fois.</p>
          </Alert>
          <p className="auth__alt"><Link to="/connexion">Retour à la connexion</Link></p>
        </>
      ) : (
        <>
          <p className="muted">Saisissez l’adresse e-mail de votre compte, nous vous enverrons un lien pour choisir un nouveau mot de passe.</p>
          <form className="form" onSubmit={submit} noValidate ref={form.formRef} style={{ marginTop: '2rem' }}>
            {form.formError && <Alert kind="error" title="Envoi impossible"><p>{describeError(form.formError)}</p></Alert>}
            <Field label="Adresse e-mail" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck="false" required {...form.field('email')} />
            <Button type="submit" loading={form.submitting} loadingLabel="Envoi…" block>Envoyer le lien</Button>
          </form>
          <p className="auth__alt"><Link to="/connexion">Retour à la connexion</Link></p>
        </>
      )}
    </AuthLayout>
  );
}

export function ResetPassword() {
  useDocumentTitle('Nouveau mot de passe');
  const [params] = useSearchParams();
  const token = params.get('token');
  const [done, setDone] = useState(false);
  const stable = useCallback(validatePassword, []);
  const form = useForm({ initial: { newPassword: '' }, validate: stable });
  const submit = form.handleSubmit(async ({ newPassword }) => {
    await authApi.resetPassword(token, newPassword);
    setDone(true);
  });

  return (
    <AuthLayout variant="b">
      <p className="eyebrow">Réinitialisation</p>
      <h1>Un <em>nouveau</em> départ</h1>
      {!token ? (
        <Alert kind="error" title="Lien incomplet"><p>Ce lien de réinitialisation est invalide. <Link to="/mot-de-passe-oublie">Demandez-en un nouveau</Link>.</p></Alert>
      ) : done ? (
        <>
          <Alert kind="success" title="Mot de passe modifié"><p>Toutes vos sessions ont été fermées par sécurité. Vous pouvez vous reconnecter.</p></Alert>
          <p style={{ marginTop: '2rem' }}><LinkButton to="/connexion">Me connecter</LinkButton></p>
        </>
      ) : (
        <form className="form" onSubmit={submit} noValidate ref={form.formRef} style={{ marginTop: '2rem' }}>
          {form.formError && (
            <Alert kind="error" title="Réinitialisation impossible">
              <p>{describeError(form.formError)} {form.formError.code === 'invalid_token' && <Link to="/mot-de-passe-oublie">Demander un nouveau lien</Link>}</p>
            </Alert>
          )}
          <PasswordField label="Nouveau mot de passe" autoComplete="new-password" showStrength required {...form.field('newPassword')} />
          <Button type="submit" loading={form.submitting} loadingLabel="Enregistrement…" block>Enregistrer le mot de passe</Button>
        </form>
      )}
    </AuthLayout>
  );
}
