# Cómo aplicar la configuración de hermes-agent

`hermes.config.yaml` de este directorio **no** sustituye a `~/.hermes/config.yaml`.
Es la lista de claves que este proyecto necesita fijar, con su valor y su
motivo. El `config.yaml` real lo genera y mantiene hermes-agent.

## 1. Secretos en `~/.hermes/.env`

Estos valores nunca van en el repositorio (SEC-6.2 de [../../docs/security.md](../../docs/security.md)):

```bash
# Debe coincidir EXACTAMENTE con CLAUDE_CODE_RUNNER_AUTH_TOKEN del compose.
MCP_CLAUDE_CODE_RUNNER_API_KEY=<el mismo secreto que el runner>

# Debe coincidir EXACTAMENTE con BRAIN_MCP_AUTH_TOKEN del compose (Fase 5).
MCP_BRAIN_MCP_API_KEY=<el mismo secreto que brain-mcp>

# PAT fine-grained, scoped solo a los repos donde Hermes actúa (SEC-6.1).
GITHUB_TOKEN=<pat>
```

Los nombres `MCP_CLAUDE_CODE_RUNNER_API_KEY`/`MCP_BRAIN_MCP_API_KEY` no son
arbitrarios: hermes-agent deriva la variable del nombre del servidor MCP
(`claude-code-runner` → `MCP_CLAUDE_CODE_RUNNER_API_KEY`, `brain-mcp` →
`MCP_BRAIN_MCP_API_KEY`). Si renombras un servidor, cambia también su
variable.

## 2. Registrar los servidores MCP

Opción A — con la CLI, que escribe en `~/.hermes/config.yaml` por ti:

```bash
hermes mcp add claude-code-runner \
  --url http://claude-code-runner:8080/mcp \
  --auth header

hermes mcp add github \
  --command npx \
  --args -y @modelcontextprotocol/server-github \
  --env GITHUB_PERSONAL_ACCESS_TOKEN=$GITHUB_TOKEN

# Fase 5.
hermes mcp add brain-mcp \
  --url http://brain-mcp:8091/mcp \
  --auth header
```

Opción B — editando `~/.hermes/config.yaml` a mano y copiando el bloque
`mcp_servers` de `hermes.config.yaml`.

Comprobar después:

```bash
hermes mcp list          # los tres deben aparecer conectados
hermes mcp test github   # prueba de conexión
```

## 3. Fijar aprobaciones y modelo

En `~/.hermes/config.yaml`, asegurar que existen (son los valores por defecto,
pero aquí son requisito de seguridad, no preferencia — SEC-2.3):

```yaml
approvals:
  mode: manual
  cron_mode: deny
model:
  provider: anthropic
```

Y que **no** hay `ANTHROPIC_API_KEY` en `~/.hermes/.env`: si la hay,
hermes-agent la usará en lugar de la sesión Pro compartida.

## 4. Cargar los skills `resolve-issue` y `run-task`

Viven en [`../skills/resolve-issue/`](../skills/resolve-issue/) y
[`../skills/run-task/`](../skills/run-task/) — el primero para el flujo
automático de issues de GitHub (Fase 2), el segundo para peticiones
conversacionales por Telegram (Fase 3, ver `docs/hermes/spec.md §9`). Dos
formas de que hermes los vea:

- **Recomendada** — montar el directorio del repo en el contenedor y apuntar
  `skills.external_dirs` ahí. La fuente de verdad sigue siendo el repo, sin
  copias divergentes. Añade al servicio `hermes` del compose:

  ```yaml
  volumes:
    - ../skills:/opt/data/skills-repo:ro
  ```

- **Alternativa** — copiar `hermes/skills/resolve-issue` a `~/.hermes/skills/`
  y dejar `external_dirs` vacío. Más simple, pero hay que reconciliar a mano
  cada cambio.

Comprobar: `hermes skills list` debe mostrar tanto `resolve-issue` como
`run-task`.

## 5. Programar el cron

```bash
hermes cron create '30m' --name resolve-issues --skill resolve-issue
hermes cron list
hermes cron tick     # ejecuta los jobs pendientes una vez, sin esperar
```

`hermes cron tick` es la forma de probar el ciclo sin esperar al intervalo real.

## 6. Telegram (Fase 3)

1. Crea el bot con [@BotFather](https://t.me/BotFather) (`/newbot`) y guarda
   el token que te da en `TELEGRAM_BOT_TOKEN` (`~/.hermes/.env` o el `.env` del
   compose — ver `hermes/docker/.env.example`).
2. Averigua tu ID numérico de usuario de Telegram (p. ej. escribiéndole a
   [@userinfobot](https://t.me/userinfobot)) y ponlo en `TELEGRAM_ALLOWED_USERS`
   (SEC-1.1). **Nunca** actives `GATEWAY_ALLOW_ALL_USERS` ni
   `TELEGRAM_ALLOW_ALL_USERS` (SEC-1.2).
3. Reinicia el contenedor de hermes tras cambiar cualquiera de las dos
   variables (`docker compose restart hermes`) — igual que con `mcp_servers`,
   el gateway carga la config al arrancar (ver "gotcha operacional" de la
   Fase 2 en `docs/roadmap.md`).
4. Verifica desde tu cuenta de Telegram que el bot responde, y desde una
   **segunda cuenta** no listada en `TELEGRAM_ALLOWED_USERS` que el mensaje se
   rechaza (SEC-1.1, verificado, no asumido).
5. El skill `run-task` (`../skills/run-task/`) ya está disponible en cuanto
   pasa el paso 4 de esta guía — no necesita registro de cron, se activa igual
   que cualquier otro skill en un turno interactivo normal.
