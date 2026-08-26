# Imagen del bot de control de Telegram (US-9.2).
#
# IMPORTANTE: el contexto de build es la RAÍZ del monorepo. Desde la raíz:
#   docker build -f apps/control-bot/Dockerfile -t control-bot:local .

# ---------- build ----------
FROM node:20-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/brain/package.json apps/brain/
COPY apps/brain-mcp/package.json apps/brain-mcp/
COPY apps/claude-code-runner-mcp/package.json apps/claude-code-runner-mcp/
COPY apps/metrics-cli/package.json apps/metrics-cli/
COPY apps/control-bot/package.json apps/control-bot/

RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/control-bot apps/control-bot

RUN pnpm --filter @personalai/shared build \
  && pnpm --filter @personalai/control-bot build \
  && pnpm --filter @personalai/control-bot deploy --prod /deploy

# ---------- runtime ----------
FROM node:20-slim AS runtime

# ca-certificates: el bot habla HTTPS con api.telegram.org. node:20-slim no
# las trae, y sin ellas todas las llamadas fallan con UNABLE_TO_GET_ISSUER_CERT.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Sin socket de Docker, sin token del runner, sin puertos: este proceso ingiere
# texto de Telegram, así que se le da lo mínimo — solo lectura de Postgres.
RUN groupadd --gid 10003 controlbot \
  && useradd --uid 10003 --gid controlbot --shell /bin/false controlbot

WORKDIR /app
COPY --from=builder --chown=controlbot:controlbot /deploy ./

USER controlbot
ENV NODE_ENV=production

# Sin HEALTHCHECK HTTP: este servicio no escucha en ningún puerto (habla hacia
# fuera, nadie habla con él). El proceso vivo ES el healthcheck.
CMD ["node", "dist/index.js"]
