# Imagen del servidor apps/brain-mcp (Fase 5 — docs/personal-brain/spec.md §5.2).
#
# IMPORTANTE: el contexto de build es la RAÍZ del monorepo. Desde la raíz:
#   docker build -f apps/brain-mcp/Dockerfile -t brain-mcp:local .

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
COPY apps/brain-mcp apps/brain-mcp

RUN pnpm --filter @personalai/shared build \
  && pnpm --filter @personalai/brain-mcp build \
  && pnpm --filter @personalai/brain-mcp deploy --prod /deploy

# ---------- runtime ----------
FROM node:20-slim AS runtime

# Ni Docker socket ni ningún otro privilegio: solo habla HTTP con `brain`.
RUN groupadd --gid 10002 brainmcp && useradd --uid 10002 --gid brainmcp --shell /bin/false brainmcp

WORKDIR /app
COPY --from=builder --chown=brainmcp:brainmcp /deploy ./

USER brainmcp
ENV NODE_ENV=production
ENV BRAIN_MCP_TRANSPORT=http
ENV BRAIN_MCP_HTTP_PORT=8091

EXPOSE 8091

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.BRAIN_MCP_HTTP_PORT||8091)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
