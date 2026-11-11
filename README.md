# ShopLite – Maison Argile

Boutique en ligne de céramique artisanale, en microservices, conçue pour être déployée plus tard sur un cluster Kubernetes (Ansible). Le paiement se fait **sur place** : il n'y a volontairement aucune passerelle de paiement.

## Aperçu

![Page d'accueil de la boutique Maison Argile : titre « Des objets de terre, faits pour durer » et illustration de céramiques](docs/images/boutique-accueil.png)

*Page d'accueil de Maison Argile, déployée sur le cluster Kubernetes et servie depuis un domaine sslip.io.*

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

![Page Panier : trois articles (tasse, théière, bol), récapitulatif de la commande à 264,00 € et bouton « Passer la commande »](docs/images/boutique-panier.png)

*Page Panier : le récapitulatif est calculé et la commande se règle sur place, sans paiement en ligne.*

## Déploiement sur Kubernetes (Azure)

L'application tourne sur un cluster Kubernetes (kubeadm) hébergé sur deux machines virtuelles Azure :

- **Infrastructure Azure** : Terraform crée dans [`infra/`](infra/README.md) le réseau, le pare-feu (NSG), un plan de contrôle (`cp-1`) et un nœud de travail (`worker-1`) Ubuntu 24.04 (`terraform init && terraform apply`).
- **Automatisation** : Ansible ([`ansible/`](ansible/README.md)) configure et durcit les machines, installe Kubernetes 1.36 avec containerd et Calico, puis la plateforme (Traefik et Gateway API, cert-manager et Let's Encrypt, metrics-server, stockage local-path, Prometheus et Grafana) et enfin l'application (`ansible-playbook playbooks/site.yml`).
- **Application** : deux charts Helm, [`charts/shoplite-data`](charts/shoplite-data/README.md) (PostgreSQL, Redis, Mailpit) et [`charts/shoplite`](charts/shoplite/README.md) (les cinq services), avec des images publiées par `scripts/build-push.sh`. Les secrets sont dans le coffre Ansible, jamais dans Git.

### Infrastructure Azure

![Portail Azure : groupe de ressources rg-shoplite contenant les machines cp-1 et worker-1, leurs disques, interfaces réseau et le groupe de sécurité nsg-shoplite](docs/images/azure-ressources.png)

*Le groupe de ressources `rg-shoplite`, créé par Terraform : machines virtuelles, disques, interfaces réseau et groupe de sécurité réseau (NSG).*

![Portail Azure : liste des machines virtuelles cp-1 et worker-1, taille Standard_B2als_v2, région Poland Central, état Running](docs/images/azure-machines.png)

*Les deux machines `cp-1` et `worker-1` (Standard_B2als_v2, Poland Central) sont en cours d'exécution, chacune avec une IP publique.*

![Portail Azure : règles du groupe de sécurité nsg-shoplite, avec SSH et l'API Kubernetes limités à une adresse, HTTP et HTTPS ouverts et un refus final de tout le reste](docs/images/azure-pare-feu.png)

*Pare-feu `nsg-shoplite` : SSH (22) et API Kubernetes (6443) limités à l'adresse de l'administrateur, HTTP/HTTPS ouverts à tous, trafic interne au sous-réseau autorisé et tout le reste refusé.*

### Automatisation (Ansible)

![Terminal : récapitulatif de la seconde exécution d'ansible-playbook site.yml, avec changed=0 et failed=0 pour cp-1, localhost et worker-1](docs/images/ansible-idempotence.png)

*Seconde exécution de `site.yml` : `changed=0` et `failed=0` sur toutes les cibles. Aucun changement, la configuration est idempotente.*

### Cluster Kubernetes

![Terminal : kubectl get nodes -o wide affiche cp-1 (control-plane) et worker-1 à l'état Ready, en version v1.36.6](docs/images/cluster-noeuds.png)

*Les deux nœuds, `cp-1` (plan de contrôle) et `worker-1`, sont `Ready` en Kubernetes v1.36.6 avec containerd 2.4.2.*

![Terminal : kubectl get pods -A liste tous les pods du cluster à l'état Running, sans redémarrage](docs/images/cluster-pods-tous.png)

*Tous les pods du cluster sont `Running` et sans redémarrage : système Kubernetes, Calico, cert-manager, Traefik, metrics-server, supervision et ShopLite.*

![Terminal : kubectl get pods,svc,pvc -n shoplite montre huit pods Running, huit Services ClusterIP et deux volumes persistants liés](docs/images/cluster-pods-shoplite.png)

*Namespace `shoplite` : huit pods `Running`, uniquement des Services `ClusterIP` (rien n'est exposé directement) et deux volumes persistants (PostgreSQL et Redis) liés par `local-path`.*

### Sécurité du déploiement

![Terminal : kubectl get namespace shoplite --show-labels affiche les étiquettes Pod Security enforce, audit et warn à la valeur restricted](docs/images/pod-security.png)

*Le namespace `shoplite` applique Pod Security Admission au niveau `restricted` (enforce, audit et warn) : tout pod non conforme est refusé.*

![Terminal : trois requêtes curl vers /api/catalog/metrics, /docs et /internal depuis Internet renvoient toutes 404](docs/images/endpoints-bloques.png)

*Depuis Internet, `/metrics`, `/docs` et `/internal` du service catalogue répondent 404 : Nginx bloque les endpoints techniques.*

### Supervision

Grafana n'est pas exposé sur Internet : accès par `kubectl port-forward` (voir [`ansible/README.md`](ansible/README.md)).

<table>
  <tr>
    <td width="50%"><img src="docs/images/grafana-shoplite.png" alt="Tableau de bord Grafana ShopLite : requêtes par seconde, durée p95 par service et connexions réussies ou échouées du service auth" width="100%"></td>
    <td width="50%"><img src="docs/images/grafana-cluster.png" alt="Tableau de bord Grafana Kubernetes / Compute Resources / Cluster : utilisation CPU et mémoire par namespace" width="100%"></td>
  </tr>
  <tr>
    <td><em>Tableau de bord ShopLite (méthode RED) : requêtes par seconde, durée p95 et connexions du service auth. Le panneau « Taux d'erreurs 5xx » affiche « No data » : aucune erreur 5xx observée.</em></td>
    <td><em>Tableau de bord Kubernetes / Compute Resources / Cluster : utilisation CPU et mémoire du cluster, par namespace.</em></td>
  </tr>
</table>

Voir aussi [SECURITY.md](SECURITY.md).
