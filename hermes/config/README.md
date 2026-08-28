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

# Fase 7 — Notion (integración interna, notion.so/my-integrations).
NOTION_TOKEN=<secret>

# Fase 7 — Jira. Token en id.atlassian.com/manage-profile/security/api-tokens.
# ATLASSIAN_SITE_NAME es solo el subdominio (si tu Jira es
# https://miempresa.atlassian.net, aquí va "miempresa"), no toda la URL.
ATLASSIAN_TOKEN=<api-token>
ATLASSIAN_SITE_NAME=<subdominio>
ATLASSIAN_USER_EMAIL=<tu-email-de-atlassian>
```

Los nombres `MCP_CLAUDE_CODE_RUNNER_API_KEY`/`MCP_BRAIN_MCP_API_KEY` no son
arbitrarios: hermes-agent deriva la variable del nombre del servidor MCP
(`claude-code-runner` → `MCP_CLAUDE_CODE_RUNNER_API_KEY`, `brain-mcp` →
`MCP_BRAIN_MCP_API_KEY`). Si renombras un servidor, cambia también su
variable.

## 2. Registrar los servidores MCP

**Antes de nada, si has tocado `apps/claude-code-runner-mcp/docker/runner/`
(Dockerfile o entrypoint.sh)**: reconstruye la imagen del contenedor
efímero por tarea a mano — `docker compose build`/`up --build` **no** la
reconstruye, es una imagen aparte del servicio `claude-code-runner` de
abajo (ver el comentario detallado en `hermes/docker/docker-compose.yml`).
Hallazgo real, Fase 8: olvidarse de este paso deja `run_claude_command`
(y, en general, cualquier tarea) fallando en silencio con una imagen
desactualizada.

```bash
docker build -t claude-code-runner-image:local \
  -f apps/claude-code-runner-mcp/docker/runner/Dockerfile \
  apps/claude-code-runner-mcp/docker/runner
```

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

**Fase 7 (Notion/Jira) — activado con tokens propios del Operador**: los
bloques `notion`/`jira` de `hermes.config.yaml` están descomentados y
registrados de verdad en `~/.hermes/config.yaml`:

```bash
# Notion: integración interna creada en notion.so/my-integrations.
hermes mcp add notion \
  --command npx \
  --args -y @notionhq/notion-mcp-server \
  --env NOTION_TOKEN=$NOTION_TOKEN

# Jira: API token en id.atlassian.com/manage-profile/security/api-tokens.
# Se eligió el servidor de comunidad @aashari/mcp-server-atlassian-jira
# (stdio, auth por API token clásico) en vez del remoto oficial de Atlassian
# porque este último exige OAuth — infraestructura que no hacía falta añadir.
hermes mcp add jira \
  --command npx \
  --args -y @aashari/mcp-server-atlassian-jira \
  --env ATLASSIAN_SITE_NAME=<subdominio-de-tu-sitio> \
  --env ATLASSIAN_USER_EMAIL=<tu-email-de-atlassian> \
  --env ATLASSIAN_API_TOKEN=$ATLASSIAN_TOKEN
