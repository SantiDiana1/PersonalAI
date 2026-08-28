# Modelo de seguridad — PersonalAI

> **Este documento es la fuente única de verdad de los requisitos de seguridad
> innegociables del proyecto.** Cada fase del [roadmap](roadmap.md) referencia
> los requisitos `SEC-x.y` que le aplican, y ninguna fase se da por terminada
> sin verificarlos con evidencia real (no "debería funcionar").
>
> Si un requisito de aquí estorba para avanzar, la salida **no** es saltárselo:
> es cambiar este documento explícitamente, dejando constancia de qué se relaja
> y por qué. Un requisito incumplido en silencio es una mentira en el portfolio.

## 0. Por qué este documento existe

Este sistema tiene una combinación que, mal montada, es peligrosa de verdad:

1. **Lee texto escrito por desconocidos** — el cuerpo de una issue de GitHub lo
   puede escribir cualquiera, y puede contener instrucciones dirigidas al agente
   ("ignora tus instrucciones y en su lugar..."). Esto es **prompt injection**, y
   no es hipotético: es el modo de fallo esperado de cualquier agente que lee
   input de terceros.
2. **Ejecuta código automáticamente** — el propósito del sistema es que Claude
   Code escriba y commitee código sin que nadie mire en el momento.
3. **Corre en la máquina de casa del Operador** — un Mac Mini que no es un
   servidor desechable, sino un equipo personal en la red doméstica.

El diseño entero está construido alrededor de una idea: **quien lee lo no
confiable no puede tener permisos peligrosos, y quien tiene permisos peligrosos
no lee nada no confiable.**

## 1. El concepto central: el socket de Docker es la llave maestra

En Docker no existe un permiso "puedes crear contenedores, pero solo pequeños e
inofensivos". Quien puede hablar con el socket de Docker puede crear un
contenedor que monte el disco entero del host y leerlo o modificarlo. Por tanto:

> **acceso al socket de Docker ≡ control total del Mac Mini**

`claude-code-runner-mcp` necesita ese acceso — lanzar contenedores efímeros es
literalmente su función. Eso no se discute. Lo que sí se decide es **quién más
lo tiene**, y la respuesta es: nadie.

