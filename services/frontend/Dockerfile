# syntax=docker/dockerfile:1
FROM node:24.22.2-alpine3.23 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npx vite build

FROM nginxinc/nginx-unprivileged:1.31.2-alpine3.23
# Utilisateur non root (uid 101), port 8080. Le modèle est rendu au démarrage avec les adresses des services.
ENV AUTH_UPSTREAM=auth:3001 CATALOG_UPSTREAM=catalog:3002 CART_UPSTREAM=cart:3003 ORDERS_UPSTREAM=orders:3004 \
    TRUSTED_PROXY_CIDR=127.0.0.1/32 \
    NGINX_ENVSUBST_FILTER=_UPSTREAM|TRUSTED_PROXY_CIDR
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/proxy_params /etc/nginx/proxy_params
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1
