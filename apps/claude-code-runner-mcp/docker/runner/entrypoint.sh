#!/bin/sh
# Entrypoint de claude-code-runner-image. Corre dentro del contenedor
# efímero de cada tarea — ver docs/hermes/spec.md §3.2.
#
# No recibe ninguna credencial de Anthropic horneada en la imagen: el token
# de la sesión Pro compartida (hermes-claude-auth) llega SIEMPRE como la
# variable de entorno CLAUDE_CODE_OAUTH_TOKEN, inyectada por
# claude-code-runner-mcp en tiempo de ejecución (§0.1/§0.3).
set -eu

cd /workspace

if [ ! -f prompt.md ]; then
  echo '{"status":"failed","summary":"prompt.md no encontrado en /workspace","commitShas":[]}' > result.json
  exit 0
fi

git config user.email "hermes@personalai.local"
git config user.name "Hermes (claude-code-runner)"

BRANCH="${TASK_BRANCH_NAME:-hermes/task-$(date +%s)}"
git checkout -b "$BRANCH"

# Ejecución no interactiva de Claude Code contra el prompt generado.
# --dangerously-skip-permissions: aceptado aquí porque el aislamiento (sin
# docker.sock, red restringida a allowlist, filesystem efímero) es la
# barrera de seguridad real — ver docs/hermes/spec.md §3.4.
if claude -p "$(cat prompt.md)" --dangerously-skip-permissions --output-format text > claude-output.log 2>&1; then
  CLAUDE_EXIT=0
else
  CLAUDE_EXIT=$?
fi

if [ ! -f result.json ]; then
  if [ "$CLAUDE_EXIT" -eq 0 ]; then
    SUMMARY=$(tail -c 2000 claude-output.log | sed 's/"/\\"/g' | tr '\n' ' ')
    echo "{\"status\":\"success\",\"summary\":\"$SUMMARY\",\"commitShas\":[]}" > result.json
  else
    echo "{\"status\":\"failed\",\"summary\":\"claude salió con código $CLAUDE_EXIT, ver claude-output.log\",\"commitShas\":[]}" > result.json
  fi
fi
