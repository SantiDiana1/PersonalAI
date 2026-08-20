# claude-code-runner-image — imagen del contenedor efímero por tarea.
# Node.js + git + Claude Code CLI. SIN credenciales horneadas: la sesión
# (CLAUDE_CODE_OAUTH_TOKEN) y el token de GitHub llegan siempre como
# variables de entorno en tiempo de ejecución — ver docs/hermes/spec.md §3.2.
FROM node:20-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

RUN useradd --create-home --shell /bin/sh runner
WORKDIR /workspace
RUN chown runner:runner /workspace

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER runner

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
