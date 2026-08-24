# Imagen del servicio apps/brain (Fase 4 — docs/personal-brain/spec.md).
#
# IMPORTANTE: el contexto de build es la RAÍZ del monorepo, no este directorio
# (dependencia @personalai/shared vía `workspace:*`). Desde la raíz:
#   docker build -f apps/brain/Dockerfile -t brain:local .

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

RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/brain apps/brain

RUN pnpm --filter @personalai/shared build \
  && pnpm --filter @personalai/brain build \
  && pnpm --filter @personalai/brain deploy --prod /deploy

# ---------- runtime ----------
FROM node:20-slim AS runtime

# A diferencia de claude-code-runner-mcp, este servicio no toca el socket de
# Docker ni nada privilegiado: corre como usuario no-root sin justificación
# que lo impida (SEC-5.3 aplicado aquí por buena práctica general, aunque el
# requisito numerado sea del contenedor efímero, no de este servicio).
RUN groupadd --gid 10001 brain && useradd --uid 10001 --gid brain --shell /bin/false brain

WORKDIR /app
COPY --from=builder --chown=brain:brain /deploy ./

USER brain
ENV NODE_ENV=production
ENV BRAIN_HTTP_PORT=8090

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.BRAIN_HTTP_PORT||8090)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
