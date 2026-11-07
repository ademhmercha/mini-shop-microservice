# syntax=docker/dockerfile:1
FROM node:24.22.2-alpine3.23 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24.22.2-alpine3.23
ENV NODE_ENV=production PORT=3002
WORKDIR /app
# Image minimale : on retire npm/npx (non nécessaires à l'exécution ni aux migrations : `node src/migrate.js`).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn*
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json openapi.yaml ./
COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations
USER node
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
