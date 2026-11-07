# ShopLite – Maison Argile

Boutique en ligne de céramique artisanale, en microservices, conçue pour être déployée plus tard sur un cluster Kubernetes (Ansible). Le paiement se fait **sur place** : il n'y a volontairement aucune passerelle de paiement.

## Architecture

```
Navigateur ──► frontend (Nginx non-root, :8080) ──┬─ /api/auth/*    ► auth     :3001 ─► PostgreSQL auth_db, Redis (db 0), Mailpit
                                                  ├─ /api/catalog/* ► catalog  :3002 ─► PostgreSQL catalog_db
                                                  ├─ /api/cart/*    ► cart     :3003 ─► Redis (db 1)
                                                  └─ /api/orders/*  ► orders   :3004 ─► PostgreSQL orders_db ─► cart, catalog (HTTP)
```

| Service | Rôle | Stockage |
|---|---|---|
| `services/frontend` | React 19 + Vite, servi par `nginx-unprivileged` (8080) | – |
| `services/auth` | Comptes, sessions, profil, 2FA. **Seul émetteur de jetons** (JWT EdDSA, JWKS public) | PostgreSQL + Redis |
| `services/catalog` | Produits et catégories (lecture publique) | PostgreSQL (lecture seule) |
| `services/cart` | Panier invité (cookie) et panier du compte | Redis |
| `services/orders` | Commandes : relit panier et prix côté serveur | PostgreSQL |

Chaque service a **sa base et son utilisateur** (un propriétaire pour les migrations, un utilisateur applicatif aux droits minimaux). Les services vérifient les jetons avec la **clé publique** du JWKS d'auth et ne connaissent jamais la clé privée. Nginx retire le préfixe `/api/<service>` et bloque `/metrics`, `/docs`, `/healthz`, `/readyz` et `/internal` depuis l'extérieur.

## Lancement en local

Prérequis : Docker (Compose v2) et Node.js ≥ 20.19 (pour le script de clés).

```bash
node scripts/gen-keys.mjs        # crée .secrets/ et .env (ignorés par Git)
docker compose up --build        # construit et démarre tout
```

- Site : <http://localhost:8080>
- E-mails de test (Mailpit) : <http://localhost:8025>
- Compte de démonstration (vérifié, sans 2FA) : `demo@maison-argile.test` / `Argile-Demo-2026!`
- Pour créer un autre compte : inscription → ouvrir Mailpit → cliquer le lien de vérification.

Rotation de la clé de signature : `node scripts/gen-keys.mjs --rotate` puis `docker compose up -d auth` (l'ancienne clé publique reste publiée dans le JWKS, les jetons en cours restent valides ≤ 15 min).

> Port 8080 déjà utilisé sur votre machine ? Lancez par exemple `FRONTEND_PORT=18080 docker compose up --build` (PowerShell : `$env:FRONTEND_PORT=18080`) : le site, les cookies et le contrôle CSRF suivent ce port.

> En local le site est servi en HTTP : `COOKIE_SECURE=false` dans le compose. En production, laissez la valeur par défaut (`true`) derrière TLS.

## Tests

Chaque service expose `npm test`, `npm run test:coverage` et `npm run lint`.

```bash
cd services/auth && npm ci && npm test && npm run test:coverage && npm run lint     # idem catalog, cart, orders, frontend
npm audit --omit=dev                                                                 # dans chaque service
node scripts/e2e-inprocess.mjs   # parcours complet inter-services sans Docker (PGlite + ioredis-mock)
```

Les tests d'intégration utilisent PGlite (PostgreSQL en WebAssembly) et `ioredis-mock` : aucun Docker nécessaire pour les lancer. Le seuil de couverture (80 % des lignes) est appliqué dans `vitest.config.js`.

## Routes (derrière Nginx : préfixe `/api/<service>`)

**auth** (`/api/auth`) – documentation OpenAPI sur `/docs` du service
`POST /register` · `POST /verify-email` · `POST /resend-verification` · `POST /login` · `POST /login/2fa` · `POST /refresh` · `POST /logout` · `POST /forgot-password` · `POST /reset-password` · `POST /reauth`
`GET|PATCH|DELETE /me` · `POST /me/password` · `POST /me/email` · `POST /me/2fa/{setup,enable,disable}` · `GET /me/sessions` · `DELETE /me/sessions[/:id]` · `GET /me/export` · `GET /.well-known/jwks.json`

**catalog** (`/api/catalog`) : `GET /products?category=&page=&pageSize=&featured=&ids=` · `GET /products/:id|slug` · `GET /categories`

**cart** (`/api/cart`) : `GET /` · `POST /items` · `PUT|DELETE /items/:productId` · `DELETE /` · `POST /merge`

**orders** (`/api/orders`) : `POST /` · `GET /me` · `GET /:id`

**Tous les services** : `GET /healthz`, `GET /readyz` (503 si une dépendance manque), `GET /metrics` (Prometheus), `GET /docs` et `/openapi.json`.

## Conventions backend (prêtes pour Kubernetes)

- Configuration par variables d'environnement uniquement, validée par Zod au démarrage ; `.env.example` dans chaque service.
- Logs JSON (pino) avec `X-Request-Id` propagé et champs sensibles masqués.
- Arrêt propre sur SIGTERM ; migrations versionnées via `node src/migrate.js` (futur `Job`), avec `MIGRATION_DATABASE_URL`. La commande attend la base : jusqu'à 10 tentatives à délai croissant (1 s à 9 s, réglable par `MIGRATION_RETRY_ATTEMPTS` et `MIGRATION_RETRY_MAX_DELAY_MS`), chaque tentative est journalisée ; seules les erreurs de connexion sont réessayées (un mauvais mot de passe échoue immédiatement).
- Healthcheck PostgreSQL en TCP (`pg_isready -h 127.0.0.1`) : le serveur temporaire de l'initialisation n'écoute que sur le socket Unix et ne peut donc pas être pris pour le serveur définitif.
- Images multi-étapes, utilisateur non-root, `HEALTHCHECK`, pas de npm dans l'image finale.

## Design

Palette imposée en variables CSS (`src/styles/tokens.css`), Fraunces + Manrope installées localement (`@fontsource-variable`), illustrations SVG originales dans `src/illustrations/Ceramic.jsx`, icônes lucide. Un test calcule les contrastes WCAG AA à partir des variables réelles.
Note : l'accent terre cuite (#B5532F) n'atteint 4,5:1 que sur la surface des cartes et sous du texte blanc ; sur le fond principal il n'est donc utilisé en texte que pour les grands titres, et le vert sauge uniquement en aplats/bordures avec texte foncé.

Voir aussi [SECURITY.md](SECURITY.md).
