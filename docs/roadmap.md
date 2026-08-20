# Roadmap y User Stories — PersonalAI

> Documento _spec-driven_: cada fase es una unidad de trabajo autocontenida con objetivo, user stories, criterios de aceptación y Definition of Done. La idea es que Claude Code (u otro coding agent) pueda coger **una fase entera** y saber exactamente qué construir y cuándo darla por terminada, sin tener que interpretar prosa suelta.

Filosofía (tomada del artículo de referencia sobre "company brain"): **no intentes modelar todo el sistema de golpe**. Se construye primero el workflow más estrecho posible de cada proyecto, se valida, y solo entonces se integra y se amplía. Cada fase deja algo demostrable, aunque sea a nivel de portfolio/demo.

Recordatorio: "Hermes" = [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) desplegado y extendido vía MCP/skills, no un orquestador propio (ver [hermes/spec.md §0](hermes/spec.md#0-aclaración-importante-qué-es-hermes-aquí)). Y ojo: el modelo de autenticación de Claude Code elegido (token OAuth de larga duración compartido, [hermes/spec.md §0.1–0.3](hermes/spec.md#01-autenticación-token-oauth-de-larga-duración-para-todo-vía-suscripción-pro)) viola los ToS de consumidor de Anthropic y se asume como riesgo consciente — varias fases de abajo lo referencian explícitamente donde aplica.

> **Seguridad**: los requisitos innegociables del proyecto viven en [security.md](security.md), numerados (`SEC-x.y`) y organizados por capas. Cada fase de abajo declara cuáles le aplican y no se cierra sin verificarlos con evidencia real. Si un requisito estorba, se cambia `security.md` explícitamente — no se ignora en silencio.

> **Decisión de alcance (tomada tras la Fase 0)**: este proyecto **no construye la capa de consolidación de Brain** (extracción de observations vía LLM, reconciliación de contradicciones, mental models). Brain se mantiene deliberadamente **básico** — ingestión + búsqueda por similitud semántica, nada más — durante todo el proyecto. La capa de consolidación queda diseñada y documentada en [personal-brain/spec.md](personal-brain/spec.md) como trabajo futuro que el Operador construirá por su cuenta más adelante, fuera de este roadmap. Las fases tempranas priorizan Hermes + el despliegue en local; Brain aparece pronto pero deliberadamente pequeño.

## Milestone v1 — qué es la "primera versión"

Este proyecto es, ante todo, mi sistema de IA personal — backed by Claude Code, desplegado en un servidor local (Mac Mini, ver [architecture.md §Despliegue](architecture.md#despliegue)). v1 es la primera versión **utilizable de verdad para uso personal**, no un portfolio pulido. Se considera cumplido cuando las **Fases 0 a 5** están terminadas:

- Hermes desplegado en local, resolviendo issues de GitHub etiquetadas de principio a fin, sin intervención manual (Fase 2).
- Hermes hablable desde Telegram: puedo mandarle una tarea ad-hoc por chat, me confirma que la ha aceptado, y me avisa con el resultado cuando termina (Fase 3).
- Brain básico (ingesta + búsqueda semántica, sin consolidación) integrado vía `brain-mcp` y consultado antes de actuar tanto en el flujo de GitHub como en el conversacional de Telegram (Fase 4, Fase 5).

Todo lo que no está en esas 6 fases — Notion/Jira, pulido de portfolio, Company Brain completo (consolidación real), otros canales de mensajería, notificaciones proactivas, GitHub App, etc. — es explícitamente **post-v1**. Vive en la sección [Futuribles](#futuribles-post-v1) al final de este documento y **no bloquea** el hito de v1: son ideas para retomar después, con prioridad a decidir más adelante, no compromisos de este roadmap.

## Cómo leer este documento

Cada fase tiene la misma estructura:

- **Objetivo** — qué demuestra esta fase en una frase.
- **Depende de** — qué fase(s) tienen que estar terminadas antes.
- **User stories** — formato `Como <rol>, quiero <acción>, para <razón>`, con un ID (`US-<fase>.<n>`) para poder referenciarlas desde código/commits/PRs.
- **Criterios de aceptación** — checklist verificable por cada story (si no se puede marcar como hecho/no hecho, la historia está mal escrita).
- **Tareas técnicas** — el "cómo", a alto nivel (implementación real delegada al spec del componente correspondiente).
- **Definition of Done** — qué tiene que ser cierto para cerrar la fase completa.

Roles usados en las stories: **Operador** (yo, dueño único del sistema), **Hermes** (la instancia de hermes-agent desplegada, actuando como agente), **Sistema** (comportamiento automático sin actor humano), **Reclutador/cliente** (consumidor externo del portfolio, solo aparece en los futuribles de pulido de portfolio).

## Vista general

| Fase | Nombre                                                 | Objetivo en una frase                                                                        | Depende de   |
| ---- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------ |
| 0    | Fundación del monorepo + auth compartida               | Monorepo instalable + sesión de Claude Pro compartida lista para usarse                      | —            |
| 1    | `claude-code-runner-mcp` en solitario                  | Puedo delegar una tarea de código a Claude Code en un contenedor aislado, sin Hermes todavía | Fase 0       |
| 2    | hermes-agent en local + Skill `resolve-issue` (GitHub) | Etiqueto una issue y Hermes abre un PR sin que yo haga nada más                              | Fase 0, 1    |
| 3    | Interacción conversacional vía Telegram                | Le mando una tarea a Hermes por Telegram y me avisa cuando termina                           | Fase 2       |
| 4    | Brain básico (ingest + retrieval)                      | Puedo preguntarle algo a Brain y me devuelve el fragmento relevante                          | Fase 0       |
| 5    | Integrar Brain vía `brain-mcp`                         | Hermes resuelve tareas mejor (GitHub y Telegram) porque consulta a Brain antes de actuar     | Fase 2, 3, 4 |

**Milestone v1 = Fases 0 a 5.** Ver la sección [Futuribles](#futuribles-post-v1) al final de este documento para consolidación real de Brain, Notion/Jira, pulido de portfolio, y otras ideas post-v1 — ninguna de ellas bloquea v1.

---

## Fase 0 — Fundación del monorepo + autenticación compartida

**Objetivo**: tener el monorepo scaffolded, instalable, con CI en verde, y la sesión de Claude Pro compartida (`hermes-claude-auth`) generada y verificada — es el prerrequisito de todo lo demás.

**Depende de**: —

**Estado: completada.**

### User stories

- **US-0.1** — Como Operador, quiero un monorepo con `apps/brain`, `apps/brain-mcp`, `apps/claude-code-runner-mcp` y `packages/shared` scaffolded con pnpm workspaces + TypeScript, para tener una base común antes de escribir lógica de negocio.
  - [x] `pnpm install && pnpm build` funciona sin errores en los cuatro paquetes (vacíos o con un "hello world" tipado). Verificado: `pnpm install --frozen-lockfile` + `pnpm build` en verde para los 4 paquetes.
  - [x] ESLint + Prettier configurados y compartidos entre paquetes. Verificado: `pnpm lint` y `pnpm format:check` en verde sin warnings.
  - [x] CI (GitHub Actions) corre build + typecheck + test en cada push y está en verde. `.github/workflows/ci.yml` creado (install, lint, format:check, typecheck, build, test); pusheado en `feat/phase0`.
- **US-0.2** — Como Operador, quiero `docker-compose.dev.yml` levantando Postgres con `pgvector` en local, para desarrollar Brain sin depender del despliegue completo del servidor local.
  - [x] `docker compose -f docker-compose.dev.yml up` deja Postgres accesible en local con la extensión `vector` instalada. Verificado: contenedor `healthy`, `pg_extension` confirma `vector 0.8.6`, smoke test de tabla con columna `vector(3)` (CREATE/INSERT/SELECT/DROP) correcto.
- **US-0.3** — Como Operador, quiero instalar hermes-agent localmente y explorar su configuración, formato de skills (`skills/`, `optional-skills/`) y mecanismo de registro de MCP servers, para diseñar con datos reales el detalle fino de las tools de la Fase 1 y 2.
  - [x] hermes-agent corre localmente en modo CLI (`hermes`) tras el instalador oficial. Verificado: `hermes --version` (v0.11.0), `hermes status` con proyecto/env/modelo detectados correctamente.
  - [x] Documentado (nota interna, no hace falta un `.md` de portfolio) el formato exacto de un skill y de `hermes mcp add`. Ver `docs/hermes/exploration-notes.md`, con evidencia real del checkout de hermes-agent (formato de `SKILL.md`, sintaxis de `hermes mcp add`, `hermes cron`).
- **US-0.4** — Como Operador, quiero generar el secreto persistente `hermes-claude-auth` (token de larga duración vía `claude setup-token` en el host) y verificar que es válido, para que tanto hermes-agent como `claude-code-runner-mcp` puedan heredarlo más adelante sin gestionar API keys de Anthropic.
  - [x] Secreto `hermes-claude-auth` generado (`claude setup-token`) y guardado como `CLAUDE_CODE_OAUTH_TOKEN` en `.env` fuera de git. **Nota**: el diseño original de esta historia asumía un volumen Docker con archivos de sesión montado read-only; verificado en la práctica que `claude setup-token` no persiste ningún archivo — imprime un token que se inyecta como variable de entorno. Corregido en [hermes/spec.md §0.3](hermes/spec.md#03-corrección-de-diseño--hermes-claude-auth-es-un-token-no-un-volumen-de-archivos).
  - [x] Verificado que la sesión es utilizable: `docker run --env-file .env ... claude -p "..."` responde correctamente, sin exponer el token en ningún log.
  - [x] Leído y entendido [hermes/spec.md §0.2](hermes/spec.md#02-nota-de-riesgo--léela-antes-de-desplegar) (riesgo de ToS) antes de continuar — confirmado explícitamente por el Operador antes de generar el token.

### Tareas técnicas

- Scaffolding pnpm workspaces, tsconfig base compartido, ESLint/Prettier.
- Workflow de GitHub Actions mínimo (`build`, `typecheck`, `test`).
- `docker-compose.dev.yml` con `pgvector/pgvector` como imagen base de Postgres.
- Instalación local de hermes-agent + exploración de su código fuente (no se toca todavía, solo se lee).
- `claude setup-token` en el host + secreto guardado en `.env`.

### Definition of Done

Monorepo instalable con CI verde, Postgres+pgvector disponible en local, hermes-agent corriendo en local en modo CLI, y la sesión Pro compartida generada y verificada — con el riesgo de ToS explícitamente aceptado por el Operador antes de avanzar a la Fase 1/2. **Cumplida** — ver evidencia en cada checklist de arriba y en los commits de `feat/phase0`.

---

## Fase 1 — `claude-code-runner-mcp` en solitario

**Objetivo**: poder delegar una tarea de código a Claude Code, aislado en un contenedor Docker efímero, invocado directamente como servidor MCP (todavía sin hermes-agent en el bucle).

**Depende de**: Fase 0 (en particular, `hermes-claude-auth` de US-0.4).

**Seguridad**: esta fase cubrió SEC-4.3 y SEC-5.1 – SEC-5.6 de [security.md](security.md) (aislamiento del contenedor efímero y rate limiting), más SEC-6.3 (redacción de secretos en logs), que se añadió tras detectar el riesgo en una prueba real de clonado de repo privado.

**Estado: completada.**

### User stories

- **US-1.1** — Como Operador, quiero invocar la tool MCP `run_coding_task(repo, taskTitle, taskDescription, ...)` desde un cliente MCP de prueba, para validar el ciclo completo antes de conectarlo a hermes-agent.
  - [x] La tool clona el repo indicado (shallow), lanza un contenedor Docker con Claude Code CLI, ejecuta `claude -p` de forma no interactiva, y devuelve `{ status, branchName?, commitShas?, summary, logsUrl? }`. Verificado invocando `runCodingTask` contra un repo local: clona, monta `/workspace`, crea rama `hermes/<ts>-<slug>`, ejecuta `claude -p` en el contenedor y devuelve el output tipado.
  - [x] El contenedor hereda la sesión de `hermes-claude-auth` vía `CLAUDE_CODE_OAUTH_TOKEN` inyectada como variable de entorno, sin recibir ninguna `ANTHROPIC_API_KEY`. Verificado en `src/docker/runContainer.ts` (única variable de auth inyectada) y por inspección del log del contenedor.
  - [x] El contenedor se destruye (`docker rm -f`) tanto en éxito como en fallo o timeout — verificado que no quedan contenedores huérfanos tras varias ejecuciones. Verificado con `docker ps -a --filter ancestor=...` vacío tras ejecuciones de éxito simulado, fallo de auth y timeout forzado (imagen de prueba con `sleep 300`, `timeoutSeconds: 2` → `timedOut: true`, contenedor eliminado).
- **US-1.2** — Como Sistema, quiero comprobar la validez de la sesión de Claude Code antes de lanzar cada contenedor, para devolver `needs_human_input` de forma inmediata si la sesión expiró o fue revocada, en vez de lanzar un contenedor que fallará igualmente.
  - [x] Si la sesión no es válida, la tool responde `status: 'needs_human_input'` sin llegar a hacer `docker run`. Verificado con un token inválido real: `run_coding_task` devuelve `needs_human_input` y no hay clon de repo ni contenedor de tarea (solo el contenedor efímero de comprobación, eliminado tras el chequeo).
  - [x] El `summary` distingue "sesión expirada" de "sesión rechazada por el servidor (posible revocación)" cuando sea posible. `classifySessionCheck` (`src/session.ts`) aplica una heurística sobre el mensaje real de `claude` (verificado con un token inválido real: `API Error: 401 OAuth access token is invalid` → clasificado como `expired`); testeada con 3 casos en `src/session.test.ts`.
- **US-1.3** — Como Operador, quiero que el contenedor de ejecución no tenga acceso al socket de Docker del host ni red libre, para limitar el radio de impacto de un prompt malicioso proveniente de una issue de terceros.
  - [x] Verificado manualmente que desde dentro del contenedor no se puede alcanzar el Docker socket ni hacer peticiones a dominios fuera de la allowlist (`api.anthropic.com`, `github.com`). Implementado con dos redes Docker (`claude-code-runner-internal`, `internal: true`, sin ruta a Internet + `claude-code-runner-egress`) y un proxy de allowlist (`claude-code-runner-proxy`, tinyproxy + `filter.allow`), ver `src/docker/network.ts` y `docker/proxy/`. Verificado: (1) `docker run --network claude-code-runner-internal curl https://example.com` sin proxy → `Could not resolve host` (sin ruta directa); (2) `ls /var/run/docker.sock` dentro de `claude-code-runner-image` → `No such file or directory`; (3) vía el proxy, `https://github.com` → `200`, `https://example.com` → `403` (bloqueado por `FilterDefaultDeny`). El aislamiento está activado por defecto en `runCodingTask`/`checkSessionValid` (`ensureIsolation()`), no es opt-in.
  - [x] Las credenciales de GitHub inyectadas están scoped al repo concreto de la tarea (nunca un token de cuenta completa). El `githubToken` se inyecta tal cual lo recibe la tool (nunca se persiste a disco, se redacta del logger — `src/logger.ts`); scoping real es responsabilidad operacional del Operador al generar el PAT fine-grained/GitHub App (ver `docs/hermes/spec.md §6`), no verificable en código sin credenciales reales.
- **US-1.4** — Como Operador, quiero un límite de tareas concurrentes/por hora configurable, para no agotar la ventana de 5h/semanal de la cuenta Pro compartida con hermes-agent.
  - [x] Un intento de superar el límite configurado se rechaza (o se encola) en vez de lanzar un contenedor adicional. `RateLimiter` (`src/rateLimit.ts`, configurable vía `CLAUDE_CODE_RUNNER_MAX_CONCURRENT`/`CLAUDE_CODE_RUNNER_MAX_PER_HOUR`) se consulta justo antes de `runTaskContainer`; si no hay hueco, `run_coding_task` devuelve `needs_human_input` sin lanzar contenedor. Verificado con un test de integración (`src/rateLimit.integration.test.ts`, Docker mockeado) que lanza dos tareas en paralelo con `maxConcurrent: 1`: una se rechaza sin invocar `runTaskContainer` (`toHaveBeenCalledTimes(1)`), y tras liberar el slot una tercera tarea sí se lanza.

### Tareas técnicas

- `apps/claude-code-runner-mcp`: SDK MCP oficial + `dockerode`.
- Imagen `claude-code-runner-image` (Node.js + git + Claude Code CLI, sin credenciales horneadas).
- Generación de `prompt.md` a partir de los inputs de la tool.
- Chequeo de sesión (`claude -p` con un prompt corto, o equivalente) antes de cada `docker run`.
- Postgres, esquema `runner`, tabla `task_runs` (ver [hermes/spec.md §7](hermes/spec.md#7-modelo-de-datos)).

### Definition of Done

Puedo invocar `run_coding_task` manualmente contra un repo real y obtener una rama con cambios generados por Claude Code, con aislamiento verificado y manejo explícito de sesión expirada/revocada. hermes-agent todavía no está en el bucle. **Cumplida** — verificado con dos ejecuciones reales (token OAuth y PAT de GitHub reales) contra `SantiDiana1/PersonalAI`:

- Contra `main` (sin `docs/`): `claude` razonó correctamente que la tarea era irrealizable sin salirse de alcance y devolvió `needs_human_input` con una explicación clara, en vez de improvisar — confirma el camino de "tarea ambigua" del prompt.
- Contra `feat/phase0` (con `docs/roadmap.md`): `status: 'success'`, un único commit (`8c80ceef...`, autor `Hermes (claude-code-runner)`) con exactamente el cambio pedido, rama `hermes/<ts>-e2e-fase-1-...` empujada de verdad al repo privado (confirmado con `git ls-remote` y `git fetch`+`git diff` — solo se tocó la línea pedida, ningún otro archivo).
- Corrigió dos bugs reales descubiertos por esta prueba: el clon (host-side) no soportaba repos privados (le faltaba el token embebido en la URL), y el PAT inicial del Operador tenía permiso `Contents: Read` en vez de `Read and write`. Ambos arreglados y sus mensajes de error saneados para nunca filtrar el token en logs.

---

## Fase 2 — Desplegar hermes-agent en local + Skill `resolve-issue` (solo GitHub)

**Objetivo**: primera demo end-to-end — etiquetar una issue real y ver a Hermes abrir un PR, sin Brain todavía.

**Depende de**: Fase 0, Fase 1.

**Seguridad**: esta fase debe verificar SEC-2.1, SEC-2.2, SEC-2.3, SEC-3.1, SEC-3.2, SEC-3.3, SEC-4.1, SEC-4.4, SEC-6.1 y SEC-6.2 de [security.md](security.md). Ninguna US se marca completa sin la evidencia correspondiente.

**Decisión de arquitectura (tomada al empezar la fase)**: hermes-agent y `claude-code-runner-mcp` corren en **contenedores separados**, y solo el runner monta el socket de Docker. Motivo: en Docker, poder crear contenedores equivale a control total del host, y hermes-agent es el componente que ingiere texto no confiable (cuerpos de issues). Registrar el runner por stdio lo convertiría en subproceso de hermes y obligaría a darle el socket a hermes — descartado. Ver [security.md §1](security.md#1-el-concepto-central-el-socket-de-docker-es-la-llave-maestra) y [hermes/spec.md §3.5](hermes/spec.md#35-transporte-mcp-http-en-red-interna-no-stdio).

### User stories

- **US-2.1** — Como Operador, quiero que `claude-code-runner-mcp` se exponga por MCP sobre HTTP autenticado y funcione desde dentro de un contenedor, para poder aislarlo en su propio contenedor sin darle el socket de Docker a hermes-agent.
  - [x] El servidor arranca en modo HTTP (`StreamableHTTPServerTransport`) además de conservar el modo stdio para desarrollo local. Transporte seleccionable con `CLAUDE_CODE_RUNNER_TRANSPORT` (`stdio` por defecto, `http` en despliegue). Verificado con un **cliente MCP real** (`Client` + `StreamableHTTPClientTransport` del SDK oficial): handshake completo, sesión establecida (`Mcp-Session-Id` presente) y `tools/list` correcto.
  - [x] Una petición sin `Authorization: Bearer <secreto>` válida recibe `401` y **no** ejecuta ninguna tarea (SEC-3.2). Verificado con peticiones reales contra el servidor levantado: sin cabecera → `401`; token incorrecto → `401`; token correcto con un carácter de más → `401`; token correcto → `200`. El cuerpo del `401` es un error JSON-RPC genérico (`Unauthorized`) que no distingue "falta cabecera" de "secreto incorrecto". Un cliente MCP real sin credenciales falla al conectar. El secreto se valida **al arrancar** (mínimo 32 caracteres): el proceso no levanta un endpoint cuya autenticación no esté realmente configurada.
  - [x] La raíz de los checkouts es configurable (`CLAUDE_CODE_RUNNER_WORKSPACE_ROOT`) y, montada en la misma ruta en host y contenedor, los bind mounts de los contenedores efímeros resuelven correctamente (SEC-4.4, ver [hermes/spec.md §3.6](hermes/spec.md#36-nota-de-implementación-rutas-de-workspace-en-despliegue-contenerizado)). Verificado ejecutando el mismo escenario desde dentro del contenedor del runner en las **dos** configuraciones: sin raíz compartida, el contenedor hermano recibe un `/workspace` vacío (el fallo es real y silencioso); con la raíz montada en la misma ruta, ve el contenido del checkout. La ejecución de una tarea real completa con el runner contenerizado se verifica en el end-to-end de US-2.4.
  - [x] La superficie MCP sigue siendo exactamente una tool, `run_coding_task` (SEC-3.3). Verificado con `tools/list` desde un cliente MCP real: devuelve exactamente `["run_coding_task"]`, con parámetros `repo`, `baseBranch`, `taskTitle`, `taskDescription`, `brainContext`, `timeoutSeconds` y requeridos `["repo","taskTitle","taskDescription"]`.
  - [x] Imagen Docker del runner (`apps/claude-code-runner-mcp/Dockerfile`, contexto = raíz del monorepo por la dependencia `workspace:*`), con `git`, healthcheck propio y `.dockerignore` que excluye `.env` de forma explícita (SEC-6.2). Verificado: contenedor arranca, `/health` responde y Docker lo marca `healthy`.
- **US-2.2** — Como Operador, quiero desplegar hermes-agent y el runner con Docker Compose usando el secreto `hermes-claude-auth` (`CLAUDE_CODE_OAUTH_TOKEN`), para reutilizar la misma sesión Pro compartida en el chat y en la ejecución de tareas, con los privilegios separados.
  - [ ] hermes-agent responde en modo chat usando `CLAUDE_CODE_OAUTH_TOKEN`, sin `ANTHROPIC_API_KEY` configurada. **Nota (Fase 0)**: no hace falta ningún wrapper — hermes-agent soporta esta variable de entorno de fábrica (ver [hermes/spec.md §0.1/§0.3](hermes/spec.md#01-autenticación-token-oauth-de-larga-duración-para-todo-vía-suscripción-pro)).
  - [ ] Verificado que ambos componentes comparten el mismo secreto de sesión sin conflictos.
  - [ ] **SEC-2.1**: `docker inspect` del contenedor de hermes-agent no lista `/var/run/docker.sock` en sus binds, y `docker ps` ejecutado _dentro_ de ese contenedor falla.
  - [ ] **SEC-4.1**: el contenedor del runner sí lo tiene, y es el único del compose que lo tiene.
  - [ ] **SEC-2.2**: ningún servicio usa `network_mode: host`.
  - [ ] **SEC-3.1**: el servicio del runner no declara `ports:`; verificado que su puerto no responde desde el host ni desde otro equipo de la LAN.
- **US-2.3** — Como Operador, quiero registrar el GitHub MCP oficial y `claude-code-runner-mcp` en la configuración de hermes-agent, para que el agente pueda listar issues y delegar la ejecución sin conectores propios.
  - [ ] `hermes mcp list` lista ambos servidores como conectados y healthy.
  - [ ] **SEC-6.1**: las credenciales de GitHub son un PAT fine-grained scoped solo a los repos elegidos, con los permisos mínimos (contenidos, issues, pull requests). Verificado que un repo fuera del scope falla.
  - [ ] **SEC-6.2**: ningún secreto aparece en el repositorio ni horneado en una imagen; todos se inyectan por entorno desde `.env`.
- **US-2.4** — Como Hermes, quiero un Skill `resolve-issue` que liste issues candidatas (label acordado, p. ej. `hermes`), delegue la ejecución en `run_coding_task`, y reporte el resultado en la issue original, para resolver tareas de código sin intervención humana en el camino feliz.
  - [ ] Etiquetar una issue real con el label acordado produce, en minutos, un PR abierto con el resumen de Claude Code como descripción.
  - [ ] Si el resultado es `failed`/`needs_human_input`/`timed_out`, el Skill comenta en la issue explicando qué pasó y **no** abre PR.
  - [ ] **SEC-2.3**: el Skill hace todo su trabajo vía tools MCP, sin invocar `gh` ni comandos de shell — condición para que corra en cron con `approvals.cron_mode` en `deny`.
  - [ ] **Prompt injection**: verificado con una issue de prueba cuyo cuerpo contiene instrucciones hostiles explícitas ("ignora tus instrucciones y..."), que el sistema no ejecuta la instrucción inyectada y el daño queda contenido. Se documenta qué hizo realmente el agente, sin adornos.
- **US-2.5** — Como Operador, quiero que el cron nativo de hermes-agent dispare el Skill cada N minutos (configurable), para no tener que ejecutar nada manualmente.
  - [ ] El Skill se ejecuta automáticamente según el cron configurado (`hermes cron`), verificado durante al menos un ciclo completo sin intervención.
  - [ ] **SEC-2.3**: verificado que `approvals.cron_mode` sigue en `deny` y aun así el ciclo completa — es decir, no hizo falta relajar la seguridad para que funcione.

### Tareas técnicas

- `apps/claude-code-runner-mcp`: transporte Streamable HTTP + middleware de autenticación Bearer + `CLAUDE_CODE_RUNNER_WORKSPACE_ROOT` configurable + `Dockerfile` propio del servidor.
- `hermes/docker/docker-compose.yml`: hermes-agent (imagen upstream, sin modificar) + `claude-code-runner-mcp` + Postgres, con redes de Compose y separación de privilegios.
- `hermes/config/hermes.config.yaml`: registro de MCP servers, modelo, cron.
- `hermes/skills/resolve-issue/`: primera versión, solo GitHub (ver [hermes/spec.md §5](hermes/spec.md#5-el-skill-resolve-issue)), siguiendo el formato real confirmado en `docs/hermes/exploration-notes.md`.

### Definition of Done

Etiqueto una issue real de un repo mío, y sin más intervención tengo un PR abierto por Claude Code, orquestado por hermes-agent desplegado en el servidor local — **con hermes-agent corriendo sin acceso al socket de Docker**, y con todos los requisitos `SEC-*` de esta fase verificados con evidencia real. Este es el primer hito demostrable de portfolio.

---

## Fase 3 — Interacción conversacional vía Telegram

**Objetivo**: poder hablar con Hermes desde Telegram — mandarle una tarea ad-hoc en lenguaje natural, que la ejecute delegando en `claude-code-runner-mcp` igual que hace el Skill automático de GitHub, y que avise en el mismo chat cuando termine. Esta es la pieza que convierte el proyecto en "mi sistema de IA personal", no solo un bot de GitHub.

**Depende de**: Fase 2 (hermes-agent ya desplegado en el servidor local).

**Seguridad**: esta fase debe verificar SEC-0.1, SEC-0.2, SEC-0.3, SEC-1.1, SEC-1.2, SEC-1.3 y SEC-1.4 de [security.md](security.md). Es la fase con más superficie de exposición del proyecto, porque abre un canal al que cualquiera puede escribir.

**Nota clave (verificada en el código de hermes-agent)**: hablar con Hermes desde fuera de casa **no requiere abrir ningún puerto** del router. El gateway de Telegram usa long polling (`getUpdates`, ver `gateway/platforms/telegram.py`), no webhooks — todo el tráfico es saliente. Si en algún momento parece necesario un túnel o un port forward para que funcione, es un error de configuración, no un requisito (SEC-0.1/SEC-0.2).

### User stories

- **US-3.1** — Como Operador, quiero que el gateway de Telegram acepte órdenes **únicamente** de mi cuenta, para que nadie que descubra el bot pueda mandarle tareas de código.
  - [ ] Allowlist explícita configurada (`TELEGRAM_ALLOWED_USERS` con mi ID, y/o `hermes pairing approve`). **Nota**: hermes-agent ya deniega por defecto (`gateway/run.py::_is_user_authorized` termina en "Default: deny"), pero la allowlist se configura explícitamente en vez de confiar en el default (SEC-1.1).
  - [ ] **SEC-1.2**: verificado que `GATEWAY_ALLOW_ALL_USERS` y `TELEGRAM_ALLOW_ALL_USERS` no están puestas a `true` en ningún `.env` ni en el compose.
  - [ ] Verificado con al menos un intento real desde una **segunda cuenta de Telegram** no autorizada, confirmando que se rechaza. No se da por bueno por lectura del código.
  - [ ] **SEC-0.1**: verificado que el sistema funciona de extremo a extremo desde fuera de la red doméstica (p. ej. con datos móviles) **sin** haber abierto ningún puerto en el router.
- **US-3.2** — Como Operador, quiero poder escribirle a Hermes por Telegram algo como "resuelve la issue #42 de mi-repo" o "arregla X en el repo Y" y que lo traduzca en una tarea ejecutable, para no depender de etiquetar issues en GitHub para todo.
  - [ ] Un mensaje de este tipo dispara la misma tool `run_coding_task` que usa el Skill `resolve-issue` (Fase 2), con `repo`/`taskTitle`/`taskDescription` derivados del mensaje.
  - [ ] Si el mensaje es ambiguo (no está claro el repo o qué hay que hacer), Hermes pregunta por Telegram antes de ejecutar nada — nunca adivina un repo o alcance no confirmado.
- **US-3.3** — Como Operador, quiero recibir una confirmación inmediata por Telegram de que la tarea se ha aceptado y se está ejecutando, para saber que el mensaje no se ha perdido aunque la tarea tarde minutos en terminar.
  - [ ] Tras pedir una tarea, Hermes responde en segundos (p. ej. "Vale, me pongo con ello — tarea `<id>`, te aviso cuando termine") sin esperar a que `run_coding_task` haya devuelto resultado.
- **US-3.4** — Como Operador, quiero recibir un mensaje por Telegram cuando la tarea termina (éxito, fallo, o necesita input), con el resumen y el link al PR si aplica, para no tener que consultar el estado manualmente.
  - [ ] Al completarse `run_coding_task` en cualquier estado terminal (`success`/`failed`/`needs_human_input`/`timed_out`), llega un mensaje al mismo chat con el resumen y, si hay PR, el link.
  - [ ] Verificado con al menos una ejecución real de principio a fin iniciada por Telegram, incluyendo el caso de una tarea de varios minutos (no solo una que responde al instante).
- **US-3.5** — Como Operador, quiero que las mismas reglas de aislamiento y seguridad de `claude-code-runner-mcp` apliquen igual a las tareas iniciadas por Telegram que a las de GitHub, para que el canal de entrada nunca sea un atajo de seguridad.
  - [ ] **SEC-1.4**: una tarea iniciada por Telegram pasa por el mismo `run_coding_task` (mismo aislamiento, mismo rate limiting) que una originada en GitHub — no hay una ruta alternativa sin aislamiento para el flujo conversacional.
  - [ ] **SEC-0.3**: verificado que el dashboard de hermes-agent sigue atado a `127.0.0.1` y que el API server sigue desactivado.

### Tareas técnicas

- Configurar el gateway de Telegram nativo de hermes-agent (`hermes gateway setup`, bot token de @BotFather, DM pairing) — sin código propio, solo configuración.
- Nuevo Skill (o ampliación de `resolve-issue`) que reconoce peticiones conversacionales de tarea y las traduce en una llamada a `run_coding_task`, con confirmación inmediata al aceptar.
- Investigar y decidir el mecanismo de notificación de finalización — dos opciones, en orden de preferencia (documentar en `docs/hermes/spec.md §9` cuál se implementó y por qué):
  1. **Preferida**: delegar `run_coding_task` en un subagente de hermes-agent (su mecanismo nativo de "delegación de subagentes para paralelizar trabajo"), de forma que el chat principal queda libre y el resultado se reporta de vuelta al hilo original de Telegram cuando el subagente termina. Verificar empíricamente si esto funciona para tareas de hasta 30 minutos antes de dar la fase por buena.
  2. **Fallback**, si (1) no resulta viable: un job de `hermes cron` que consulta periódicamente `runner.task_runs` por cambios de estado a terminal desde la última comprobación, y envía un mensaje al chat del Operador vía el gateway.

### Definition of Done

Puedo escribirle a mi bot de Telegram (solo yo, DM pairing verificado) pidiendo que resuelva algo de un repo, recibo confirmación inmediata, y recibo un aviso con el resultado cuando termina — sin haber tocado GitHub Issues ni el ordenador en ningún momento del ciclo.

---

## Fase 4 — Brain básico (ingest + retrieval, sin consolidación)

**Objetivo**: poder ingestar una nota de texto y recuperarla por similitud semántica vía una API HTTP interna. **Esto es deliberadamente todo lo que Brain hace en este proyecto** — no un "company brain" completo. La capa de consolidación (extracción de observations, reconciliación, mental models) está diseñada en el spec pero **no se construye aquí**; queda como trabajo futuro del Operador (ver [personal-brain/spec.md §4.2](personal-brain/spec.md#42-consolidation--fuera-de-alcance-de-este-proyecto-diseño-de-referencia-únicamente)).

**Depende de**: Fase 0.

### User stories

- **US-4.1** — Como Operador, quiero un endpoint/CLI para ingestar manualmente un documento de texto (nota markdown, descripción de PR pegada a mano) como `RawEvent`, para empezar a poblar Brain sin depender de conectores automáticos.
  - [ ] `POST /v1/ingest` (o CLI equivalente) acepta `{ source, sourceAuthority, text, externalRef? }` y persiste un `RawEvent`.
  - [ ] Valida que `sourceAuthority` sea `canonical` o `supporting` (rechaza cualquier otro valor).
- **US-4.2** — Como Sistema, quiero generar y almacenar el embedding de cada `RawEvent` ingestado en pgvector, para poder hacer búsqueda por similitud más adelante.
  - [ ] Cada `RawEvent` ingestado genera un embedding (proveedor configurable) y se persiste junto al texto.
- **US-4.3** — Como Operador, quiero consultar `POST /v1/query` con una pregunta en lenguaje natural y recibir los fragmentos más relevantes por similitud semántica, para validar que la recuperación básica funciona.
  - [ ] La respuesta incluye los `k` fragmentos más similares (k configurable) con su score (`{ fragments: [{ id, text, score, source, sourceAuthority, occurredAt }] }` — ver [personal-brain/spec.md §5](personal-brain/spec.md#5-api)).
  - [ ] Documentado explícitamente en el spec y en el README que esto es "vector store simple sobre notas propias", no observations consolidadas ni un company brain — evita vender de más en el portfolio.

### Tareas técnicas

- `apps/brain/src/ingestion`: normalización a `RawEvent` + endpoint/CLI de ingesta manual.
- `apps/brain/src/retrieval`: similarity search sobre pgvector — semántica pura, sin entidad/temporal/grafo (esas estrategias dependen de la capa de consolidación, fuera de alcance de este proyecto).
- Sin MCP todavía — API HTTP interna únicamente (`brain-mcp` llega en la Fase 5).
- **No se crea** `apps/brain/src/consolidation` en este proyecto — el directorio queda documentado como diseño futuro en el spec, no como código a escribir aquí.

### Definition of Done

Puedo pegarle una nota por API/CLI y preguntarle algo relacionado, y me devuelve el fragmento relevante por similitud. Sin consolidación, sin MCP, sin conectores automáticos — y el README/spec de Brain dice esto explícitamente, incluyendo que la consolidación es trabajo futuro fuera de este proyecto.

---

## Fase 5 — Integrar Brain vía `brain-mcp`

**Objetivo**: la demo insignia del proyecto — Hermes resuelve una tarea de forma distinta (mejor) porque consultó a Brain antes de actuar, y el resultado se escribe de vuelta como aprendizaje. Esto aplica tanto al flujo automático de GitHub (Fase 2) como al conversacional de Telegram (Fase 3) — ambos pasan por el mismo `run_coding_task`. El contexto que aporta Brain en esta fase es retrieval semántico simple (fragmentos de notas/PRs previos), no observations consolidadas — sigue siendo una demo válida y útil del bucle "consulta antes de actuar, reporta después".

**Depende de**: Fase 2, Fase 3, Fase 4.

### User stories

- **US-5.1** — Como Hermes, quiero llamar a la tool `brain_query` antes de `run_coding_task`, para inyectar contexto relevante (convenciones, decisiones previas) en el prompt de Claude Code.
  - [ ] El Skill `resolve-issue` llama a `brain_query` con el título/descripción de la issue antes de delegar la ejecución.
  - [ ] El resultado de `brain_query` se inyecta como `brainContext` en `run_coding_task`.
- **US-5.2** — Como Hermes, quiero que si `brain-mcp` no responde (caído, timeout), la tarea siga ejecutándose sin contexto en vez de bloquearse, para que una caída de Brain nunca tumbe el flujo principal.
  - [ ] Con `brain-mcp` deliberadamente apagado, `resolve-issue` completa la tarea igualmente (loggeando el fallo de contexto).
- **US-5.3** — Como Sistema, quiero registrar el resultado de cada ejecución (éxito, fallo, resumen) en Brain vía `brain_record_observation`, para cerrar el bucle de aprendizaje descrito en el artículo de referencia.
  - [ ] Tras cada ejecución del Skill (éxito o fallo), se crea un nuevo `RawEvent` en Brain de tipo `hermes_feedback` (persistido tal cual, sin extracción LLM — esa parte es la consolidación fuera de alcance).
- **US-5.4** — Como Operador, quiero poder demostrar, con un ejemplo concreto, que una tarea se resolvió mejor gracias al contexto de Brain que sin él, para tener la pieza central de la demo de portfolio.
  - [ ] Existe al menos un caso documentado (antes/después) donde el contexto de Brain (fragmentos recuperados por similitud) cambió el resultado de la ejecución de forma verificable.
- **US-5.5** — Como Hermes, quiero que las tareas ad-hoc iniciadas por Telegram (Fase 3) también consulten a Brain antes de ejecutar y registren el resultado después, igual que las originadas en GitHub, para que el contexto beneficie a los dos canales de entrada por igual.
  - [ ] Una tarea iniciada por Telegram llama a `brain_query` antes de `run_coding_task` y a `brain_record_observation` después, con el mismo comportamiento que el Skill `resolve-issue`.

### Tareas técnicas

- `apps/brain-mcp`: servidor MCP con las tres tools (`brain_query`, `brain_ingest`, `brain_record_observation`) envolviendo la API HTTP de Brain (ver [personal-brain/spec.md §5.2](personal-brain/spec.md#52-api-vía-mcp-appsbrain-mcp-lo-que-realmente-consume-hermes)).
- Registro de `brain-mcp` en la configuración de hermes-agent.
- Ampliación del Skill `resolve-issue` con los pasos 2 y 6 (query antes, record after) descritos en [hermes/spec.md §5](hermes/spec.md#5-el-skill-resolve-issue).

### Definition of Done

Hermes consulta a Brain antes de actuar y le reporta el resultado después, de forma verificable con al menos un caso de ejemplo real. Este es el entregable que más vale enseñar en el portfolio, y cierra el **Milestone v1** (Fases 0 a 5).

---

## Futuribles (post-v1)

Ideas y trabajo documentado que se queda deliberadamente fuera del Milestone v1, sin fecha ni compromiso — para retomar cuando el sistema básico ya esté funcionando de verdad en el día a día. No están numeradas como "Fase" porque no forman parte del roadmap secuencial: se puede picotear cualquiera de ellas en el orden que interese en su momento.

### Futurible A — Ampliar fuentes (Notion, Jira)

**Qué sería**: que Hermes pueda coger tareas desde Notion y Jira además de GitHub, y que Brain pueda ingestar documentos de esas plataformas como fuente de contexto.

- Registrar el servidor MCP oficial de Notion apuntando a una base de datos "Hermes Tasks" (`status = Ready for Hermes`).
- Registrar un servidor MCP de Jira/Atlassian con un JQL fijo (`labels = hermes AND status = "To Do"`).
- Generalizar el Skill conversacional/`resolve-issue` para listar y reportar en las tres plataformas indistintamente.
- Etiquetar cada fuente de ingestion de Brain con su `source_authority` (`canonical`/`supporting`) para que un futuro retomar de la consolidación (Futurible C) parta de datos ya etiquetados.

### Futurible B — Pulido de portfolio

**Qué sería**: que el proyecto sea presentable de principio a fin a un reclutador o cliente potencial, no solo funcional para mí.

- README con demo grabada (GIF/vídeo) de Hermes resolviendo una tarea real end-to-end (por GitHub y/o por Telegram).
- Métricas simples (nº de tareas resueltas, nº de eventos ingestados en Brain, tasa de éxito) en un comando CLI o dashboard mínimo.
- Migrar de PAT fine-grained a un GitHub App real.
- `docs/case-study.md` explicando las decisiones de diseño clave: por qué hermes-agent y no un orquestador propio, por qué la autenticación compartida y su riesgo de ToS asumido, por qué Brain se mantiene básico, por qué Telegram como canal principal de interacción.

### Futurible C — Company Brain completo (consolidación real)

**Qué sería**: retomar la capa de consolidación ya diseñada en [personal-brain/spec.md §4.2](personal-brain/spec.md#42-consolidation--fuera-de-alcance-de-este-proyecto-diseño-de-referencia-únicamente) — extracción de `Observation` vía LLM, reconciliación de contradicciones, `MentalModel` agregados — para que Brain deje de ser un vector store simple y pase a cumplir de verdad las 4 propiedades del patrón "company brain" (shared, enforceable, evolving, agent-readable). Es la pieza que más deliberadamente se ha dejado fuera de v1: el spec ya existe, falta construirla cuando el Operador quiera.

### Futurible D — Otros canales de mensajería de hermes-agent

hermes-agent ya soporta de fábrica Discord, Slack, WhatsApp y Signal además de Telegram — habilitar cualquiera de ellos es, en principio, solo configuración adicional del mismo gateway, reutilizando el mismo Skill conversacional de la Fase 3.

### Futurible E — Notificaciones proactivas / resúmenes periódicos

Usar el cron nativo de hermes-agent para mandar, sin que se le pida, un resumen diario/semanal por Telegram (tareas resueltas, issues pendientes, estado de la sesión de Claude Code) — el mismo patrón que "daily reports, nightly backups, weekly audits" que ya trae hermes-agent de fábrica.

### Futurible F — Voice memos vía Telegram

hermes-agent soporta transcripción de notas de voz — se podría mandar una tarea hablada en vez de escrita desde el móvil, sin construir nada nuevo, solo verificar que el flujo conversacional de la Fase 3 funciona igual con audio transcrito.

---

## Fuera de alcance (de verdad, no un futurible)

Esto no son ideas aparcadas para "más adelante" — son cosas que este proyecto activamente decide no hacer, ni en v1 ni después, salvo que cambie radicalmente de propósito:

- Multi-tenancy / permisos por usuario real — Brain se diseña pensando en que el patrón podría generalizarse, pero no se implementa la lógica de autorización completa.
- Alta disponibilidad / multi-región — un único servidor local (Mac Mini) es suficiente para el objetivo de uso personal.
- Automatizar la reautenticación de la sesión de Claude Code cuando expira o es revocada (§0.2/§3.3 de hermes/spec.md) — es y seguirá siendo un paso manual del Operador.
- Ofrecer este sistema como servicio a terceros — uso estrictamente personal, dado el riesgo de ToS asumido en la autenticación compartida.
