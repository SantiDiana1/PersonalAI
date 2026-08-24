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

## 9. Capa 7 — Aislamiento entre instancia personal y de trabajo (Fase 8 de v2)

Esta capa solo aplica **si y cuando** se construya la [Fase 8 del roadmap](roadmap.md#fase-8--despliegue-dual-instancia-personal-vs-instancia-de-trabajo) (Azure DevOps u otra fuente de la empresa del Operador). No existe en v1. Se recoge aquí, con numeración propia, para que la decisión de aislamiento no dependa de que alguien se acuerde de leer el roadmap el día que se implemente.

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

| Fase         | Requisitos a verificar                                                                   |
| ------------ | ---------------------------------------------------------------------------------------- |
| 1 (hecha)    | SEC-4.3, SEC-5.1 – SEC-5.6, SEC-6.3                                                      |
| 2            | SEC-2.1, SEC-2.2, SEC-2.3, SEC-3.1, SEC-3.2, SEC-3.3, SEC-4.1, SEC-4.4, SEC-6.1, SEC-6.2 |
| 3            | SEC-0.1, SEC-0.2, SEC-0.3, SEC-1.1, SEC-1.2, SEC-1.3, SEC-1.4                            |
| 4–5          | Revisión de que Brain no reintroduce superficie (API solo en red interna, token propio)  |
| Fase 8 de v2 | SEC-7.1 – SEC-7.5, en cuanto exista una instancia "Hermes trabajo"                       |
