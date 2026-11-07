import { useCallback, useState } from 'react';
import { Copy, Download, ShieldCheck } from 'lucide-react';
import { authApi } from '../../api/endpoints.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useReauth } from '../../auth/useReauth.jsx';
import { Field, PasswordField } from '../../components/Field.jsx';
import { Alert, Button } from '../../components/ui.jsx';
import { describeError, useDocumentTitle } from '../../lib/hooks.js';
import { emailError, passwordError } from '../../lib/validators.js';
import { useForm } from '../../lib/useForm.js';

function ChangePassword() {
  const { user } = useAuth();
  const [done, setDone] = useState(false);
  const validate = useCallback((v) => ({
    currentPassword: v.currentPassword ? '' : 'Saisissez votre mot de passe actuel.',
    newPassword: passwordError(v.newPassword, user.email) || (v.newPassword === v.currentPassword ? 'Le nouveau mot de passe doit être différent.' : ''),
  }), [user.email]);
  const form = useForm({ initial: { currentPassword: '', newPassword: '' }, validate });
  const submit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    setDone(false);
    await authApi.changePassword(currentPassword, newPassword);
    form.reset({ currentPassword: '', newPassword: '' });
    setDone(true);
  });
  return (
    <section className="panel" aria-labelledby="pwd-title">
      <h2 id="pwd-title" style={{ fontSize: '1.5rem' }}>Mot de passe</h2>
      <p className="panel__intro">Votre mot de passe actuel est demandé. Vos autres sessions seront déconnectées.</p>
      <form className="form" onSubmit={submit} noValidate ref={form.formRef}>
        {done && <Alert kind="success" title="Mot de passe modifié"><p>Vos autres appareils ont été déconnectés.</p></Alert>}
        {form.formError && <Alert kind="error" title="Modification impossible"><p>{describeError(form.formError)}</p></Alert>}
        <PasswordField label="Mot de passe actuel" autoComplete="current-password" {...form.field('currentPassword')} />
        <PasswordField label="Nouveau mot de passe" autoComplete="new-password" showStrength email={user.email} {...form.field('newPassword')} />
        <div><Button type="submit" loading={form.submitting} loadingLabel="Modification…">Changer le mot de passe</Button></div>
      </form>
    </section>
  );
}

function ChangeEmail() {
  const { user } = useAuth();
  const [sentTo, setSentTo] = useState(null);
  const validate = useCallback((v) => ({
    password: v.password ? '' : 'Saisissez votre mot de passe.',
    newEmail: emailError(v.newEmail) || (v.newEmail.trim().toLowerCase() === user.email.toLowerCase() ? 'C’est déjà votre adresse actuelle.' : ''),
  }), [user.email]);
  const form = useForm({ initial: { password: '', newEmail: '' }, validate });
  const submit = form.handleSubmit(async ({ password, newEmail }) => {
    await authApi.changeEmail(password, newEmail.trim());
    setSentTo(newEmail.trim());
    form.reset({ password: '', newEmail: '' });
  });
  return (
    <section className="panel" aria-labelledby="mail-title">
      <h2 id="mail-title" style={{ fontSize: '1.5rem' }}>Adresse e-mail</h2>
      <p className="panel__intro">Adresse actuelle : <strong>{user.email}</strong>. La nouvelle adresse ne remplacera l’ancienne qu’après avoir cliqué sur le lien qui lui sera envoyé.</p>
      <form className="form" onSubmit={submit} noValidate ref={form.formRef}>
        {sentTo && <Alert kind="success" title="Vérifiez votre boîte mail"><p>Si <strong>{sentTo}</strong> est disponible, un lien de confirmation vient d’y être envoyé. Votre adresse actuelle reste active jusque-là.</p></Alert>}
        {form.formError && <Alert kind="error" title="Changement impossible"><p>{describeError(form.formError)}</p></Alert>}
        <Field label="Nouvelle adresse e-mail" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck="false" {...form.field('newEmail')} />
        <PasswordField label="Mot de passe" autoComplete="current-password" {...form.field('password')} />
        <div><Button type="submit" loading={form.submitting} loadingLabel="Envoi…">Changer l’adresse</Button></div>
      </form>
    </section>
  );
}

