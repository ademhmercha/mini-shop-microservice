import { EmptyState, LinkButton } from '../components/ui.jsx';
import { useDocumentTitle } from '../lib/hooks.js';

export function NotFound({ message = 'Cette page n’existe pas ou a été déplacée.' }) {
  useDocumentTitle('Page introuvable');
  return (
    <div className="container page not-found">
      <EmptyState title="Introuvable" action={<LinkButton to="/">Retour à l’accueil</LinkButton>}>
        {message}
      </EmptyState>
    </div>
  );
}
