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

**Fase 7 (Notion/Jira) — bloqueado hasta tener tokens propios**: los bloques
`notion`/`jira` de `hermes.config.yaml` están comentados a propósito porque
necesitan credenciales que solo el Operador puede generar:

```bash
# Notion: crear una integración interna en notion.so/my-integrations,
# compartirla con la base de datos "Hermes Tasks", y guardar el token:
#   NOTION_TOKEN=<secret> en ~/.hermes/.env
hermes mcp add notion \
  --command npx \
  --args -y @notionhq/notion-mcp-server \
  --env NOTION_TOKEN=$NOTION_TOKEN

# Jira: generar un API token en id.atlassian.com/manage-profile/security/api-tokens.
# El servidor MCP concreto (oficial por URL/OAuth vs. comunidad por API token)
# queda por decidir al activarlo — ver el comentario en hermes.config.yaml.
```

En cuanto se registren, `resolve-issue` (`hermes/skills/resolve-issue/SKILL.md`
§ "Generalización a Notion y Jira") ya sabe listarlos/reportarlos sin ningún
otro cambio.

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

## 4. Cargar los skills

Viven en [`../skills/`](../skills/): `resolve-issue` (flujo automático de
issues de GitHub, Fase 2), `run-task` (peticiones conversacionales por
Telegram, Fase 3, ver `docs/hermes/spec.md §9`), y `status-report`/`ask-brain`
(cierre operativo y superficie conversacional, Fase 6). Dos formas de que
hermes los vea:

- **Recomendada** — montar el directorio del repo en el contenedor y apuntar
  `skills.external_dirs` ahí. La fuente de verdad sigue siendo el repo, sin
  copias divergentes. Añade al servicio `hermes` del compose:

  ```yaml
  volumes:
    - ../skills:/opt/skills-repo:ro
  ```

  Deliberadamente **fuera** de `/opt/data` (`$HERMES_HOME`), no debajo — ver
  el comentario en `hermes/docker/docker-compose.yml` (US-6.2 de
  `docs/roadmap.md`): montarlo bajo `$HERMES_HOME` hacía que el `chown -R`
  recursivo del entrypoint fallara en él (es `:ro`), produciendo en cada
  arranque el warning "chown failed (rootless container?)" — engañoso, no
  tiene nada que ver con Podman rootless.

- **Alternativa** — copiar cada skill de `hermes/skills/` a
  `~/.hermes/skills/` y dejar `external_dirs` vacío. Más simple, pero hay que
  reconciliar a mano cada cambio.

Comprobar: `hermes skills list` debe mostrar `resolve-issue`, `run-task`,
`status-report` y `ask-brain`.

## 5. Programar el cron

```bash
hermes cron create '30m' --name resolve-issues --skill resolve-issue
# US-6.3: resumen proactivo, necesita --deliver explícito (no hay chat de
# origen propio en un cronjob recurrente) — ver hermes/skills/status-report/SKILL.md.
hermes cron create 'every 24h' --name status-report --skill status-report \
  --deliver telegram:<tu_chat_id>
hermes cron list
hermes cron tick     # ejecuta los jobs pendientes una vez, sin esperar
```

`hermes cron tick` es la forma de probar el ciclo sin esperar al intervalo real.
`run-task` y `ask-brain` no necesitan cron — se activan igual que cualquier
otro skill en un turno interactivo normal (ver paso 6).

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
5. Los skills `run-task` y `ask-brain` (`../skills/run-task/`,
   `../skills/ask-brain/`) ya están disponibles en cuanto pasa el paso 4 de
   esta guía — no necesitan registro de cron, se activan igual que cualquier
   otro skill en un turno interactivo normal. `status-report` también
   responde a demanda sin cron, además de su mitad proactiva del paso 5.
6. **Notas de voz (Fase 7, US-7.5)**: no requiere ningún cambio de
   configuración — verificado en el despliegue real que el contenedor de
   hermes trae `faster-whisper` instalado y `stt.enabled: true` con
   `provider: local` por defecto en `~/.hermes/config.yaml` (transcripción
   local, sin API key ni servicio externo). Una nota de voz enviada por
   Telegram debería transcribirse y disparar `run-task`/`ask-brain`/etc.
   igual que un mensaje de texto — **pendiente de una prueba real** con un
   audio real del Operador, no verificado end-to-end todavía.
7. **Canal de mensajería adicional (Fase 7, US-7.4)**: hermes-agent trae de
   fábrica Discord/Slack/WhatsApp/Signal además de Telegram, pero activar
   cualquiera de ellos necesita una cuenta/bot token nuevo en esa plataforma
   que solo el Operador puede crear — bloqueado hasta que el Operador elija
   plataforma y genere las credenciales. El mecanismo de activación es el
   mismo patrón de los pasos 1–4 de esta sección, sustituyendo Telegram por
   el gateway de la plataforma elegida (`hermes gateway setup`, ver su
   `--help` para el flag por plataforma).

## 7. Identidad del agente (`SOUL.md`)

Sin esto, hermes-agent usa la plantilla por defecto (vacía) y se comporta
como un asistente genérico — ver `docs/hermes/spec.md §10`.

```bash
cp SOUL.md ~/.hermes/SOUL.md   # o la ruta de HERMES_HOME que uses
```

Se lee en caliente (no hace falta reiniciar el contenedor de hermes). Si lo
editas en vivo desde el propio chat de Hermes, trae el cambio de vuelta a
este `SOUL.md` del repo para que no se pierda en el siguiente despliegue —
este fichero es la fuente de verdad versionada, `~/.hermes/SOUL.md` es la
copia operativa.
