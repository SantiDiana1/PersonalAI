# Roadmap y User Stories — PersonalAI

> Documento _spec-driven_: cada fase es una unidad de trabajo autocontenida con objetivo, user stories, criterios de aceptación y Definition of Done. La idea es que Claude Code (u otro coding agent) pueda coger **una fase entera** y saber exactamente qué construir y cuándo darla por terminada, sin tener que interpretar prosa suelta.

Filosofía (tomada del artículo de referencia sobre "company brain"): **no intentes modelar todo el sistema de golpe**. Se construye primero el workflow más estrecho posible de cada proyecto, se valida, y solo entonces se integra y se amplía. Cada fase deja algo demostrable, aunque sea a nivel de portfolio/demo.

Recordatorio: "Hermes" = [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) desplegado y extendido vía MCP/skills, no un orquestador propio (ver [hermes/spec.md §0](hermes/spec.md#0-aclaración-importante-qué-es-hermes-aquí)). Y ojo: el modelo de autenticación de Claude Code elegido (token OAuth de larga duración compartido, [hermes/spec.md §0.1–0.3](hermes/spec.md#01-autenticación-token-oauth-de-larga-duración-para-todo-vía-suscripción-pro)) viola los ToS de consumidor de Anthropic y se asume como riesgo consciente — varias fases de abajo lo referencian explícitamente donde aplica.

> **Decisión de alcance (tomada tras la Fase 0)**: este proyecto **no construye la capa de consolidación de Brain** (extracción de observations vía LLM, reconciliación de contradicciones, mental models). Brain se mantiene deliberadamente **básico** — ingestión + búsqueda por similitud semántica, nada más — durante todo el proyecto. La capa de consolidación queda diseñada y documentada en [personal-brain/spec.md](personal-brain/spec.md) como trabajo futuro que el Operador construirá por su cuenta más adelante, fuera de este roadmap. Las fases tempranas priorizan Hermes + el despliegue en VPS; Brain aparece pronto pero deliberadamente pequeño.

## Cómo leer este documento

Cada fase tiene la misma estructura:

- **Objetivo** — qué demuestra esta fase en una frase.
- **Depende de** — qué fase(s) tienen que estar terminadas antes.
- **User stories** — formato `Como <rol>, quiero <acción>, para <razón>`, con un ID (`US-<fase>.<n>`) para poder referenciarlas desde código/commits/PRs.
- **Criterios de aceptación** — checklist verificable por cada story (si no se puede marcar como hecho/no hecho, la historia está mal escrita).
- **Tareas técnicas** — el "cómo", a alto nivel (implementación real delegada al spec del componente correspondiente).
- **Definition of Done** — qué tiene que ser cierto para cerrar la fase completa.

Roles usados en las stories: **Operador** (yo, dueño único del sistema), **Hermes** (la instancia de hermes-agent desplegada, actuando como agente), **Sistema** (comportamiento automático sin actor humano), **Reclutador/cliente** (consumidor externo del portfolio, solo aparece en la Fase 6).

## Vista general

| Fase | Nombre                                               | Objetivo en una frase                                                                        | Depende de |
| ---- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------- |
| 0    | Fundación del monorepo + auth compartida             | Monorepo instalable + sesión de Claude Pro compartida lista para usarse                      | —          |
| 1    | `claude-code-runner-mcp` en solitario                | Puedo delegar una tarea de código a Claude Code en un contenedor aislado, sin Hermes todavía | Fase 0     |
| 2    | hermes-agent en VPS + Skill `resolve-issue` (GitHub) | Etiqueto una issue y Hermes abre un PR sin que yo haga nada más                              | Fase 0, 1  |
| 3    | Brain básico (ingest + retrieval)                    | Puedo preguntarle algo a Brain y me devuelve el fragmento relevante                          | Fase 0     |
| 4    | Integrar Brain vía `brain-mcp`                       | Hermes resuelve issues mejor porque consulta a Brain antes de actuar                         | Fase 2, 3  |
| 5    | Ampliar fuentes (Notion, Jira)                       | Hermes coge tareas también desde Notion y Jira                                               | Fase 4     |
| 6    | Pulido de portfolio                                  | El proyecto es presentable de principio a fin a un reclutador/cliente                        | Fase 5     |

**Fuera de este roadmap**: consolidación real de Brain (extracción de observations, reconciliación, mental models) — diseñada en [personal-brain/spec.md §4.2](personal-brain/spec.md#42-consolidation-fuera-de-alcance-de-este-proyecto), pendiente de que el Operador la construya por su cuenta cuando quiera retomarla. Ver también "Fuera de alcance" al final de este documento.

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
- **US-0.2** — Como Operador, quiero `docker-compose.dev.yml` levantando Postgres con `pgvector` en local, para desarrollar Brain sin depender del VPS.
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
  - [ ] Un intento de superar el límite configurado se rechaza (o se encola) en vez de lanzar un contenedor adicional.

### Tareas técnicas

- `apps/claude-code-runner-mcp`: SDK MCP oficial + `dockerode`.
- Imagen `claude-code-runner-image` (Node.js + git + Claude Code CLI, sin credenciales horneadas).
- Generación de `prompt.md` a partir de los inputs de la tool.
- Chequeo de sesión (`claude -p` con un prompt corto, o equivalente) antes de cada `docker run`.
- Postgres, esquema `runner`, tabla `task_runs` (ver [hermes/spec.md §7](hermes/spec.md#7-modelo-de-datos)).

### Definition of Done

Puedo invocar `run_coding_task` manualmente contra un repo real y obtener una rama con cambios generados por Claude Code, con aislamiento verificado y manejo explícito de sesión expirada/revocada. hermes-agent todavía no está en el bucle.

---

## Fase 2 — Desplegar hermes-agent en VPS + Skill `resolve-issue` (solo GitHub)

**Objetivo**: primera demo end-to-end — etiquetar una issue real y ver a Hermes abrir un PR, sin Brain todavía.

**Depende de**: Fase 0, Fase 1.

### User stories

- **US-2.1** — Como Operador, quiero desplegar hermes-agent en el VPS vía Docker Compose usando el secreto `hermes-claude-auth` (`CLAUDE_CODE_OAUTH_TOKEN`), para reutilizar la misma sesión Pro compartida en el chat y en la ejecución de tareas.
  - [ ] hermes-agent responde en modo chat (CLI o gateway) usando `CLAUDE_CODE_OAUTH_TOKEN`, sin `ANTHROPIC_API_KEY` configurada. **Nota (Fase 0)**: no hace falta ningún wrapper — hermes-agent soporta esta variable de entorno de fábrica (ver [hermes/spec.md §0.1/§0.3](hermes/spec.md#01-autenticación-token-oauth-de-larga-duración-para-todo-vía-suscripción-pro)).
  - [ ] Verificado que ambos componentes (hermes-agent y `claude-code-runner-mcp`) comparten el mismo secreto de sesión sin conflictos.
- **US-2.2** — Como Operador, quiero registrar el GitHub MCP oficial y `claude-code-runner-mcp` en la configuración de hermes-agent, para que el agente pueda listar issues y delegar la ejecución sin conectores propios.
  - [ ] `hermes mcp list` lista ambos servidores como conectados y healthy.
  - [ ] Las credenciales de GitHub usadas son un PAT fine-grained (o GitHub App) scoped solo a los repos elegidos.
- **US-2.3** — Como Hermes, quiero un Skill `resolve-issue` que liste issues candidatas (label acordado, p. ej. `hermes`), delegue la ejecución en `run_coding_task`, y reporte el resultado en la issue original, para resolver tareas de código sin intervención humana en el camino feliz.
  - [ ] Etiquetar una issue real con el label acordado produce, en minutos, un PR abierto con el resumen de Claude Code como descripción.
  - [ ] Si el resultado es `failed`/`needs_human_input`/`timed_out`, el Skill comenta en la issue explicando qué pasó y **no** abre PR.
- **US-2.4** — Como Operador, quiero que el cron nativo de hermes-agent dispare el Skill cada N minutos (configurable), para no tener que ejecutar nada manualmente.
  - [ ] El Skill se ejecuta automáticamente según el cron configurado (`hermes cron`), verificado durante al menos un ciclo completo sin intervención.

### Tareas técnicas

- `hermes/docker/docker-compose.yml`: hermes-agent (imagen upstream, sin modificar) + `claude-code-runner-mcp` + Postgres.
- `hermes/config/hermes.config.yaml`: registro de MCP servers, modelo, cron.
- `hermes/skills/resolve-issue/`: primera versión, solo GitHub (ver [hermes/spec.md §5](hermes/spec.md#5-el-skill-resolve-issue)), siguiendo el formato real confirmado en `docs/hermes/exploration-notes.md`.

### Definition of Done

Etiqueto una issue real de un repo mío, y sin más intervención tengo un PR abierto por Claude Code, orquestado por hermes-agent desplegado en el VPS. Este es el primer hito demostrable de portfolio.

---

## Fase 3 — Brain básico (ingest + retrieval, sin consolidación)

**Objetivo**: poder ingestar una nota de texto y recuperarla por similitud semántica vía una API HTTP interna. **Esto es deliberadamente todo lo que Brain hace en este proyecto** — no un "company brain" completo. La capa de consolidación (extracción de observations, reconciliación, mental models) está diseñada en el spec pero **no se construye aquí**; queda como trabajo futuro del Operador (ver [personal-brain/spec.md §4.2](personal-brain/spec.md#42-consolidation-fuera-de-alcance-de-este-proyecto)).

**Depende de**: Fase 0.

### User stories

- **US-3.1** — Como Operador, quiero un endpoint/CLI para ingestar manualmente un documento de texto (nota markdown, descripción de PR pegada a mano) como `RawEvent`, para empezar a poblar Brain sin depender de conectores automáticos.
  - [ ] `POST /v1/ingest` (o CLI equivalente) acepta `{ source, sourceAuthority, text, externalRef? }` y persiste un `RawEvent`.
  - [ ] Valida que `sourceAuthority` sea `canonical` o `supporting` (rechaza cualquier otro valor).
- **US-3.2** — Como Sistema, quiero generar y almacenar el embedding de cada `RawEvent` ingestado en pgvector, para poder hacer búsqueda por similitud más adelante.
  - [ ] Cada `RawEvent` ingestado genera un embedding (proveedor configurable) y se persiste junto al texto.
- **US-3.3** — Como Operador, quiero consultar `POST /v1/query` con una pregunta en lenguaje natural y recibir los fragmentos más relevantes por similitud semántica, para validar que la recuperación básica funciona.
  - [ ] La respuesta incluye los `k` fragmentos más similares (k configurable) con su score (`{ fragments: [{ id, text, score, source, sourceAuthority, occurredAt }] }` — ver [personal-brain/spec.md §5](personal-brain/spec.md#5-api)).
  - [ ] Documentado explícitamente en el spec y en el README que esto es "vector store simple sobre notas propias", no observations consolidadas ni un company brain — evita vender de más en el portfolio.

### Tareas técnicas

- `apps/brain/src/ingestion`: normalización a `RawEvent` + endpoint/CLI de ingesta manual.
- `apps/brain/src/retrieval`: similarity search sobre pgvector — semántica pura, sin entidad/temporal/grafo (esas estrategias dependen de la capa de consolidación, fuera de alcance de este proyecto).
- Sin MCP todavía — API HTTP interna únicamente (`brain-mcp` llega en la Fase 4).
- **No se crea** `apps/brain/src/consolidation` en este proyecto — el directorio queda documentado como diseño futuro en el spec, no como código a escribir aquí.

### Definition of Done

Puedo pegarle una nota por API/CLI y preguntarle algo relacionado, y me devuelve el fragmento relevante por similitud. Sin consolidación, sin MCP, sin conectores automáticos — y el README/spec de Brain dice esto explícitamente, incluyendo que la consolidación es trabajo futuro fuera de este proyecto.

---

## Fase 4 — Integrar Brain vía `brain-mcp`

**Objetivo**: la demo insignia del proyecto — Hermes resuelve una issue de forma distinta (mejor) porque consultó a Brain antes de actuar, y el resultado se escribe de vuelta como aprendizaje. El contexto que aporta Brain en esta fase es retrieval semántico simple (fragmentos de notas/PRs previos), no observations consolidadas — sigue siendo una demo válida y útil del bucle "consulta antes de actuar, reporta después".

**Depende de**: Fase 2, Fase 3.

### User stories

- **US-4.1** — Como Hermes, quiero llamar a la tool `brain_query` antes de `run_coding_task`, para inyectar contexto relevante (convenciones, decisiones previas) en el prompt de Claude Code.
  - [ ] El Skill `resolve-issue` llama a `brain_query` con el título/descripción de la issue antes de delegar la ejecución.
  - [ ] El resultado de `brain_query` se inyecta como `brainContext` en `run_coding_task`.
- **US-4.2** — Como Hermes, quiero que si `brain-mcp` no responde (caído, timeout), la tarea siga ejecutándose sin contexto en vez de bloquearse, para que una caída de Brain nunca tumbe el flujo principal.
  - [ ] Con `brain-mcp` deliberadamente apagado, `resolve-issue` completa la tarea igualmente (loggeando el fallo de contexto).
- **US-4.3** — Como Sistema, quiero registrar el resultado de cada ejecución (éxito, fallo, resumen) en Brain vía `brain_record_observation`, para cerrar el bucle de aprendizaje descrito en el artículo de referencia.
  - [ ] Tras cada ejecución del Skill (éxito o fallo), se crea un nuevo `RawEvent` en Brain de tipo `hermes_feedback` (persistido tal cual, sin extracción LLM — esa parte es la consolidación fuera de alcance).
- **US-4.4** — Como Operador, quiero poder demostrar, con un ejemplo concreto, que una issue se resolvió mejor gracias al contexto de Brain que sin él, para tener la pieza central de la demo de portfolio.
  - [ ] Existe al menos un caso documentado (antes/después) donde el contexto de Brain (fragmentos recuperados por similitud) cambió el resultado de la ejecución de forma verificable.

### Tareas técnicas

- `apps/brain-mcp`: servidor MCP con las tres tools (`brain_query`, `brain_ingest`, `brain_record_observation`) envolviendo la API HTTP de Brain (ver [personal-brain/spec.md §5.2](personal-brain/spec.md#52-api-vía-mcp-apps-brain-mcp-lo-que-realmente-consume-hermes)).
- Registro de `brain-mcp` en la configuración de hermes-agent.
- Ampliación del Skill `resolve-issue` con los pasos 2 y 6 (query antes, record after) descritos en [hermes/spec.md §5](hermes/spec.md#5-el-skill-resolve-issue).

### Definition of Done

Hermes consulta a Brain antes de actuar y le reporta el resultado después, de forma verificable con al menos un caso de ejemplo real. Este es el entregable que más vale enseñar en el portfolio.

---

## Fase 5 — Ampliar fuentes (Notion, Jira)

**Objetivo**: que Hermes pueda coger tareas desde Notion y Jira, no solo GitHub, y que Brain pueda ingestar documentos de esas plataformas como fuente de contexto.

**Depende de**: Fase 4.

### User stories

- **US-5.1** — Como Operador, quiero registrar el servidor MCP oficial de Notion apuntando a una base de datos "Hermes Tasks", para poder gestionar tareas desde Notion igual que desde GitHub Issues.
  - [ ] Una tarea creada en la base de datos de Notion con `status = Ready for Hermes` es recogida por el Skill en el siguiente ciclo de cron.
- **US-5.2** — Como Operador, quiero registrar un servidor MCP de Jira/Atlassian con un JQL fijo (`labels = hermes AND status = "To Do"`), para poder gestionar tareas desde Jira igual que desde GitHub.
  - [ ] Un ticket de Jira que cumple el JQL configurado es recogido por el Skill en el siguiente ciclo de cron.
- **US-5.3** — Como Hermes, quiero reportar el resultado de la ejecución en la fuente original (comentario en Notion/Jira, no solo GitHub), para que el flujo sea consistente independientemente de dónde viniera la tarea.
  - [ ] Una tarea originada en Notion/Jira recibe un comentario con el resultado (link al PR, o explicación de fallo) en esa misma plataforma.
- **US-5.4** — Como Sistema, quiero etiquetar cada fuente de ingestion de Brain con su `source_authority` (`canonical`/`supporting`), para que el retrieval pese correctamente los documentos de Notion/Jira ingestados como contexto (y para que una eventual consolidación futura, si el Operador la retoma, parta de datos ya etiquetados correctamente).
  - [ ] Un documento ingestado desde Notion/Jira como fuente de contexto lleva su `source_authority` correctamente asignada.

### Tareas técnicas

- Registro de los MCP servers de Notion y Jira en `hermes/config/hermes.config.yaml`.
- Ampliación del Skill `resolve-issue` para generalizar "fuente" más allá de GitHub (listar/reportar en las tres plataformas).
- Filtro de canonicidad en `apps/brain/src/ingestion` para documentos de Notion/Jira.

### Definition of Done

Hermes coge y reporta tareas indistintamente desde GitHub, Notion o Jira; Brain puede ingestar páginas de Notion como fuente de contexto con su autoridad correctamente etiquetada.

---

## Fase 6 — Pulido de portfolio

**Objetivo**: que el proyecto sea presentable de principio a fin a un reclutador o cliente potencial — no solo funcional, sino explicado.

**Depende de**: Fase 5.

### User stories

- **US-6.1** — Como Reclutador/cliente, quiero un README con una demo grabada (GIF o vídeo corto) de Hermes resolviendo una issue real end-to-end, para entender el proyecto en menos de 2 minutos sin tener que leer todos los specs.
  - [ ] Existe una grabación de un ciclo completo (issue etiquetada → PR abierto) enlazada desde el README principal.
- **US-6.2** — Como Operador, quiero métricas simples expuestas (nº de tareas resueltas, nº de eventos ingestados en Brain, tasa de éxito) en un comando CLI o dashboard mínimo, para poder enseñar resultados cuantitativos, no solo una demo puntual.
  - [ ] Un comando (`pnpm stats` o similar) imprime estas métricas a partir de los datos reales de `runner.task_runs` y de Brain.
- **US-6.3** — Como Operador, quiero migrar de PAT fine-grained a un GitHub App real si el tiempo lo permite, para demostrar un modelo de permisos más robusto de cara al portfolio.
  - [ ] El GitHub App está registrado e instalado solo en los repos elegidos, sustituyendo al PAT sin romper el flujo existente.
- **US-6.4** — Como Reclutador/cliente, quiero un `docs/case-study.md` que explique las decisiones de diseño (por qué hermes-agent y no un orquestador propio, por qué la sesión Pro compartida y su riesgo asumido, por qué MCP como mecanismo de integración, por qué Brain se mantiene deliberadamente básico en este proyecto), para entender el razonamiento detrás del código, no solo el resultado.
  - [ ] El case study cubre explícitamente: elección de hermes-agent, arquitectura MCP, el trade-off de riesgo de ToS de la autenticación compartida, y la decisión de alcance de dejar la consolidación de Brain como trabajo futuro.

### Tareas técnicas

- Grabación de demo + README actualizado.
- Comando/dashboard de métricas.
- Migración opcional a GitHub App.
- Redacción de `docs/case-study.md`.

### Definition of Done

Cualquier persona externa (reclutador, cliente potencial) puede entender qué hace el proyecto, verlo funcionar, y entender por qué se tomaron las decisiones de arquitectura clave, sin necesidad de que el Operador esté presente para explicarlo.

---

## Fuera de alcance (explícitamente, para no expandir de más)

- **Consolidación real de Brain** (extracción de observations vía LLM, reconciliación de contradicciones, mental models) — diseñada en [personal-brain/spec.md §4.2](personal-brain/spec.md#42-consolidation-fuera-de-alcance-de-este-proyecto) como referencia, pero **no se construye en este proyecto**. Es trabajo futuro que el Operador retomará por su cuenta, fuera de este roadmap, cuando quiera.
- Multi-tenancy / permisos por usuario real (Brain se diseña pensando en ello, pero no se implementa).
- Integraciones más allá de GitHub, Notion y Jira (Slack, email, etc.) — hermes-agent ya trae gateway a varias de ellas, quedan como "trabajo futuro" si se quiere ampliar.
- Alta disponibilidad / multi-región — un único VPS es suficiente para el objetivo de portfolio + uso personal.
- Automatizar la reautenticación de la sesión de Claude Code cuando expira o es revocada (§0.2/§3.3 de hermes/spec.md) — es y seguirá siendo un paso manual del Operador.
- Ofrecer este sistema como servicio a terceros — uso estrictamente personal, dado el riesgo de ToS asumido en la autenticación compartida.
