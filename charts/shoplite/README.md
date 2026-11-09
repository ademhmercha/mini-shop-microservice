# Chart shoplite

Déploie l'application : `frontend` (Nginx), `auth`, `catalog`, `cart`, `orders` (1 réplique chacun), une
HTTPRoute, des ServiceMonitor, un tableau de bord Grafana et les Jobs de migration.

## Prérequis

- Namespace avec Pod Security `restricted` (créé par Ansible) et chart `shoplite-data` installé.
- Gateway API : la Gateway `traefik/shoplite` (écouteur `https`) existe (phase 5A).
- Prometheus Operator (ServiceMonitor) et Grafana avec sidecar de tableaux de bord (kube-prometheus-stack).
- Images `ghcr.io/ademhmercha/shoplite-<service>:<tag>` accessibles (paquets publics).
- Secrets existants (valeurs : coffre Ansible) :

| Secret (`secrets.*`) | Clés |
|---|---|
| `shoplite-auth` (`auth`) | `DATABASE_URL`, `REDIS_URL`, `TOTP_ENCRYPTION_KEY`, `INTERNAL_API_TOKEN`, `jwt-private.pem` |
| `shoplite-auth-migrate` (`authMigrate`) | `MIGRATION_DATABASE_URL` |
| `shoplite-catalog` / `shoplite-catalog-migrate` | `DATABASE_URL` / `MIGRATION_DATABASE_URL` |
| `shoplite-cart` | `REDIS_URL`, `INTERNAL_API_TOKEN` |
| `shoplite-orders` / `shoplite-orders-migrate` | `DATABASE_URL`, `INTERNAL_API_TOKEN` / `MIGRATION_DATABASE_URL` |
| `shoplite-demo` | `DEMO_PASSWORD` |

## Valeurs principales

| Valeur | Rôle |
|---|---|
| `image.tag` (obligatoire) | commit Git court des images |
| `domain` (obligatoire) | domaine du site, `APP_ORIGIN=https://<domain>` |
| `services.<nom>.resources` | requests / limits |
| `seed.enabled` | compte de démonstration |
| `trustedProxyCidr` | CIDR des pods Traefik (adresse réelle du client dans Nginx) |

## Migrations

Jobs en hooks `pre-install` et `pre-upgrade`, dans l'ordre des poids : `migrate-auth` (-40), `migrate-catalog`
(-30), `migrate-orders` (-20), puis `seed-demo-account` (-10). Supprimés après succès.

## Sécurité

Chaque pod : `runAsNonRoot`, utilisateur numérique, `readOnlyRootFilesystem` (emptyDir pour `/tmp` et, pour
Nginx, `/etc/nginx/conf.d`), `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`,
`seccompProfile: RuntimeDefault`, `automountServiceAccountToken: false`. La clé privée des jetons n'est montée
que dans `auth`. Nginx bloque `/api/<service>/(metrics|docs|openapi.json|healthz|readyz|internal)` (404).

## Utilisation

```bash
helm lint charts/shoplite -f charts/shoplite/ci/lint-values.yaml
helm upgrade --install shoplite charts/shoplite -n shoplite --atomic --wait \
  --set image.tag=<commit> --set domain=<ip>.sslip.io
```
