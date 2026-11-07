import { useState } from 'react';
import { Laptop, Smartphone } from 'lucide-react';
import { authApi } from '../../api/endpoints.js';
import { useReauth } from '../../auth/useReauth.jsx';
import { Alert, Button, ErrorState, PageLoader } from '../../components/ui.jsx';
import { describeError, useAsync, useDocumentTitle } from '../../lib/hooks.js';
import { formatDateTime } from '../../lib/format.js';

export function Sessions() {
  useDocumentTitle('Sessions');
  const { data, loading, error, retry } = useAsync(() => authApi.sessions(), []);
  const { withFresh, dialog } = useReauth();
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const act = async (key, fn, message) => {
    setBusy(key);
    setNotice(null);
    try {
      await withFresh(fn);
      setNotice({ kind: 'success', message });
      retry();
    } catch (err) {
      if (err.name !== 'AbortError') setNotice({ kind: 'error', message: describeError(err) });
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) return <PageLoader label="Chargement des sessions…" />;
  if (error) return <ErrorState error={error} onRetry={retry} />;
  const others = data.sessions.filter((s) => !s.current).length;

  return (
    <section className="panel" aria-labelledby="sess-title">
      {dialog}
      <h2 id="sess-title" style={{ fontSize: '1.5rem' }}>Sessions actives</h2>
      <p className="panel__intro">Les appareils actuellement connectés à votre compte. Déconnectez ceux que vous ne reconnaissez pas.</p>
      {notice && <div style={{ marginBottom: '1rem' }}><Alert kind={notice.kind}><p>{notice.message}</p></Alert></div>}
      <ul aria-label="Sessions">
        {data.sessions.map((s) => {
          const mobile = /Android|iOS/.test(s.device);
          const Icon = mobile ? Smartphone : Laptop;
          return (
            <li key={s.id} className="session-item">
              <div>
                <p className="session-item__device" style={{ margin: 0 }}>
                  <Icon className="icon" aria-hidden="true" /> {s.device} {s.current && <span className="badge">Cet appareil</span>}
                </p>
                <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.88rem' }}>
                  Connecté le {formatDateTime(s.createdAt)} · dernière activité {formatDateTime(s.lastSeenAt)}{s.ip ? ` · IP ${s.ip}` : ''}
                </p>
              </div>
              {!s.current && (
                <Button variant="quiet" size="small" loading={busy === s.id} loadingLabel="Déconnexion…" onClick={() => act(s.id, (f) => authApi.revokeSession(f, s.id), 'Session déconnectée.')}>
                  Déconnecter <span className="sr-only">{s.device}</span>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {others > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <Button variant="secondary" loading={busy === 'others'} loadingLabel="Déconnexion…" onClick={() => act('others', (f) => authApi.revokeOtherSessions(f), 'Les autres sessions ont été déconnectées.')}>
            Déconnecter toutes les autres sessions
          </Button>
        </div>
      )}
    </section>
  );
}
