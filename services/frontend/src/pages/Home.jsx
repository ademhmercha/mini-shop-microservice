import { Link } from 'react-router-dom';
import { ArrowRight, Flame, Hand, Leaf } from 'lucide-react';
import { catalogApi } from '../api/endpoints.js';
import { HeroArt } from '../illustrations/Ceramic.jsx';
import { LinkButton, ErrorState } from '../components/ui.jsx';
import { ProductCard, ProductGridSkeleton } from '../components/ProductCard.jsx';
import { useAsync, useDocumentTitle } from '../lib/hooks.js';

export function Home() {
  useDocumentTitle('');
  const featured = useAsync(() => catalogApi.products({ featured: true, pageSize: 6 }), []);
  const categories = useAsync(() => catalogApi.categories(), []);

  return (
    <div className="container">
      <section className="hero" aria-labelledby="hero-title">
        <div>
          <p className="eyebrow">Céramique artisanale · pièces uniques</p>
          <h1 id="hero-title" className="hero__title">
            <span>Des objets</span>
            <span>de terre, faits</span>
            <span>pour <em>durer.</em></span>
          </h1>
          <p className="lead hero__lead">
            Bols, tasses, vases, assiettes et théières, tournés et émaillés à la main dans notre atelier. Des formes calmes pour les gestes de tous les jours.
          </p>
          <div className="hero__actions">
            <LinkButton to="/boutique">
              Découvrir la boutique <ArrowRight className="icon" aria-hidden="true" />
            </LinkButton>
            <Link to="/boutique?categorie=theieres">Voir les théières</Link>
          </div>
        </div>
        <div className="hero__art">
          <HeroArt />
          <p className="hero__caption">Collection d’automne · grès émaillé</p>
        </div>
      </section>

      <section className="section" aria-labelledby="selection-title">
        <div className="section__head">
          <div>
            <p className="eyebrow">La sélection de l’atelier</p>
            <h2 id="selection-title">Six pièces <em>à adopter</em> cette saison</h2>
          </div>
          <Link to="/boutique">Toute la boutique</Link>
        </div>
        {featured.loading && <ProductGridSkeleton />}
        {featured.error && <ErrorState error={featured.error} onRetry={featured.retry} title="Impossible d’afficher la sélection" />}
        {featured.data && (
          <div className="grid-asym">
            {featured.data.items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>

      <section className="section atelier" aria-labelledby="atelier-title">
        <div>
          <p className="eyebrow">L’atelier</p>
          <h2 id="atelier-title">Le geste d’abord, <em>la forme</em> ensuite</h2>
          <p className="lead">Chaque pièce passe entre les mains d’un seul potier, du tournage à l’émaillage. Aucune n’est tout à fait identique à sa voisine.</p>
        </div>
        <ul className="atelier__list">
          <li className="atelier__item">
            <Hand className="icon" aria-hidden="true" />
            <div>
              <h3>Tourné à la main</h3>
              <p>Pas de moule : la terre prend sa forme sous la paume, et garde la trace des doigts.</p>
            </div>
          </li>
          <li className="atelier__item">
            <Flame className="icon" aria-hidden="true" />
            <div>
              <h3>Cuit à haute température</h3>
              <p>Une seconde cuisson à 1 240 °C rend le grès résistant au lave-vaisselle et au four.</p>
            </div>
          </li>
          <li className="atelier__item">
            <Leaf className="icon" aria-hidden="true" />
            <div>
              <h3>Émaux sans plomb</h3>
              <p>Cendre de bois, oxydes de fer et de cuivre : des couleurs de terre, sans colorants de synthèse.</p>
            </div>
          </li>
        </ul>
      </section>

      <section className="section" aria-labelledby="cat-title">
        <h2 id="cat-title" className="sr-only">Les catégories</h2>
        {categories.data && (
          <ul className="category-strip">
            {categories.data.items.map((c) => (
              <li key={c.id}>
                <Link to={`/boutique?categorie=${c.slug}`} className="category-tile">
                  <strong>{c.name}</strong>
                  <span>{c.productCount} pièce{c.productCount > 1 ? 's' : ''}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
