# ================= build do frontend =================
FROM node:20-bookworm-slim AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ================= build do backend =================
# (bookworm completo: better-sqlite3 precisa compilar binding nativo)
FROM node:20-bookworm AS server-build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build
RUN npm prune --omit=dev

# ================= runtime =================
FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=server-build /app/server/package*.json ./server/
COPY --from=server-build /app/server/node_modules ./server/node_modules
COPY --from=web-build /app/web/dist ./web/dist

# /data deve ser um volume persistente (banco + uploads).
# Sem volume, cada redeploy APAGA vendas, estoque, clientes e fotos.
VOLUME ["/data"]
ENV PORT=3001 \
    DB_PATH=/data/bruce-burguer.db \
    UPLOADS_DIR=/data/uploads
EXPOSE 3001
CMD ["node", "server/dist/index.js"]
