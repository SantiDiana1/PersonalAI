# Imagen del servidor claude-code-runner-mcp.
#
# IMPORTANTE: el contexto de build es la RAÍZ del monorepo, no este directorio,
# porque el paquete depende de @personalai/shared vía `workspace:*`. Desde la
# raíz:
#   docker build -f apps/claude-code-runner-mcp/Dockerfile -t claude-code-runner-mcp:local .
#
# Este es el único contenedor del sistema que monta el socket de Docker
# (SEC-4.1 de docs/security.md). Ver docs/hermes/spec.md §3.5 para por qué vive
# en su propio contenedor en vez de como subproceso stdio de hermes-agent.

# ---------- build ----------
FROM node:20-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /repo

# Manifests primero, para que la capa de instalación se cachee mientras no
# cambien las dependencias. Hacen falta los de TODOS los paquetes del
# workspace: sin ellos `--frozen-lockfile` considera el lockfile incoherente.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/brain/package.json apps/brain/
COPY apps/brain-mcp/package.json apps/brain-mcp/
COPY apps/claude-code-runner-mcp/package.json apps/claude-code-runner-mcp/

RUN pnpm install --frozen-lockfile

# Solo el código que este servidor necesita compilar.
COPY packages/shared packages/shared
COPY apps/claude-code-runner-mcp apps/claude-code-runner-mcp

RUN pnpm --filter @personalai/shared build \
  && pnpm --filter @personalai/claude-code-runner-mcp build \
  && pnpm --filter @personalai/claude-code-runner-mcp deploy --prod /deploy

# ---------- runtime ----------
FROM node:20-slim AS runtime

# git: el runner clona el repo y empuja la rama desde este proceso (host-side
# respecto al contenedor efímero). ca-certificates: HTTPS hacia github.com.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /deploy ./

ENV NODE_ENV=production
ENV CLAUDE_CODE_RUNNER_TRANSPORT=http
ENV CLAUDE_CODE_RUNNER_HTTP_PORT=8080

# Nota deliberada sobre el usuario: este contenedor corre como root.
# No es un descuido — es una decisión documentada. Monta el socket de Docker,
# lo que ya equivale a control total del host (SEC-1 de docs/security.md);
# correr como no-root aquí no reduciría ese poder en ninguna medida
# significativa, solo daría una falsa sensación de contención. Lo que sí
# protege de verdad a este componente es que nada pueda invocarlo: sin puerto
# publicado (SEC-3.1), con autenticación obligatoria (SEC-3.2) y con una única
# tool de forma fija como superficie (SEC-3.3).

EXPOSE 8080

# Sin curl/wget en la imagen slim: el healthcheck usa el propio node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.CLAUDE_CODE_RUNNER_HTTP_PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
