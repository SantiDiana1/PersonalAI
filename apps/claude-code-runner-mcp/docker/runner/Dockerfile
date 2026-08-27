# claude-code-runner-image — imagen del contenedor efímero por tarea.
# Node.js + git + Claude Code CLI. SIN credenciales horneadas: la sesión
# (CLAUDE_CODE_OAUTH_TOKEN) y el token de GitHub llegan siempre como
# variables de entorno en tiempo de ejecución — ver docs/hermes/spec.md §3.2.
FROM node:20-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

# SEC-5.7 (docs/security.md): registry.npmjs.org está en la allowlist del
# proxy para que las tareas de proyectos Node/JS puedan instalar dependencias,
# pero eso no debe significar ejecutar código de terceros sin revisar. Global
# y a nivel de imagen, no dependiente de que el prompt se acuerde de pedirlo:
# ignora preinstall/postinstall/prepare de TODAS las dependencias, del
# proyecto y transitivas. npm y pnpm leen ambos esta clave.
RUN echo "ignore-scripts=true" > /etc/npmrc
# Corta una llamada de red no esencial que hace Next.js por defecto.
ENV NEXT_TELEMETRY_DISABLED=1

RUN useradd --create-home --shell /bin/sh runner
WORKDIR /workspace
RUN chown runner:runner /workspace

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER runner

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