```

Nota: `hermes mcp add --args` no admite flags sueltos como `-y` bien (falla
con "unrecognized arguments"); si te pasa, edita `~/.hermes/config.yaml` a
mano en `mcp_servers.<nombre>.args` con una lista YAML (`['-y', 'paquete']`) —
es la Opción B de este mismo README, y es lo que se usó aquí.

Verificado (`hermes mcp test notion` / `hermes mcp test jira`): ambos
conectan y descubren sus tools, y ambos tokens autentican de verdad contra
las APIs reales (llamadas de prueba con 200 OK). **Pendiente de un único paso
del Operador en la propia UI de Notion**: compartir la base de datos "Hermes
Tasks" con la integración (menú "..." de la base de datos → Connections) —
sin eso, Notion devuelve resultados vacíos aunque el token sea válido. Jira no
tiene un bloqueo equivalente: la JQL ya apunta a un proyecto/label reales, solo
está vacía porque aún no hay ningún issue etiquetado.

**Jira ya no lo maneja `resolve-issue`**: tiene skill propio,
`resolve-jira-task` (Fase 14, ver §11). El motivo es que este servidor MCP
expone cinco verbos REST crudos (`jira_get/post/put/patch/delete`) en vez de
tools con nombre, así que cada llamada se construye a mano y el procedimiento
no se parece al de GitHub. Para **Notion**, en cambio, `resolve-issue`
(§ "Generalización a Notion y Jira") sigue sirviendo sin cambios en cuanto se
resuelva el paso manual de arriba.

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
Telegram, Fase 3, ver `docs/hermes/spec.md §9`), `status-report`/`ask-brain`
(cierre operativo y superficie conversacional, Fase 6), `run-design-task`
(diseños/Artifacts pedidos por chat, Fase 8) y `resolve-jira-task` (flujo
automático de tareas de Jira, Fase 14, ver §11). Dos formas de que hermes los
vea:

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
`status-report`, `ask-brain`, `run-design-task` y `resolve-jira-task`.

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

El cron de Jira (Fase 14) va **aparte** del de GitHub, y lleva la allowlist de
repos en el prompt posicional — ver §11.

> **Siempre `docker exec -u hermes`, nunca root.** El `gateway` corre como el
> usuario no-root `hermes`; un `hermes cron create` ejecutado como root deja
> `cron/jobs.json` con dueño `root` e ilegible para el gateway, y el cron deja
> de dispararse **en silencio**. Hallazgo real de la Fase 2, reproducido otra
> vez en la Fase 6.

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

## 8. Webhook de métricas — el camino determinista (US-9.2)

Pedirle las métricas a Hermes por lenguaje natural funciona, pero gasta tokens
de la ventana Pro y depende de que el modelo elija la tool correcta. Este
webhook es la alternativa **sin modelo**: cero tokens, cero decisiones del
agente.

**Por qué un webhook y no un `/comando`**: los slash commands de hermes-agent
están hardcodeados en su registro central (`hermes_cli/commands.py`); los
custom son una petición abierta y sin implementar
([#25335](https://github.com/NousResearch/hermes-agent/issues/25335), duplicado
en [#31373](https://github.com/NousResearch/hermes-agent/issues/31373), con
[PR #4602](https://github.com/NousResearch/hermes-agent/pull/4602) sin
mergear). Añadir uno exigiría parchear el código de hermes-agent, que este
proyecto decidió no tocar. El flag `--deliver-only` de `hermes webhook` es la
única vía documentada para entregar un mensaje **sin agent loop**.

El precio de esa decisión: el disparador es un POST HTTP, no un mensaje de
Telegram. Desde el móvil se lanza con un atajo de iOS / acceso directo de
Android; la respuesta sí llega al chat de Telegram de siempre.

```bash
# 1. Script y su configuración, en $HERMES_HOME/scripts (hermes-agent confina
#    los scripts de webhook a ese directorio; no se ejecutan desde el repo).
mkdir -p ~/.hermes/scripts
cp ../scripts/metrics-webhook.sh ~/.hermes/scripts/
cp ../scripts/metrics-webhook.env.example ~/.hermes/scripts/metrics-webhook.env
chmod +x ~/.hermes/scripts/metrics-webhook.sh
chmod 600 ~/.hermes/scripts/metrics-webhook.env   # contiene el token del runner
$EDITOR ~/.hermes/scripts/metrics-webhook.env     # rellenar RUNNER_TOKEN

# 2. Suscripción. --deliver-only es lo que evita el turno de modelo: el prompt
#    renderizado ({script_output} = la salida del script) se entrega literal.
hermes webhook subscribe metrics \
  --script metrics-webhook.sh \
  --prompt '{script_output}' \
  --deliver-only \
  --deliver telegram \
  --deliver-chat-id '<tu_chat_id>'