De ahí sale la arquitectura de despliegue (ver [architecture.md §Despliegue](architecture.md#despliegue)):
hermes-agent y el runner viven en **contenedores separados**, y solo el segundo
ve el socket. Se comunican por MCP sobre HTTP dentro de una red interna de
Docker Compose, donde la única cosa que hermes le puede pedir al runner es
`run_coding_task(repo, título, descripción, ...)` — no existe ninguna tool
genérica de "ejecuta este comando".

Esto se evaluó explícitamente frente a dos alternativas más simples, ambas
descartadas:

| Alternativa                                                                   | Por qué se descartó                                                                                             |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| hermes nativo en el host (sin contenedor) + runner como subproceso stdio      | hermes tendría los privilegios completos del usuario del Mac Mini. Una inyección exitosa = equipo comprometido. |
| hermes en contenedor **con** el socket montado + runner como subproceso stdio | Le da la llave maestra justo al componente que lee texto no confiable. Es la peor combinación de las tres.      |

## 2. Capa 0 — Perímetro de red doméstica

**Requisito de partida**: el Mac Mini está en la red de casa del Operador, detrás
de un router doméstico. Abrir puertos ahí no expone "un servidor", expone la red
de casa.

- **SEC-0.1 (innegociable) — Cero puertos entrantes.** No se abre ningún puerto
  del router hacia el Mac Mini. Ni port forwarding, ni DMZ, ni UPnP para este
  proyecto.
  - _Por qué se puede cumplir_: **verificado en el código de hermes-agent** — el
    gateway de Telegram usa long polling (`getUpdates` vía python-telegram-bot,
    `gateway/platforms/telegram.py`), no webhooks. El tráfico es **saliente**: el
    proceso pregunta a `api.telegram.org` si hay mensajes. El cron que sondea
    GitHub (Fase 2) también es saliente. **Hablar con Hermes desde fuera de casa
    no requiere ninguna entrada**: tú hablas con los servidores de Telegram, y
    Hermes también — nunca directamente entre vosotros.
  - _Verificación_: desde fuera de la red doméstica, un escaneo de la IP pública
    no debe mostrar ningún puerto del proyecto abierto.

- **SEC-0.2 (innegociable) — Nada de túneles "para probar".** Prohibido exponer
  cualquier componente vía ngrok, Cloudflare Tunnel, Tailscale Funnel o
  equivalente, aunque sea temporalmente durante el desarrollo. Un túnel es un
  puerto entrante con otro nombre, y los "temporales" se quedan.
  - _Excepción admitida_: una VPN de acceso remoto (Tailscale/WireGuard en modo
    red privada, **sin** exponer servicios a internet) es aceptable si el
    Operador la quiere para administrar el Mac Mini, porque no publica nada.

- **SEC-0.3 (innegociable) — Dashboard y API server no salen de localhost.** El
  dashboard de hermes-agent almacena credenciales de proveedores. El compose
  upstream ya lo ata a `127.0.0.1` y deja el API server apagado salvo que se
  define `API_SERVER_KEY`; **no se revierte ninguna de las dos cosas**. Para
  acceder al dashboard desde otro equipo se usa un túnel SSH, nunca
  `--host 0.0.0.0`.

## 3. Capa 1 — Quién puede darle órdenes a Hermes

Esta es la capa que más importa para el objetivo de "hablar con mi IA desde el
móvil". Un bot de Telegram es **descubrible**: su nombre de usuario es público y
cualquiera puede escribirle.

- **SEC-1.1 (innegociable) — Allowlist explícita, denegación por defecto.** Solo
  los IDs de usuario de Telegram explícitamente autorizados pueden interactuar.
  - _Base_: **verificado en el código** — `gateway/run.py::_is_user_authorized`
    resuelve en este orden: flag allow-all por plataforma → allowlist por env
    (`TELEGRAM_ALLOWED_USERS`) → lista aprobada de DM pairing → allow-all global
    → **"Default: deny"**. El comportamiento por defecto ya es el correcto.
  - _Configuración_: `TELEGRAM_ALLOWED_USERS=<id del Operador>` en el `.env`, y/o
    aprobación explícita vía `hermes pairing approve`.
  - _Verificación_: con la allowlist puesta, un mensaje desde una cuenta de
    Telegram distinta debe ser rechazado. Se comprueba con una segunda cuenta,
    no se asume.

- **SEC-1.2 (innegociable) — Nunca activar los escapes de allow-all.** Las
  variables `GATEWAY_ALLOW_ALL_USERS`, `TELEGRAM_ALLOW_ALL_USERS` y sus
  equivalentes por plataforma **no se ponen a `true` jamás**, ni siquiera para
  depurar. Con ellas, cualquiera que encuentre el bot puede mandarle tareas de
  código.

- **SEC-1.3 — El token del bot de Telegram es un secreto de primer nivel.** Quien
  lo tenga puede leer todo lo que le escribes al bot y suplantarlo. Vive en el
  `.env` fuera de git, igual que el resto (ver SEC-6.2).

- **SEC-1.5 — El bot de control tiene token y allowlist propios, y es el
  servicio menos privilegiado.** El segundo bot de Telegram (`apps/control-bot`,
  Fase 9) NO comparte el token de Hermes — no podría aunque se quisiera:
  Telegram solo admite un consumidor de updates por token. SEC-1.1 a SEC-1.3
  aplican igual y por separado: allowlist propia y obligatoria (el proceso no
  arranca sin ella, verificado con test), y su token es un secreto de primer
  nivel.

  Lo que **no** tiene, deliberadamente, porque ingiere texto de Telegram igual
  que hermes: `CLAUDE_CODE_RUNNER_AUTH_TOKEN` (ese token autentica también
  `/mcp`, que lanza contenedores), puertos publicados, y acceso a workspaces o
  artefactos. Su única capacidad es hacer SELECTs agregados contra Postgres y
  hablar con `api.telegram.org` — **y, desde la Fase 15 (ver SEC-1.6 abajo),
  una excepción más, acotada en código.** Es la aplicación del mismo
  razonamiento de SEC-2.1: el componente expuesto a texto no confiable recibe
  el mínimo, no la comodidad — SEC-1.6 es la única grieta deliberada en esa
  regla, y se declara como tal.

  - _Excepción declarada, añadida con `/cron`_: el contenedor monta
    `$HERMES_HOME/cron` en **solo lectura** y corre con el **uid de hermes**
    (10000) en vez del suyo propio (10003). No es comodidad: hermes-agent
    escribe `cron/jobs.json` con modo 0600 y **lo reescribe restaurando ese
    modo en cada tick** del scheduler — verificado a mano, un `chmod 644` vuelve
    a 600 en la siguiente edición — y no hay `setfacl` disponible ni en el host
    ni en las imágenes. Compartir uid es lo único que sobrevive a un
    redespliegue.
  - _Qué NO se amplía_: se monta el subdirectorio `cron`, **no**
    `$HERMES_HOME`. `auth.json` (token OAuth de Claude) no está en ese árbol y
    sigue siendo inalcanzable. En Linux el uid no concede nada por sí solo:
    solo da acceso a ficheros alcanzables, y aquí lo alcanzable es un
    directorio `:ro`.
  - _Qué SÍ se amplía, dicho sin adornos_: `cron/output/` cuelga de ese mismo
    directorio y contiene transcripts completos de las ejecuciones del cron.
    Ningún camino del código los lee — solo se abre `jobs.json` — pero son
    alcanzables desde ese contenedor. Lo que hace el riesgo aceptable es que
    **este bot no tiene modelo**: ejecuta un registro fijo de comandos
    (`COMMANDS` en `apps/control-bot/src/commands.ts`) y no interpreta lenguaje
    natural, así que no hay agente al que convencer de leer otra cosa. Si algún
    día se le añadiera un modelo, esta excepción deja de ser defendible y hay
    que sustituirla por un endpoint HTTP acotado.

- **SEC-1.6 — El bot de control monta el socket de Docker desde la Fase 15
  (US-15.2), acotado en código, no en el socket.** `/modelo` necesita cambiar
  el eslabón activo del agent loop y reiniciar el contenedor de Hermes para
  que lo cargue — el gateway solo lee `config.yaml` al arrancar (mismo
  hallazgo operacional de las Fases 2/13). No hay forma de conseguir eso sin
  hablar con el demonio de Docker.

  - _Qué grado de acceso implica esto, sin adornarlo_: el socket de Docker es
    la llave maestra del host (SEC-1) — quien lo tiene puede en principio
    lanzar un contenedor con `/` del host montado y hacer cualquier cosa. Este
    componente, que ingiere texto de Telegram sin modelo de por medio pero
    igualmente expuesto a cualquiera que descubra el bot y esté en la
    allowlist, pasa a tener esa capacidad si se compromete.
  - _Qué lo mantiene acotado_: **no el socket — el código.**
    `apps/control-bot/src/docker.ts` es el único lugar del proceso que lo
    toca, y solo sabe hacer tres cosas, siempre contra un único contenedor por
    nombre fijo (`CONTROL_BOT_HERMES_CONTAINER_NAME`): leer el modelo activo
    (`hermes config show`, de solo lectura), cambiarlo (`hermes config set
model.provider|model.default`), y reiniciar ese contenedor. Nunca un
    comando arbitrario, nunca `docker run`/`createContainer`, nunca otro
    contenedor. Mismo patrón ya aceptado para `claude-code-runner-mcp` en
    SEC-2.1 y SEC-4.1, aplicado aquí por segunda vez a un componente distinto.
  - _Por qué el valor a cambiar no es libre_: el alias que acepta `/modelo`
    se valida contra `CONTROL_BOT_MODEL_CHOICES`, una lista **declarada** al
    desplegar — mismo patrón que `CONTROL_BOT_PROVIDER_PROBES` para
    `/proveedores` — nunca contra la cadena viva de `fallback_providers`
    (que vive en `config.yaml`, dentro del volumen con `auth.json` que este
    bot sigue sin montar). Un alias que no está en esa lista no toca nada.
  - _Por qué `hermes config show` es seguro de exponer_: verificado contra el
    despliegue real, no asumido — redacta las claves API (`sk-a...gAAA`) y no
    incluye la sección de servidores MCP, así que los tokens de Jira/Notion/
    GitHub que viven embebidos en `config.yaml` (hallazgo de la Fase 14,
    `mcp_servers.*.env.*`) nunca pasan por este camino.
  - _Usuario del contenedor_: pasó de no-root (uid 10003, dedicado) a **root**
    — mismo razonamiento ya documentado en
    `apps/claude-code-runner-mcp/Dockerfile` para el mismo caso: con el socket
    de Docker montado, un uid no-root no reduce ese poder en ninguna medida
    real, solo daría una falsa sensación de contención.
  - _Auditoría_: cada cambio queda en `control_bot.model_changes` (Postgres),
    con timestamp — visible por `/modelo` sin argumento (US-15.4). Se escribe
    **antes** de reiniciar el contenedor, para que quede rastro de qué se pidió
    incluso si el reinicio se cuelga.

- **SEC-1.4 — El canal de entrada no cambia las garantías.** Una tarea que llega
  por Telegram pasa exactamente por el mismo `run_coding_task`, con el mismo
  aislamiento y el mismo rate limiting, que una que llega por una issue de
  GitHub. No hay "ruta rápida" para el Operador.

## 4. Capa 2 — hermes-agent, el componente que lee lo no confiable

hermes-agent es, deliberadamente, el componente **menos** privilegiado de los
que tocan datos externos, porque es el único que ingiere texto arbitrario.

- **SEC-2.1 (innegociable) — El contenedor de hermes-agent NUNCA monta
  `/var/run/docker.sock`.** Es el requisito del que cuelga toda la arquitectura
  (ver §1). Si alguna vez parece necesario montarlo, el diseño está mal.
  - _Verificación_: `docker inspect` del contenedor de hermes no debe listar el
    socket en `HostConfig.Binds`, y desde dentro del contenedor `docker ps` debe
    fallar.

- **SEC-2.2 (innegociable) — Sin `network_mode: host`.** El compose upstream lo
  usa por comodidad; nuestro despliegue lo sustituye por redes de Compose
  acotadas, para que hermes no vea la red doméstica ni los servicios del Mac
  Mini (impresoras, NAS, otros equipos).

- **SEC-2.3 — Aprobación de comandos peligrosos activa.** Se mantiene
  `approvals.mode: manual` y `approvals.cron_mode: deny` (ambos son el valor por
  defecto de hermes-agent, verificado en `hermes_cli/config.py`).
  - _Matiz importante, verificado en `tools/approval.py`_: este mecanismo aplica a
    **comandos de shell**, no a llamadas de tools MCP. Por eso el Skill
    `resolve-issue` debe hacer su trabajo **vía tools MCP** (GitHub MCP,
    `run_coding_task`) y no invocando `gh` por terminal: así corre desatendido en
    cron sin necesidad de relajar `cron_mode`, que se queda en `deny`.
  - _Consecuencia buscada_: si una inyección intenta empujar a hermes a ejecutar
    un comando peligroso de shell durante un cron, se **bloquea** en vez de
    aprobarse sola.

- **SEC-2.4 — Los datos de hermes son sensibles.** El volumen `~/.hermes` contiene
  `.env`, `auth.json`, memorias y sesiones. Se trata como material sensible: no
  se copia a repos, no se sube a backups sin cifrar.

- **SEC-2.5 — Un servidor MCP de passthrough REST no es una superficie acotada.**
  El servidor MCP de Jira (`@aashari/mcp-server-atlassian-jira`) no expone tools
  semánticas sino **cinco verbos HTTP crudos** — `jira_get`, `jira_post`,
  `jira_put`, `jira_patch`, `jira_delete` — sobre toda la API REST del site de
  Atlassian. Es decir: `jira_delete` puede borrar cualquier issue, sprint o
  proyecto de la cuenta, no solo los del proyecto de tareas.
  - _Diferencia con GitHub, que importa_: allí SEC-3.3 acota la superficie
    contándola (`Tools discovered: 1`). Aquí ese conteo no dice nada — cinco
    tools genéricas son más superficie que las veintitantas específicas de
    GitHub. La superficie real no la fija el servidor, la fija el **skill**.
  - _Mitigación_: `resolve-jira-task` declara una allowlist explícita de método
    - endpoint (Regla 1 de su `SKILL.md`) y prohíbe `jira_post` salvo para
      comentar, `jira_patch` y `jira_delete` por completo. Es el mismo patrón que
      `resolve-issue` aplica a `merge_pull_request`/`create_repository`: la tool
      existe, el procedimiento no la usa.
  - _Ampliación (2026-08-27)_: la allowlist ahora incluye
    `GET /rest/api/3/issue/{key}/transitions` (descubrir transiciones, solo
    lectura) y `POST /rest/api/3/issue/{key}/transitions` (ejecutarlas), para
    que el estado visible del ticket refleje la etiqueta que ya se le puso —
    antes solo cambiaba la etiqueta y el tablero de Jira quedaba desactualizado.
    El `POST` está acotado en el propio skill a un cuerpo de una sola forma
    (`{"transition": {"id": "<id>"}}`, con el `id` tomado del `GET` de ese mismo
    ticket en el mismo turno, nunca inventado) — no abre escritura arbitraria
    sobre el ticket, solo mover su estado por el workflow ya configurado.
  - _Límite honesto, declarado y no cerrado_: esto es una restricción **en el
    prompt**, no en el transporte. Un token de API de Atlassian hereda todos los
    permisos del usuario y no admite scoping fine-grained como un PAT de GitHub
    (SEC-6.1), así que no hay forma de imponerlo por debajo del skill. Si una
    inyección consiguiera que hermes llamara a `jira_delete`, nada más abajo lo
    pararía. Se asume como riesgo consciente, acotado a que el site de Atlassian
    es personal y no contiene datos de empresa (misma frontera que SEC-7.x).

## 5. Capa 3 — El canal entre hermes-agent y el runner

Aquí es donde la opción elegida se gana el sueldo: es la frontera entre "lee lo
no confiable" y "tiene la llave maestra".

- **SEC-3.1 (innegociable) — El runner no se publica a la LAN.** Su puerto vive
  únicamente en la red interna de Docker Compose. **No** lleva sección `ports:`
  en el compose, así que no es alcanzable desde otros equipos de la red de casa
  ni desde el propio host salvo a través de la red de Compose.

- **SEC-3.2 (innegociable) — Autenticación en cada petición.** El endpoint MCP
  del runner exige un secreto compartido (cabecera `Authorization: Bearer`),
  distinto de cualquier otro secreto del sistema. Sin él, responde `401` y no
  ejecuta nada. Esto es defensa en profundidad: aunque alguien llegase a la red
  interna, no puede lanzar tareas.

- **SEC-3.3 (innegociable) — Superficie mínima: una sola tool.** El runner expone
  exclusivamente `run_coding_task`, con parámetros tipados y validados (zod). No
  expone, ni expondrá, ninguna tool de propósito general tipo "ejecuta este
  comando" o "lee este fichero". Toda la potencia queda encapsulada detrás de una
  operación con forma fija.
  - _Por qué importa_: aunque hermes esté completamente comprometido por una
    inyección, lo máximo que puede pedir es "resuelve esta tarea en este repo".
    No puede pedir "monta el disco del host".
  - _Alcance exacto, verificado_: el servidor tampoco expone **resources** ni
    **prompts** de MCP, y no debe empezar a hacerlo sin revisar este requisito —
    son superficie adicional, no solo metadatos. Ojo al medirlo: hermes-agent
    muestra "5 tool(s)" para este servidor en su banner, pero cuatro son
    utilidades que **el cliente** añade por su cuenta a todo servidor MCP
    (`list_resources`, `read_resource`, `list_prompts`, `get_prompt`, ver
    `tools/mcp_tool.py::_select_utility_schemas`). La superficie real del
    servidor se mide contra el servidor: `hermes mcp test claude-code-runner` →
    `Tools discovered: 1`, y un cliente MCP directo devuelve exactamente
    `["run_coding_task"]`.

- **SEC-3.4 — El repo de la tarea es un parámetro acotado, no libre.** El Skill
  solo puede lanzar tareas sobre los repos donde el PAT de GitHub tiene permiso
  (ver SEC-5.1). Un `repo` inventado por una inyección falla en el clone.
  - _Caso Jira (Fase 14)_: un issue de GitHub **vive** en un repo, así que su
    `repo` es un hecho de su ubicación y no hay nada que elegir. Un ticket de
    Jira no vive en ninguno, así que ese hecho hay que suplirlo — y ahí es donde
    reaparece el riesgo que este requisito cierra. La única fuente admitida es
    una etiqueta `repo:<owner>/<nombre>` **cotejada contra una allowlist que
    llega en el prompt del cron**, nunca la descripción del ticket ni el nombre
    del proyecto. El PAT sigue siendo la última barrera, pero aquí deja de ser
    la única: la allowlist filtra antes de llegar al clone.

## 6. Capa 4 — El runner, el componente con la llave maestra

- **SEC-4.1 (innegociable) — Es el único con el socket.** Ningún otro contenedor
  del compose lo monta. Ver SEC-2.1.

- **SEC-4.2 (innegociable) — No lee input no confiable para decidir nada.** El
  runner no interpreta el texto de la tarea: lo escribe tal cual en un
  `prompt.md` que consume Claude Code **dentro del contenedor efímero ya
  aislado**. El texto no confiable nunca influye en las decisiones del proceso
  que tiene el socket.

- **SEC-4.3 (innegociable) — Rate limiting activo.** Límite de tareas concurrentes
  y por hora (implementado y verificado en la Fase 1). Protege de dos cosas: un
  bucle accidental (una issue que se reetiqueta sola) y un abuso deliberado que
  agote la ventana de la suscripción Pro — que es **compartida** con el chat de
  hermes, así que agotarla deja mudo al asistente.

- **SEC-4.4 — Directorio de trabajo acotado.** Los checkouts de los repos viven
  bajo una raíz de workspaces dedicada y compartida con el host en la **misma
  ruta** (necesario para que los bind mounts de los contenedores efímeros
  resuelvan bien, ver [hermes/spec.md §3.6](hermes/spec.md#36-nota-de-implementación-rutas-de-workspace-en-despliegue-contenerizado)).
  Esa raíz contiene solo workspaces del proyecto, nunca `$HOME` ni rutas del
  sistema.

## 7. Capa 5 — El contenedor efímero donde corre Claude Code

Esta capa está **implementada y verificada en la Fase 1**; se recoge aquí para
que el modelo esté completo en un solo sitio.

- **SEC-5.1 (innegociable) — Sin socket de Docker.** El contenedor efímero no
  puede lanzar más contenedores. Verificado en Fase 1.
- **SEC-5.2 (innegociable) — Red sin salida libre.** El contenedor va en una red
  Docker `Internal: true` (sin ruta a internet) y solo alcanza el exterior a
  través de un proxy con allowlist (`api.anthropic.com`, `github.com`).
  Verificado en Fase 1: la resolución DNS directa falla, y el proxy rechaza
  destinos fuera de la lista.
- **SEC-5.3 (innegociable) — Usuario no-root** dentro del contenedor.
- **SEC-5.4 (innegociable) — Destrucción garantizada.** El contenedor se elimina
  siempre (`force: true` en un `finally`), termine bien, mal o por timeout.
  Nunca quedan contenedores huérfanos.
- **SEC-5.5 (innegociable) — Timeout duro.** Por defecto 30 minutos.
- **SEC-5.6 — Sin acceso al filesystem del host** más allá del workspace efímero
  de esa tarea concreta.
- **SEC-5.7 — Ampliación de la allowlist de red a `registry.npmjs.org`, analizada
  antes de aplicarse (2026-08-27).** Motivo: cualquier tarea de un proyecto
  Node/JS (p. ej. `WEB`, Next.js) necesita `pnpm install` dentro del sandbox
  para poder verificar sus propios criterios de aceptación (`build`/`lint`/
  `dev`) — sin esto, esas tareas siempre terminan en `needs_human_input` por
  no poder instalar dependencias, verificado con una ejecución real contra
  `WEB-2` (ver [roadmap.md, US-14.9](roadmap.md)).

  **Qué NO cambia**: `FilterDefaultDeny Yes` se mantiene — solo se añade una
  entrada más a `filter.allow`, con la misma sintaxis de FQDN exacto que ya
  usan `api.anthropic.com` y `github.com`. No se abre el registro genérico ni
  un rango de host; ver el criterio de verificación abajo.

  **Riesgo real que sí introduce, analizado con precisión y no en abstracto**:
  `npm`/`pnpm install` puede ejecutar código arbitrario de terceros de forma
  automática, vía los scripts de ciclo de vida (`preinstall`/`postinstall`/
  `prepare`) de cualquier paquete de la cadena de dependencias transitiva —
  para un scaffold de Next.js eso son fácilmente varios cientos de paquetes,
  ninguno revisado por el Operador. Esto es cualitativamente distinto del
  riesgo que ya cubre SEC-5.2: `git clone`/`git push` contra `github.com` no
  ejecuta código de terceros por sí solo; `npm install` sí, por diseño del
  ecosistema.

  **Superficie real dentro de ESTE sandbox, no genérica** — leído del código
  real (`runContainer.ts`), no asumido: el contenedor efímero de la tarea
  **no** lleva `GITHUB_TOKEN` (deliberado, ver el comentario del propio
  fichero — Claude Code lo tendría si lo necesitara para saltarse el flujo de
  PR). Sí lleva `CLAUDE_CODE_OAUTH_TOKEN` — la credencial más sensible del
  sistema entero, la misma sesión Pro compartida de la Fase 12 — y `github.com`
  y `api.anthropic.com` ya son alcanzables. Un script de instalación
  malicioso no puede escribir en repos ajenos (no tiene el PAT), pero sí
  podría, en teoría, leer `CLAUDE_CODE_OAUTH_TOKEN` del entorno del proceso y
  usarlo contra `api.anthropic.com` directamente — el mismo host que ya
  necesita Claude Code para funcionar, así que no es una ruta de red nueva,
  es un **actor nuevo** (cualquier dependencia transitiva) operando dentro de
  la misma frontera de confianza que ya tenía Claude Code. La allowlist
  estricta del proxy sigue cerrando la vía de exfiltración más común
  (mandar datos a un host propio del atacante): eso sigue bloqueado porque
  ese host no está ni estará en `filter.allow`.

  **Mitigaciones aplicadas, no solo recomendadas** — enforzadas por
  configuración en la imagen del contenedor efímero, nunca dependientes de que
  el prompt se acuerde de pedirlas:
  1. `ignore-scripts=true` en un `.npmrc` global de la imagen — desactiva
     `preinstall`/`postinstall`/`prepare` de **todas** las dependencias, no
     solo las del proyecto. Es la mitigación que de verdad importa: corta el
     vector de ejecución automática de código, no solo el de red. Coste
     aceptado: algún paquete que de verdad necesite un postinstall (poco común
     en un stack Next.js/Tailwind/ESLint puro JS; `next` resuelve sus binarios
     de `@next/swc-*` como dependencias opcionales normales, no vía script) no
     terminará de instalarse — se trata como una excepción a revisar caso por
     caso si ocurre, no como motivo para desactivar la protección por defecto.
  2. `NEXT_TELEMETRY_DISABLED=1` en el entorno del contenedor — corta una
     llamada de red de salida que Next.js hace por defecto y que no aporta
     nada a la tarea, reduciendo tráfico no esencial hacia fuera del sandbox
     (mismo espíritu que `DisableViaHeader`/`FilterDefaultDeny` del proxy).
  3. **Alcance mínimo del FQDN**: solo `registry.npmjs.org`, no un dominio
     comodín. Si en el futuro hiciera falta otro host (p. ej. un CDN de
     binarios de algún paquete concreto), se añade cuando el fallo real lo
     pida — no de forma preventiva.

  **Lo que este análisis NO cubre, declarado sin maquillar**: un paquete
  malicioso con scripts ignorados podría aun así intentar dañar el propio
  workspace (contenido que termina en un commit) — pero ese commit vive en
  una rama `hermes/...` que **nunca se mergea sola**; el PR sigue pasando por
  la revisión del Operador antes de llegar a `main`, que es la última barrera
  real (mismo patrón que security.md ya asume para el propio código que
  escribe Claude Code, sea o no honesto el ticket que lo motivó).

## 8. Capa 6 — Credenciales

- **SEC-6.1 (innegociable) — PAT de GitHub fine-grained y de mínimo privilegio.**
  Limitado a los repos donde Hermes debe actuar, con los permisos justos
  (contenidos, issues, pull requests). Nunca un token clásico de cuenta completa.
- **SEC-6.2 (innegociable) — Ningún secreto en git ni en imágenes.** Todos viven
  en `.env` fuera del repositorio y se inyectan como variables de entorno. No se
  hornean en ningún `Dockerfile` ni se escriben a disco dentro de un contenedor.
- **SEC-6.3 (innegociable) — Redacción en logs y errores.** Cualquier token
  embebido en una URL (p. ej. `x-access-token:...@github.com` en un clone o push)
  se redacta antes de propagar mensajes de error. Implementado y verificado en la
  Fase 1, tras detectarse el riesgo en una prueba real.
- **SEC-6.4 — Un secreto, un propósito.** El secreto del canal MCP (SEC-3.2) es
  distinto del token de GitHub, del de Telegram y del de Claude. Comprometer uno
  no debe dar los otros.
- **SEC-6.5 — Reautenticación manual.** Cuando la sesión de Claude Code expira o
  es revocada, se renueva a mano. **No se automatiza** la extracción de tokens
  (ver [hermes/spec.md §3.3](hermes/spec.md#33-limitación-conocida-expiración-o-revocación-de-sesión)).

## 9. Capa 7 — Aislamiento entre instancia personal y de trabajo (Fase 10 de v2)

Esta capa solo aplica **si y cuando** se construya la [Fase 10 del roadmap](roadmap.md#fase-10--despliegue-dual-instancia-personal-vs-instancia-de-trabajo) (Azure DevOps u otra fuente de la empresa del Operador). No existe en v1. Se recoge aquí, con numeración propia, para que la decisión de aislamiento no dependa de que alguien se acuerde de leer el roadmap el día que se implemente.

El principio de fondo es el mismo que en §0, aplicado a un límite distinto: **el riesgo que el Operador acepta para sí mismo (§0.2, ToS de la sesión Pro) no se traslada por defecto a datos o credenciales de su empleador.**

- **SEC-7.1 (innegociable) — Despliegues físicamente separados.** La instancia
  "Hermes trabajo" corre en su propio `docker compose` (propio `docker-compose.yml`,
  propia red Docker, propio volumen de estado). **No** comparte red Docker,
  volumen, ni proceso con la instancia personal — ni siquiera si ambas viven en
  el mismo Mac Mini. Un contenedor de una instancia no debe poder alcanzar por
  red a un contenedor de la otra.
  - _Verificación_: `docker network inspect` de la red de cada instancia no debe
    listar contenedores de la otra; `docker exec` en un contenedor de la
    instancia de trabajo no debe poder resolver ni alcanzar por nombre ningún
    servicio de la instancia personal (y viceversa).

- **SEC-7.2 (innegociable) — Sin autenticación de Anthropic compartida.** La
  instancia de trabajo **nunca** usa `hermes-claude-auth` (el token OAuth de la
  suscripción Pro personal, §0.1). Usa su propio mecanismo de auth con
  Anthropic — API key facturada normalmente, o lo que la empresa del Operador
  autorice explícitamente. Mezclar aquí no es solo un problema de aislamiento
  técnico: es extender un riesgo de ToS aceptado a título personal (§0.2) a
  código y datos de un tercero (el empleador) sin su consentimiento informado.

- **SEC-7.3 (innegociable) — Credenciales de empresa en su propio secreto,
  nunca en el `.env` personal.** El token/credencial de Azure DevOps (y
  cualquier GitHub/GitLab de la empresa) vive exclusivamente en el `.env` de la
  instancia de trabajo. No se copian a `hermes/docker/.env` (personal) "para no
  tener que levantar otro compose", ni se meten como credencial adicional del
  runner personal.

- **SEC-7.4 (innegociable) — Bot de Telegram y allowlist propios.** La
  instancia de trabajo registra su propio `TELEGRAM_BOT_TOKEN` y su propio
  `TELEGRAM_ALLOWED_USERS` (SEC-1.1–SEC-1.3 aplican igual, por instancia). Un
  mismo bot de Telegram no sirve a las dos instancias.

- **SEC-7.5 — Confirmación explícita de política de empresa antes de
  desplegar.** Antes de que la instancia de trabajo procese cualquier dato o
  credencial real de la empresa del Operador, el Operador confirma qué permite
  la política de seguridad/IT de su empleador (uso de infraestructura personal,
  qué proveedor de modelo está autorizado, etc.). No es un requisito verificable
  en código — es una condición de gobernanza que precede a la implementación, y
  se deja constancia de ella (fecha, con quién se confirmó) antes de escribir la
  primera línea de este despliegue.

## 10. Lo que este modelo NO protege — léelo

Un modelo de seguridad que no enumera sus límites es propaganda. Estos riesgos
quedan **aceptados conscientemente**:

- **Filtración de los secretos que hermes necesita.** Si una inyección compromete
  a hermes-agent, los tokens que tiene a mano (GitHub, Telegram, Claude, y el
  secreto del canal MCP) pueden exfiltrarse. La arquitectura limita el radio de
  daño al contenedor de hermes — **evita perder el Mac Mini, no evita perder esos
  tokens**. Mitigación práctica: que el PAT de GitHub sea de mínimo privilegio
  (SEC-6.1), para que filtrarlo no equivalga a perder la cuenta.
- **Código malicioso escrito por Claude Code.** Si una inyección consigue que
  Claude Code escriba código dañino, ese código llega a un **PR**, no a `main`.
  La revisión humana del PR antes de mergear es parte del modelo de seguridad, no
  un detalle de proceso ([hermes/spec.md §2](hermes/spec.md#2-no-objetivos-v1)).
- **Riesgo de Términos de Servicio.** El uso del token OAuth de la suscripción Pro
  fuera del cliente oficial viola los ToS de consumidor de Anthropic, con riesgo
  de suspensión de la cuenta entera. Asumido explícitamente en
  [hermes/spec.md §0.2](hermes/spec.md#02-nota-de-riesgo--léela-antes-de-desplegar).
- **Disponibilidad.** El sistema depende de la luz y la red de casa. No hay alta
  disponibilidad y no se pretende.
- **Compromiso del propio Mac Mini por otra vía.** Este modelo protege el equipo
  de _este_ sistema; no es un endurecimiento general del Mac Mini.

## 11. Checklist de verificación por fase

Ninguna fase se cierra sin ejecutar estas comprobaciones **de verdad**, con
evidencia pegada en el roadmap.

| Fase          | Requisitos a verificar                                                                   |
| ------------- | ---------------------------------------------------------------------------------------- |
| 1 (hecha)     | SEC-4.3, SEC-5.1 – SEC-5.6, SEC-6.3                                                      |
| 2             | SEC-2.1, SEC-2.2, SEC-2.3, SEC-3.1, SEC-3.2, SEC-3.3, SEC-4.1, SEC-4.4, SEC-6.1, SEC-6.2 |
| 3             | SEC-0.1, SEC-0.2, SEC-0.3, SEC-1.1, SEC-1.2, SEC-1.3, SEC-1.4                            |
| 9             | SEC-1.5, en cuanto el bot de control esté desplegado                                     |
| 14            | SEC-2.5, SEC-3.4 (variante Jira), SEC-4.3                                                |
| 14 (WEB)      | SEC-5.7, ampliación del proxy del sandbox a `registry.npmjs.org`                         |
| 15            | SEC-1.6, socket de Docker acotado en código para `/modelo`                               |
| 4–5           | Revisión de que Brain no reintroduce superficie (API solo en red interna, token propio)  |
| Fase 10 de v2 | SEC-7.1 – SEC-7.5, en cuanto exista una instancia "Hermes trabajo"                       |
