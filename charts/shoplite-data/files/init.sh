#!/bin/sh
# ExÃ©cutÃ© une seule fois, Ã  la premiÃ¨re initialisation du volume PostgreSQL.
# Pour chaque service : une base dÃ©diÃ©e, un propriÃ©taire (migrations/DDL) et un utilisateur applicatif
# qui n'a que les droits DML accordÃ©s par les migrations (moindre privilÃ¨ge). Aucune base n'est partagÃ©e.
set -eu

create_service_db() {
  svc="$1"; owner_password="$2"; app_password="$3"

  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE ${svc}_owner LOGIN PASSWORD '${owner_password}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE ${svc}_app   LOGIN PASSWORD '${app_password}'   NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE ${svc}_db OWNER ${svc}_owner;
REVOKE ALL ON DATABASE ${svc}_db FROM PUBLIC;
GRANT CONNECT ON DATABASE ${svc}_db TO ${svc}_app;
SQL

  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${svc}_db" <<SQL
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO ${svc}_owner;
GRANT USAGE ON SCHEMA public TO ${svc}_app;
SQL
}

create_service_db auth    "$AUTH_DB_OWNER_PASSWORD"    "$AUTH_DB_APP_PASSWORD"
create_service_db catalog "$CATALOG_DB_OWNER_PASSWORD" "$CATALOG_DB_APP_PASSWORD"
create_service_db orders  "$ORDERS_DB_OWNER_PASSWORD"  "$ORDERS_DB_APP_PASSWORD"
