# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
ARG TS_BUILD_HEAP_MB=2048
RUN NODE_OPTIONS="--max-old-space-size=${TS_BUILD_HEAP_MB}" npm run build

FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    dumb-init \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PORT=5000
ENV RUN_MIGRATIONS=true

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

RUN mkdir -p /app/uploads /app/logs && chown -R node:node /app
USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "if [ \"$RUN_MIGRATIONS\" = \"true\" ]; then node dist/db/migrate.js; fi && node dist/server.js"]
