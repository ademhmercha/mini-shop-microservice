import { useCallback, useState } from 'react';
import { Download } from 'lucide-react';
import { authApi, ordersApi } from '../../api/endpoints.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { clearFreshToken, useReauth } from '../../auth/useReauth.jsx';
import { PasswordField } from '../../components/Field.jsx';
import { Alert, Button } from '../../components/ui.jsx';
import { describeError, useDocumentTitle } from '../../lib/hooks.js';
import { useForm } from '../../lib/useForm.js';

function ExportData() {
  const { withFresh, dialog } = useReauth();
  const [state, setState] = useState({ busy: false, error: null, done: false });

  const run = async () => {
    setState({ busy: true, error: null, done: false });
    try {
      const account = await withFresh((fresh) => authApi.exportData(fresh));
      // Les commandes vivent dans un autre service : elles sont ajoutées à l'export côté navigateur.
      const orders = [];
      for (let page = 1; page <= 20; page += 1) {
        const res = await ordersApi.mine({ page, pageSize: 50 });
        orders.push(...res.items);
        if (page >= res.totalPages) break;
      }
      const blob = new Blob([JSON.stringify({ ...account, orders }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: 'mes-donnees-maison-argile.json' });
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setState({ busy: false, error: null, done: true });
    } catch (error) {
      setState({ busy: false, error: error.name === 'AbortError' ? null : error, done: false });
    }
  };

  return (
    <section className="panel" aria-labelledby="export-title">
      {dialog}
      <h2 id="export-title" style={{ fontSize: '1.5rem' }}>Exporter mes données</h2>
      <p className="panel__intro">Téléchargez un fichier JSON contenant vos informations de compte, vos sessions, l’historique de sécurité et vos commandes (droit à la portabilité).</p>
      {state.error && <div style={{ marginBottom: '1rem' }}><Alert kind="error"><p>{describeError(state.error)}</p></Alert></div>}
      {state.done && <div style={{ marginBottom: '1rem' }}><Alert kind="success"><p>Votre export a été téléchargé.</p></Alert></div>}
      <Button variant="secondary" onClick={run} loading={state.busy} loadingLabel="Préparation de l’export…">
        <Download className="icon icon--sm" aria-hidden="true" /> Télécharger mes données
      </Button>
    </section>
  );
}

function DeleteAccount() {
  const { markAnonymous } = useAuth();
  const validate = useCallback((v) => ({
    password: v.password ? '' : 'Saisissez votre mot de passe pour confirmer.',
    confirm: v.confirm ? '' : 'Cochez la case pour confirmer la suppression.',
  }), []);
  const form = useForm({ initial: { password: '', confirm: false }, validate });
  const submit = form.handleSubmit(async ({ password }) => {
    await authApi.deleteAccount(password);
    clearFreshToken();
    markAnonymous(); // la route protégée renvoie alors vers l'accueil
  });
  return (
    <section className="panel danger-zone" aria-labelledby="delete-title">
      <h2 id="delete-title" style={{ fontSize: '1.5rem' }}>Supprimer mon compte</h2>
      <p className="panel__intro">La suppression est définitive. Vos informations personnelles, sessions et panier sont effacés ; vos commandes passées sont conservées sans lien avec vous, pour la comptabilité.</p>
      <form className="form" onSubmit={submit} noValidate ref={form.formRef}>
        {form.formError && <Alert kind="error" title="Suppression impossible"><p>{describeError(form.formError)}</p></Alert>}
        <PasswordField label="Mot de passe" autoComplete="current-password" {...form.field('password')} />
        <div className="field">
          <label className="check">
            <input type="checkbox" name="confirm" checked={form.values.confirm} onChange={form.field('confirm').onChange} aria-describedby={form.field('confirm').error ? 'confirm-error' : undefined} />
            <span>Je comprends que cette action est irréversible.</span>
          </label>
          {form.field('confirm').error && <p className="field__error" id="confirm-error" role="alert">{form.field('confirm').error}</p>}
        </div>
        <div><Button type="submit" variant="danger" loading={form.submitting} loadingLabel="Suppression…">Supprimer définitivement mon compte</Button></div>
      </form>
    </section>
  );
}

export function PersonalData() {
  useDocumentTitle('Mes données');
  return (
    <>
      <ExportData />
      <DeleteAccount />
    </>
  );
}
