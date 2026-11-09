# Chart shoplite-data

PostgreSQL 17.11, Redis 7.4.12 et Mailpit 1.33.0 pour ShopLite (mêmes images que `docker-compose.yml`).

## Secrets requis (créés avant l'installation, jamais dans les valeurs)

| Secret | Clés |
|---|---|
| `postgres-credentials` (`postgres.existingSecret`) | `POSTGRES_PASSWORD`, `AUTH_DB_OWNER_PASSWORD`, `AUTH_DB_APP_PASSWORD`, `CATALOG_DB_OWNER_PASSWORD`, `CATALOG_DB_APP_PASSWORD`, `ORDERS_DB_OWNER_PASSWORD`, `ORDERS_DB_APP_PASSWORD` |
| `redis-credentials` (`redis.existingSecret`) | `REDIS_PASSWORD` |

Dans ce projet, Ansible les crée depuis le coffre (rôle `shoplite`).

## Contenu

- **PostgreSQL** : StatefulSet, volume persistant (classe par défaut, local-path). Le script
  `files/init.sh` est la copie de `infra/postgres/init.sh` : une base et deux rôles par service
  (`<svc>_owner` pour les migrations, `<svc>_app` en DML seulement). Il ne s'exécute qu'à la première
  initialisation du volume : changer un mot de passe dans le Secret ne change PAS le mot de passe du rôle existant.
- **Redis** : StatefulSet, mot de passe (`--requirepass`), AOF activé, volume persistant.
- **Mailpit** : Deployment interne (Service ClusterIP seulement). Interface :
  `kubectl -n shoplite port-forward svc/mailpit 8025:8025`. Messages en mémoire/éphémères.

## Sécurité

Les trois charges respectent Pod Security **restricted** : `runAsNonRoot`, utilisateurs fixes (postgres 70,
redis 999, mailpit 10001), `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `seccompProfile:
RuntimeDefault`, système de fichiers racine en lecture seule (emptyDir pour `/tmp` et `/var/run/postgresql`),
pas de jeton de ServiceAccount. Aucune exception nécessaire.

## Utilisation

```bash
helm lint charts/shoplite-data
helm upgrade --install shoplite-data charts/shoplite-data -n shoplite --wait
```
