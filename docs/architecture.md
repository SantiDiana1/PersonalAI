# Arquitectura general — PersonalAI

## Visión

PersonalAI tiene dos piezas que se relacionan mediante un contrato claro: **Brain expone contexto vía MCP; Hermes (hermes-agent) lo consume antes de actuar y le devuelve el resultado de sus acciones**, también vía MCP. Esto cierra el bucle de aprendizaje que describe el artículo de referencia (["Company Brain" — Layer 4: Action](https://vectorize.io/articles/how-to-build-company-brain)): un agente que actúa sin escribir de vuelta al brain nunca mejora.

**Aclaración clave**: "Hermes" es [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) desplegado, no un servicio que construimos desde cero. Lo que nosotros construimos son las piezas que le faltan para este caso de uso concreto: dos servidores MCP propios (`brain-mcp`, `claude-code-runner-mcp`) y un Skill que define el procedimiento de trabajo. Todo lo demás — el loop del agente, la memoria propia de hermes-agent, el gateway multi-plataforma, el cron scheduler, la delegación de subagentes — ya existe y solo se configura.

```mermaid
flowchart LR
    subgraph Fuentes["Fuentes externas"]
        GH[GitHub Issues/PRs]
        NO[Notion]
        JI[Jira]
        NT[Notas personales / journal]
    end

    subgraph VPS["Servidor local — Mac Mini (Docker Compose)"]
        subgraph HAC["Contenedor hermes-agent — SIN socket Docker"]
            subgraph HA["hermes-agent (NousResearch, upstream)"]
                LOOP["Agent loop + memoria propia + cron"]
                SKILL["Skill: resolve-issue<br/>(procedimiento que construimos nosotros)"]
            end
            GHMCP["GitHub MCP<br/>(oficial, stdio)"]
            NOMCP["Notion MCP<br/>(oficial, stdio)"]
            JIMCP["Jira/Atlassian MCP<br/>(oficial/comunidad, stdio)"]
            BMCP["brain-mcp<br/>(nuestro, stdio)"]
        end

        subgraph RUNC["Contenedor claude-code-runner-mcp — ÚNICO con socket Docker"]
            CCMCP["claude-code-runner-mcp<br/>(nuestro, MCP sobre HTTP)"]
        end

        subgraph BrainSvc["Brain (nuestro, deliberadamente básico — ver personal-brain/spec.md §0)"]
            ING[Ingestion]
            RET["Retrieval API<br/>(similarity search, sin consolidation)"]
            DB[(Postgres + pgvector)]
        end

        RUN["Contenedor efímero<br/>Claude Code CLI + checkout del repo<br/>(red aislada + proxy allowlist)"]
    end

    GH --> ING
    NO --> ING
    JI --> ING
    NT --> ING
    ING --> DB
    DB --> RET
    RET <--> BMCP

    LOOP --> SKILL
    SKILL -->|1. lista tareas| GHMCP & NOMCP & JIMCP
    SKILL -->|2. consulta contexto| BMCP
    SKILL -->|"3. delega la ejecución<br/>(HTTP + Bearer, red interna)"| CCMCP
    CCMCP --> RUN
    RUN -->|4. commits| GHMCP
    SKILL -->|5. abre PR / comenta| GHMCP & NOMCP & JIMCP
    SKILL -->|6. registra resultado| BMCP
```

## Estructura del monorepo

```
personalAI/
  apps/
    brain/                     # servicio de memoria (Personal Brain), deliberadamente básico — ver personal-brain/spec.md §0
      src/
        ingestion/
        retrieval/               # solo similarity search en v1 — sin entidad/temporal/grafo
        api/
        # NO existe src/consolidation/ en este proyecto: diseñado en el spec, construcción
        # pospuesta a trabajo futuro del Operador (personal-brain/spec.md §4.2)
      Dockerfile
    brain-mcp/                 # servidor MCP adaptador — expone la API de Brain como tools MCP
      src/
        tools/                 # brain_query, brain_ingest, brain_record_observation
      Dockerfile
    claude-code-runner-mcp/    # servidor MCP que orquesta contenedores efímeros con Claude Code
      src/
        tools/                 # run_coding_task
        docker/                # lógica de lanzar/monitorizar/destruir contenedores (dockerode)
      Dockerfile
  hermes/
    config/
      hermes.config.yaml       # servidores MCP registrados, modelo/proveedor, cron
    skills/
      resolve-issue/           # Skill de hermes-agent (formato agentskills.io) que construimos nosotros
    docker/
      docker-compose.yml       # despliega hermes-agent (upstream) + brain + brain-mcp + claude-code-runner-mcp + postgres
  packages/
    shared/                    # tipos compartidos entre brain, brain-mcp y claude-code-runner-mcp
  docs/
    architecture.md            # este documento
    roadmap.md
    hermes/spec.md
    personal-brain/spec.md
```

Gestión del monorepo con **pnpm workspaces** para `apps/brain`, `apps/brain-mcp`, `apps/claude-code-runner-mcp` y `packages/shared` (todo TypeScript). `hermes/` no es un paquete de código propio — es configuración + el Skill (que puede ser markdown/instrucciones, según el formato de hermes-agent) para el proceso de `hermes-agent` que corre desde su propia imagen upstream.

## Contrato entre Hermes y el resto del sistema

hermes-agent no llama a nada directamente salvo a través de **MCP**. Esto es intencional y además es justo el mecanismo de extensión que el propio proyecto expone ("MCP Integration: Connect any MCP server for extended capabilities"). Dos servidores MCP cubren el contrato que nos interesa para el portfolio:

- **`brain-mcp`** expone `brain_query` (envuelve `POST /v1/query`, devuelve fragmentos por similitud — sin observations/mental models en v1) y `brain_record_observation` (envuelve `POST /v1/observations`). Ver el contrato completo en [personal-brain/spec.md](personal-brain/spec.md#52-api-vía-mcp-appsbrain-mcp-lo-que-realmente-consume-hermes).
- **`claude-code-runner-mcp`** expone `run_coding_task(repo, prompt, context)`, que hace todo el trabajo de aislamiento Docker y devuelve un resultado estructurado (éxito/fallo, diff, resumen). Ver detalle en [hermes/spec.md](hermes/spec.md#3-claude-code-runner-mcp).

GitHub, Notion y Jira se resuelven con servidores MCP **ya existentes** de esas plataformas — no construimos conectores propios para leer/escribir en ellas. Solo escribimos el "pegamento" (el Skill) que decide qué hacer con las tools que esos MCP servers exponen.

## Por qué esta separación importa para el portfolio

- Demuestra que sé **evaluar cuándo no construir algo desde cero** (usar hermes-agent en vez de reinventar un orquestador de agentes) y dónde sí aporta valor construir código propio (el runner de Claude Code, el Brain).
- Demuestra diseño de **servidores MCP** como patrón de integración — la pieza de infraestructura de agentes más relevante ahora mismo.
- Demuestra el patrón **"company brain"** aplicado con cabeza: `apps/brain` construye de verdad las capas de ingestion, retrieval y action (consumible no solo por Hermes sino por cualquier cliente MCP), y documenta con precisión la capa de consolidation como trabajo futuro en vez de fingir tenerla — ver [personal-brain/spec.md §0](personal-brain/spec.md#0-alcance-de-este-proyecto--léelo-antes-que-nada).
- Cada pieza (`brain`, `brain-mcp`, `claude-code-runner-mcp`) se puede **evaluar y presentar por separado** o como sistema integrado.

## Despliegue

Un único servidor local — un Mac Mini del Operador, siempre encendido, con Docker y Docker Compose — en vez de un VPS: para este proyecto de uso personal ("andar por casa", ver [hermes/spec.md §0](hermes/spec.md#0-aclaración-importante-qué-es-hermes-aquí)) el coste recurrente de un VPS no compensa, y ni el flujo de GitHub (cron sondeando, Fase 2) ni el de Telegram (long-polling, Fase 3) necesitan puertos de entrada expuestos a internet ni IP pública — todo el tráfico que genera hermes-agent es saliente. Esto sí implica que la disponibilidad depende de la luz/red doméstica del Operador, algo asumido conscientemente dado el alcance personal del proyecto.

- `hermes/docker/docker-compose.yml` levanta: `hermes-agent` (imagen construida del upstream de NousResearch, sin modificar su código), `brain`, `brain-mcp`, `claude-code-runner-mcp`, `postgres` (con `pgvector`).
- `hermes-agent` se configura (`hermes/config/hermes.config.yaml` + `hermes mcp add ...`) para registrar los 5 servidores MCP (GitHub, Notion, Jira, brain-mcp, claude-code-runner-mcp).
- **Separación de privilegios (el punto de diseño más importante del despliegue)**: `claude-code-runner-mcp` corre en **su propio contenedor** y es el **único** con el socket de Docker montado; `hermes-agent` corre en un contenedor **sin** socket. Se comunican por MCP sobre Streamable HTTP en una red interna de Compose, autenticada con un secreto compartido y sin publicar el puerto al host ni a la LAN.

  El motivo: en Docker, poder crear contenedores equivale a control total del host (se puede crear uno que monte el disco entero), y hermes-agent es precisamente el componente que ingiere texto no confiable (cuerpos de issues) — darle esa capacidad convierte cualquier prompt injection en compromiso del Mac Mini. Registrar el runner por stdio lo haría subproceso de hermes y forzaría exactamente eso, por lo que se descarta. Requisitos completos en [security.md](security.md) (SEC-2.1, SEC-3.1 – SEC-3.3, SEC-4.1); detalle de transporte en [hermes/spec.md §3.5](hermes/spec.md#35-transporte-mcp-http-en-red-interna-no-stdio).

- La sesión de Claude Code compartida (`hermes-claude-auth`) es un **secreto** (token `CLAUDE_CODE_OAUTH_TOKEN`, `.env`/secret store), no un volumen Docker con archivos de sesión — ver [hermes/spec.md §0.3](hermes/spec.md#03-corrección-de-diseño--hermes-claude-auth-es-un-token-no-un-volumen-de-archivos), corregido durante la Fase 0 al verificarlo en la práctica.
- El scheduler que dispara periódicamente el Skill `resolve-issue` es el **cron nativo de hermes-agent** (`hermes cron`), no un scheduler propio.
- Reverse proxy (Caddy o Nginx) delante del gateway de hermes-agent solo si en algún momento hiciera falta exponer algo del servidor local a internet (p. ej. la API de Brain para otros usos) — no hace falta para Telegram/GitHub en v1, ver nota de disponibilidad arriba.

No se detalla más infraestructura (Terraform, Kubernetes, etc.) porque no aporta al objetivo del portfolio y añade complejidad operativa innecesaria para un proyecto personal.