function TwoFactor() {
  const { user, reloadUser } = useAuth();
  const { withFresh, dialog } = useReauth();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [backupCodes, setBackupCodes] = useState(null);
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState('');
  const [state, setState] = useState({ busy: false, error: null });

  const guard = async (fn) => {
    setState({ busy: true, error: null });
    try {
      await fn();
      setState({ busy: false, error: null });
    } catch (error) {
      setState({ busy: false, error: error.name === 'AbortError' ? null : error });
    }
  };

  const start = () => guard(async () => setSetup(await withFresh((fresh) => authApi.twoFactorSetup(fresh))));
  const enable = (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      setCodeError('Saisissez les 6 chiffres affichés par votre application.');
      return;
    }
    setCodeError('');
    guard(async () => {
      const res = await withFresh((fresh) => authApi.twoFactorEnable(fresh, code.trim()));
      setBackupCodes(res.backupCodes);
      setSetup(null);
      setCode('');
      await reloadUser();
    });
  };
  const disable = (e) => {
    e.preventDefault();
    guard(async () => {
      await withFresh((fresh) => authApi.twoFactorDisable(fresh, password));
      setDisabling(false);
      setPassword('');
      await reloadUser();
    });
  };
  const copy = () => navigator.clipboard?.writeText(backupCodes.join('\n'));
  const download = () => {
    const url = URL.createObjectURL(new Blob([`Codes de secours Maison Argile\n\n${backupCodes.join('\n')}\n`], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'codes-de-secours-maison-argile.txt' });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel" aria-labelledby="2fa-title">
      {dialog}
      <h2 id="2fa-title" style={{ fontSize: '1.5rem' }}>Double authentification</h2>
      <p className="panel__intro">Ajoutez un code à usage unique, généré par une application d’authentification, en plus de votre mot de passe.</p>
      {state.error && <div style={{ marginBottom: '1rem' }}><Alert kind="error"><p>{describeError(state.error)}</p></Alert></div>}

      {backupCodes && (
        <div className="stack">
          <Alert kind="success" title="Double authentification activée"><p>Conservez ces 10 codes de secours dans un endroit sûr. Chacun ne fonctionne qu’une fois, et ils ne seront <strong>plus jamais affichés</strong>.</p></Alert>
          <ul className="codes" aria-label="Codes de secours">{backupCodes.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="row">
            <Button variant="quiet" size="small" onClick={copy}><Copy className="icon icon--sm" aria-hidden="true" /> Copier</Button>
            <Button variant="quiet" size="small" onClick={download}><Download className="icon icon--sm" aria-hidden="true" /> Télécharger</Button>
            <Button size="small" onClick={() => setBackupCodes(null)}>J’ai conservé mes codes</Button>
          </div>
        </div>
      )}

      {!backupCodes && !user.twoFactorEnabled && !setup && (
        <Button onClick={start} loading={state.busy} loadingLabel="Préparation…"><ShieldCheck className="icon" aria-hidden="true" /> Activer la double authentification</Button>
      )}

      {setup && (
        <form className="stack" onSubmit={enable} noValidate>
          <ol className="stack" style={{ paddingLeft: '1.25rem', listStyle: 'decimal' }}>
            <li>Scannez ce QR code avec votre application d’authentification.</li>
            <li>Saisissez ensuite le code à 6 chiffres qu’elle affiche.</li>
          </ol>
          <div className="qr">
            <img src={setup.qrCode} alt="QR code à scanner avec votre application d’authentification" width="208" height="208" />
            <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>Impossible de scanner ? Saisissez cette clé : <span className="mono">{setup.secret}</span></p>
          </div>
          <Field label="Code à 6 chiffres" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} error={codeError} />
          <div className="row">
            <Button type="submit" loading={state.busy} loadingLabel="Vérification…">Activer</Button>
            <Button type="button" variant="quiet" onClick={() => { setSetup(null); setCode(''); }}>Annuler</Button>
          </div>
        </form>
      )}

      {!backupCodes && user.twoFactorEnabled && (
        <div className="stack">
          <p><span className="badge"><ShieldCheck className="icon icon--sm" aria-hidden="true" /> Activée</span></p>
          {!disabling ? (
            <div><Button variant="quiet" onClick={() => setDisabling(true)}>Désactiver…</Button></div>
          ) : (
            <form className="form" onSubmit={disable} noValidate>
              <PasswordField label="Mot de passe" name="disable-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <div className="row">
                <Button type="submit" variant="danger" loading={state.busy} loadingLabel="Désactivation…" disabled={!password}>Désactiver la double authentification</Button>
                <Button type="button" variant="quiet" onClick={() => { setDisabling(false); setPassword(''); }}>Annuler</Button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}

export function Security() {
  useDocumentTitle('Sécurité');
  return (
    <>
      <ChangePassword />
      <ChangeEmail />
      <TwoFactor />
    </>
  );
}