hermes webhook list          # devuelve la URL y el secreto HMAC
hermes webhook test metrics  # comprobar sin esperar a dispararlo de verdad
```

`<tu_chat_id>` es el mismo ID numérico que `TELEGRAM_ALLOWED_USERS` (SEC-1.1).

**Cómo funciona el script** (`hermes/scripts/metrics-webhook.sh`): hace un
`curl` autenticado a `GET /v1/metrics` del runner y escribe el informe en
stdout. Detalles del contrato de hermes-agent de los que depende, verificados
antes de escribirlo:

- El entorno del script está **saneado**, así que la configuración se lee de
  `metrics-webhook.env` al lado del script, no de variables heredadas del
  compose.
- stdout de **texto** se expone como `{script_output}`; un stdout que sea un
  **objeto JSON** reemplazaría el payload en vez de exponerse. El informe
  empieza por `PersonalAI` y nunca por `{`, por eso se entrega en texto plano
  y no en JSON.
- stdout vacío, `[SILENT]`, o **salida distinta de cero** hacen que el webhook
  se ignore y no se entregue nada. Es el comportamiento deseado ante un error:
  verificado que token incorrecto (exit 22), falta de configuración (exit 1) y
  runner caído (exit 7) dejan stdout vacío, así que nunca se entrega un informe
  en blanco que parezca real.

La ruta `GET /v1/metrics` exige la misma autenticación Bearer que `/mcp`
(SEC-3.2), es de solo lectura y sin parámetros, y devuelve agregados fijos —
nunca títulos de tarea ni contenido de repos.

## 9. Bot de control — el camino determinista definitivo (US-9.2)

Un SEGUNDO bot de Telegram, con su propio token, que responde `/metricas`
calculando sobre la base de datos: **sin modelo, sin gastar cuota de Claude
Pro, y sin depender de que un agente decida llamar a la tool correcta**.

Es la alternativa al webhook de §8: mismo determinismo, pero el disparador sí
es un mensaje. El precio es un bot más en tu Telegram.

**Por qué un bot aparte y no un comando del de Hermes**: Telegram admite un
único consumidor de updates por token. Si los dos servicios hicieran
`getUpdates` con el mismo token se robarían los mensajes (error 409 de la Bot
API). Y un `/comando` dentro de Hermes no es posible: sus slash commands están
hardcodeados en su registro central (ver §8).

```bash
# 1. Crear el bot en BotFather (/newbot) y copiar el token. NO reutilices el
#    de Hermes.
# 2. Añadir al .env del compose:
#      CONTROL_BOT_TELEGRAM_TOKEN=<token del bot nuevo>
#      CONTROL_BOT_ALLOWED_USERS=<los mismos IDs que TELEGRAM_ALLOWED_USERS>
# 3. Levantarlo:
docker compose up -d --build control-bot
docker compose logs -f control-bot   # debe decir "bot de control escuchando"
```

Luego, en el chat del bot nuevo: `/metricas`. También valen `/metrics`, `/m`,
y se toleran acentos y mayúsculas (`/Métricas`). `/ayuda` lista los comandos.

**Comportamiento que conviene conocer**:

- **Allowlist obligatoria**: sin `CONTROL_BOT_ALLOWED_USERS` el proceso no
  arranca (sale con código 2 y un mensaje claro). A un usuario no autorizado no
  se le contesta **nada** — ni un "no autorizado", que le confirmaría que el bot
  existe. Queda en el log.
- **Descarta el backlog al arrancar**: Telegram retiene los mensajes hasta 24 h,
  así que un `/metricas` enviado mientras el bot estaba caído no se contesta al
  volver. Un informe de ayer entregado hoy sin avisar sería peor que ninguno.
- **No hace lenguaje natural, a propósito**: es su garantía de determinismo. Un
  mensaje que no sea un comando conocido recibe la lista de comandos, nunca una
  interpretación.
- **Es el servicio menos privilegiado del compose** (SEC-1.5): sin socket de
  Docker, sin el token del runner, sin puertos publicados. Solo SELECTs contra
  Postgres.

Añadir un comando nuevo es añadir una entrada a `COMMANDS` en
`apps/control-bot/src/commands.ts`: la superficie es exactamente esa lista, no
un intérprete genérico.

## 10. Cadena de proveedores y modelo local (Fase 13)

Desde el 2026-08-26 el agent loop de Hermes **no puede usar la suscripción
Pro**: Anthropic lo clasifica como _third-party app_ y lo rechaza con `HTTP
400` (ver Fase 12 del roadmap). El runner no está afectado — ejecuta el binario
oficial `claude -p`, que sí se acepta.

La respuesta no es cambiar de proveedor, que sería repetir el mismo error con
otro nombre, sino una **cadena** con degradación ordenada:
`ollama` (local, gratis) → _eslabón barato por decidir_ → `anthropic` (créditos,
con tope).

### Despliegue en el Mac Mini (16 GB)

```bash
# 1. Levantar Ollama. Está detrás de un PROFILE: `docker compose up -d` a secas
#    NO lo arranca, para que en una máquina sin RAM suficiente no muera por OOM
#    arrastrando la sensación de que el compose está roto.
docker compose --profile local-llm up -d ollama

# 2. Descargar el modelo. SIN esto el contenedor arranca, el healthcheck pasa,
#    y la cadena falla igual en el primer turno — el fallo más traicionero de
#    todo este montaje. `/proveedores` lo distingue explícitamente.
docker compose exec ollama ollama pull qwen2.5:3b

# 3. Apuntar hermes a la cadena (NO se aplica copiando hermes.config.yaml —
#    ver la cabecera de ese fichero).
hermes config set model.provider ollama
hermes config set model.base_url http://ollama:11434
hermes fallback add anthropic
hermes fallback list

# 4. Comprobar desde el bot de control, sin gastar un token:
#    /proveedores
```

Ajustes disponibles en el `.env` del compose: `OLLAMA_MEMORY_LIMIT` (8g por
defecto) y `OLLAMA_KEEP_ALIVE` (5m — descarga el modelo de RAM tras ese tiempo
sin uso, para no quitarle memoria a Postgres, Brain y el runner todo el día).

### `/proveedores` en el bot de control

Sondea cada eslabón y dice si responde. Para Ollama además **lista los modelos
descargados**, que es lo que distingue "vivo pero inútil" de "vivo y listo".

Lo que **no** hace, y el propio comando lo advierte en su salida: no lee la
cadena viva de hermes. Esa vive en su `config.yaml`, dentro de un volumen que
contiene también `auth.json` con el token OAuth; montarlo en el bot de control
—el proceso que ingiere texto de Telegram— contradiría SEC-1.5. Así que sondea
la lista **declarada** en `CONTROL_BOT_PROVIDER_PROBES`, y si cambias la cadena
con `hermes fallback` tienes que actualizar esa variable también.

Tampoco responde "qué proveedor atendió el último turno": hermes-agent solo
deja caer eso en texto de log al hacer fallback (`auxiliary_client.py`), sin
registro estructurado. Afirmarlo sería inventarse un dato que no existe.

### Antes de dar la cadena por buena

El riesgo real no es la RAM, es la fiabilidad de las **tool calls**: los
modelos pequeños son flojos llamando a herramientas, y el bug 2 de la Fase 8 ya
demostró que un modelo mal equipado fabrica resultados plausibles en vez de
fallar. Por eso US-13.1 es una puerta: hay que ver una petición real de Telegram
disparando `run_coding_task` **de verdad** (fila nueva en `runner.task_runs`),
no descrita en texto, antes de confiar en el eslabón local.

## 11. Jira como fuente de tareas (Fase 14)

Jira usa **las mismas cuatro etiquetas** que GitHub (`hermes`,
`hermes:in-progress`, `hermes:done`, `hermes:needs-human`) más una quinta,
`repo:<owner>/<nombre>`, que dice en qué repositorio aterriza la tarea.

No hay que crear ninguna: a diferencia de GitHub, donde un label debe existir
en el repo antes de aplicarse, las etiquetas de Jira son texto libre y nacen al
asignarlas. Los dos puntos y la barra son caracteres válidos (verificado contra
`<tu-dominio>.atlassian.net`); lo único prohibido son los espacios.

### Crear el cron

```bash
docker exec -u hermes personalai-hermes-1 /opt/hermes/.venv/bin/hermes \
  cron create '30m' --name resolve-jira --skill resolve-jira-task \
  'Procesa tareas de Jira. Repos permitidos: SantiDiana1/PersonalAI.'
```

El prompt posicional es **obligatorio en la práctica**: ahí va la allowlist de
repos. Sin ella el skill se planta y no ejecuta nada, a propósito — un ticket
de Jira no vive dentro de ningún repo, así que el destino no es un hecho que se
pueda deducir, y dejar que lo elija el texto del ticket sería exactamente el
agujero que cierra SEC-3.4. Ver la Regla 2 de
`hermes/skills/resolve-jira-task/SKILL.md`.

Añade cada repo nuevo a esa lista **editando el job**, no al ticket.

### Ajustar la frecuencia

```bash
docker exec -u hermes personalai-hermes-1 /opt/hermes/.venv/bin/hermes cron list
docker exec -u hermes personalai-hermes-1 /opt/hermes/.venv/bin/hermes cron tick   # dispara ya, sin esperar
```

Para cambiar el intervalo, borra el job y créalo de nuevo con otro `schedule`.
Está separado del de `resolve-issue` justo para esto: puedes parar o acelerar
la fuente Jira sin tocar la de GitHub.

### Comprobar el filtro a mano

El JQL que usa el skill, por si quieres verlo desde la UI de Jira:

```
labels = hermes AND statusCategory != Done ORDER BY created ASC
```

**No filtres por `status`**: JQL resuelve los nombres canónicos en inglés, no
los que muestra la UI. En un site en español, `status = "Tareas por hacer"`
devuelve **cero resultados sin dar error** — el cron seguiría corriendo sin
coger nunca nada. `statusCategory` tiene tres valores fijos del propio Jira y
es inmune al idioma y a que renombres un estado.

## 12. Gobierno: entrega del cron y `/cron`

Dos piezas que responden a la misma pregunta — _¿qué está corriendo solo, y cómo
me entero de lo que hizo?_

### Que los cronjobs te avisen

Un job con `Deliver: local` deja su resultado dentro del contenedor. Parece
sano en `hermes cron list` y **nadie se entera de nada**, ni de los errores.
Este fue un fallo real: `resolve-issues` estuvo fallando cada 30 minutos sin
avisar. Todo job debe entregar a Telegram:

```bash
docker exec -u hermes personalai-hermes-1 /opt/hermes/.venv/bin/hermes \
  cron edit <job_id> --deliver telegram:<tu_chat_id>
```

`hermes cron edit` cambia el job en sitio, sin perder su historial de
ejecuciones (`repeat.completed`), a diferencia de borrarlo y recrearlo.

### `/cron` en el bot de control

Lista jobs, horario, próxima ejecución y resultado de la última — determinista,
sin modelo y sin gastar cuota, igual que `/metricas` y `/proveedores`. Además
**avisa** de los dos fallos silenciosos: un job con entrega `local`, y un job
que corrió bien pero cuya entrega falló (`last_delivery_error`).

Requiere dos cosas en el compose, ya puestas en el servicio `control-bot`:

```yaml
volumes:
  - ${HERMES_HOME:-~/.hermes}/cron:/hermes-cron:ro
user: '10000:10000'
environment:
  CONTROL_BOT_CRON_JOBS_PATH: /hermes-cron/jobs.json
```

El `user:` no es opcional ni es pereza: hermes escribe `jobs.json` con modo
`0600` **y restaura ese modo cada vez que reescribe el fichero**, así que un
`chmod` se deshace solo en el siguiente tick del scheduler. Se monta el
subdirectorio `cron` y no `$HERMES_HOME` entero, para que `auth.json` quede
fuera de alcance. El razonamiento completo, incluida la parte que sí amplía el
alcance, está en [`../../docs/security.md`](../../docs/security.md) SEC-1.5.

Si falta el mount, `/cron` lo dice y explica qué hacer, en vez de contestar un
error genérico: el Operador está leyendo Telegram, no tiene el compose delante.

> **Acoplamiento declarado**: `jobs.json` es formato interno de hermes-agent,
> no un contrato público. Puede cambiar al actualizar el upstream. Todos los
> campos se leen de forma opcional y degradan a "desconocido", así que un
> cambio de formato produce un informe más pobre, nunca un bot caído — hay
> tests que fijan justo eso.
