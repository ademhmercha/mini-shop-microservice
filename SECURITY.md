# Sécurité – modèle de menace et protections

## Actifs et attaquants

**À protéger** : identifiants et sessions des clients, secrets TOTP, données personnelles (adresse, historique), intégrité des prix et des commandes, clé privée de signature.
**Attaquants considérés** : visiteur anonyme malveillant (force brute, énumération, injection), site tiers qui cible un utilisateur connecté (CSRF), script injecté dans la page (XSS), voleur de jeton de rafraîchissement, utilisateur authentifié qui vise les données d'un autre, service compromis qui tente d'en atteindre un autre, fuite d'une base de données.
**Hors périmètre** : compromission de l'hôte ou de Docker, TLS (à terminer sur l'Ingress en production), déni de service volumétrique.

## Protections et justification

| Menace | Protection | Où |
|---|---|---|
| Fuite de la base : mots de passe | Argon2id (m=19 MiB, t=2, p=1, minimum OWASP), jamais stockés ni journalisés en clair | `auth/src/lib/passwords.js` |
| Mots de passe faibles | ≥ 12 caractères, liste locale de 10 000 mots de passe courants, refus des répétitions et de l'e-mail | idem |
| Vol de jeton d'accès | JWT EdDSA de 15 min, `kid`, audience/émetteur vérifiés, algorithme imposé (rejet de `none`/HS256) ; en mémoire du navigateur seulement | `auth/src/lib/jwt.js`, `frontend/src/api/http.js` |
| Compromission d'un service aval | Clé **privée** uniquement dans auth ; cart/orders vérifient via JWKS public. Rotation par `kid` | `gen-keys.mjs --rotate` |
| Vol du jeton de rafraîchissement | Opaque, 256 bits, haché (SHA-256) en base, cookie `HttpOnly; SameSite=Strict; Path=/api/auth`, rotation à chaque usage ; **réutilisation ⇒ révocation de la famille** | `authService.refresh` |
| CSRF | En-tête `X-Requested-With: shoplite` obligatoire + `Origin` strictement égal au site sur toutes les routes à cookie ; SameSite=Strict ; CORS limité à l'origine | `auth/routes.js`, `cart/routes.js` |
| Force brute | Limite par IP et par compte (Redis), délais croissants 1→30 s, verrouillage 15 min après 5 échecs, clés dérivées de l'e-mail saisi (même comportement si le compte n'existe pas) | `auth/src/lib/rateLimit.js` |
| Énumération de comptes | Réponses et messages identiques (inscription, connexion, « mot de passe oublié », changement d'e-mail) ; travail effectué après la réponse ; hachage factice pour égaliser les temps | `authService`, tests de sécurité |
| Rejeu des liens | Jetons e-mail/réinitialisation à usage unique, hachés, 24 h / 30 min ; réinitialisation ⇒ toutes les sessions révoquées | `email_tokens` |
| Actions sensibles | Jeton de « confirmation récente » (5 min) obtenu avec le mot de passe, lié à l'utilisateur et à la session ; mot de passe requis pour changer mot de passe/e-mail/supprimer | `/reauth`, `requireFresh` |
| 2FA | TOTP standard (`otplib`), secret chiffré AES-256-GCM au repos, 10 codes de secours hachés Argon2id et à usage unique, défi de connexion à usage unique | `authService`, `secretBox.js` |
| Injection SQL | Requêtes paramétrées uniquement ; entrées validées par Zod en mode strict (champs inconnus refusés) | tous les services |
| XSS / clickjacking | React (échappement), CSP stricte sans ressource externe (`script-src 'self'`), Helmet côté API, `X-Frame-Options: DENY`, polices et images locales | `nginx/default.conf.template` |
| Manipulation des prix | Le navigateur n'envoie jamais de prix : orders relit le panier et les prix dans le catalogue ; les prix sont figés dans la commande | `orders/routes.js` |
| Accès aux commandes d'autrui | Requêtes toujours filtrées par `user_id` du jeton ; 404 (et non 403) pour ne pas confirmer l'existence | `orders/routes.js` |
| Moindre privilège (données) | Une base et deux rôles par service ; `catalog_app` en lecture seule ; `orders_app` sans DELETE ; `auth_app` sans modification du journal d'audit | migrations, `infra/postgres/init.sh` |
| Services indisponibles | Délai d'attente strict (3 s), erreurs 503/502 claires, la commande reste enregistrée si le vidage du panier échoue | `orders/src/lib/upstream.js` |
| Fuite par les logs | pino avec masquage automatique (mots de passe, jetons, cookies, en-têtes) ; journal d'audit sans donnée sensible (liste blanche de métadonnées) ; erreurs 500 sans détail | `logger.js`, `audit.js` |
| Surface réseau | Seuls le site et Mailpit sont publiés (127.0.0.1) ; Nginx bloque `/metrics`, `/docs`, `/internal` ; appels internes protégés par jeton comparé en temps constant | compose, nginx |
| Conteneurs | Utilisateur non-root, système de fichiers en lecture seule, `cap_drop: ALL`, `no-new-privileges`, images minimales aux versions épinglées | Dockerfiles, compose |
| RGPD | Export JSON (compte, sessions, événements, commandes) ; suppression du compte avec mot de passe : données effacées, commandes anonymisées, panier supprimé | `/me/export`, `DELETE /me` |
| Chaîne d'approvisionnement | Versions exactes épinglées + lockfiles ; `npm audit --omit=dev` : 0 vulnérabilité ; aucune cryptographie maison (`@node-rs/argon2`, `jose`, `otplib`, `node:crypto`) | `package-lock.json` |

## Limites connues et pistes

- Le cookie `Secure` est désactivé dans le compose local (HTTP). En production : TLS à l'Ingress et `COOKIE_SECURE=true`.
- Les jetons d'accès déjà émis restent valides ≤ 15 min dans cart/orders après une révocation de session (auth, lui, vérifie la session en base à chaque appel).
- La clé privée est montée depuis un fichier local en développement ; en production, utiliser un Secret Kubernetes (mode 0440) ou un coffre-fort.
- Pas de protection anti-bot (CAPTCHA) ni de notification de connexion inhabituelle.
- Les journaux d'audit ne sont pas purgés automatiquement (politique de rétention à définir).

## Signaler une vulnérabilité

Projet de démonstration : ouvrez un ticket privé auprès du mainteneur plutôt qu'un ticket public.
