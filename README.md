# PersonalAI

Monorepo de portfolio que demuestra dos patrones de arquitectura de agentes de IA que hoy están de moda en el mundo de "agentic engineering":

1. **[Hermes](docs/hermes/spec.md)** — un despliegue en local (hoy WSL2/Docker Desktop; destino planeado, un Mac Mini) de **[hermes-agent](https://github.com/NousResearch/hermes-agent)** (el agente open-source de Nous Research), configurado y extendido con servidores MCP propios y de terceros (GitHub, nuestro propio Brain) más un Skill a medida que le enseña a coger tareas y delegar el trabajo de código en instancias efímeras de Claude Code corriendo en contenedores Docker. En v1 se puede hablar con él tanto etiquetando issues de GitHub como directamente por Telegram, mandándole tareas ad-hoc y recibiendo un aviso cuando terminan.
2. **[Personal Brain](docs/personal-brain/spec.md)** — una memoria compartida y consultable por agentes, inspirada en el patrón "company brain" descrito en [vectorize.io](https://vectorize.io/articles/how-to-build-company-brain) y [gurusup.com](https://gurusup.com/es/brain). **Importante**: en este proyecto Brain se construye deliberadamente básico (ingestión + búsqueda por similitud semántica, nada más) — la capa de consolidación (extracción de hechos, reconciliación de contradicciones, mental models) que completaría el patrón "company brain" está diseñada en el spec pero queda como trabajo futuro que construiré yo por mi cuenta más adelante. Ver [personal-brain/spec.md §0](docs/personal-brain/spec.md#0-scope-of-this-project--read-this-first).

No son dos demos aisladas: **Hermes consulta a Brain (vía MCP) antes de actuar**. Ese es el hilo conductor y la parte más interesante de este proyecto a nivel de portfolio: no es "otro wrapper de Claude Code", ni "otro RAG sobre mis notas" — es la combinación de un agente autónomo ya maduro, extendido con herramientas propias, más una memoria simple que va guardando contexto real de lo que hace.

> **Importante**: "Hermes" no es un orquestador que construimos desde cero. Es [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent), un proyecto MIT ya existente con gateway multi-plataforma (Telegram, Discord, Slack...), memoria persistente, sistema de skills, cron scheduler, delegación de subagentes y backends de ejecución (local, Docker, SSH...) e integración MCP nativa. Nuestro trabajo no es reinventar ese motor, sino **desplegarlo y extenderlo**: registrarle los servidores MCP que necesita (GitHub/Notion/Jira/Brain) y construir el servidor MCP que sabe lanzar Claude Code en un contenedor aislado por tarea. Ver [hermes/spec.md](docs/hermes/spec.md#0-important-clarification-what-hermes-means-here) para el detalle de esta distinción.

## Objetivo del proyecto

Este proyecto es, ante todo, **mi sistema de IA personal** — un TODO-EN-1 backed by Claude Code, desplegado en un servidor local (hoy WSL2/Docker Desktop; el destino planeado es un Mac Mini dedicado — ver [docs/architecture.md §Despliegue](docs/architecture.md#deployment)), hablable desde el móvil. También es una pieza de portfolio técnico (demuestra que sé diseñar y construir agentes autónomos y el patrón de integración Hermes ↔ MCP ↔ memoria), pero eso es secundario al uso real. **v1** — ver [docs/decisions-log.md §Milestone v1](docs/decisions-log.md#milestone-v1--qué-es-la-primera-versión) — es Hermes desplegado en local resolviendo issues de GitHub, hablable por Telegram, con un Brain básico consultado antes de actuar. Notion/Jira, el pulido de portfolio y el Company Brain completo (consolidación real) quedan como **futuribles**, explícitamente post-v1 y sin bloquear el hito.

## Puesta en marcha

**[docs/quickstart.md](docs/quickstart.md)** — de un `git clone` limpio a un sistema
funcionando, con cada credencial manual explicada y qué significa "hecho" para cada una.

Para trabajar en el código sin desplegar el stack completo basta con:

- **Node.js 20** o superior
- **pnpm 9** (el repo fija `packageManager` en el `package.json` raíz)
- **Docker** y **Docker Compose**

## Estructura de la documentación (spec-driven development)

Este repo se desarrolla siguiendo un enfoque _spec-first_: antes de escribir código, se definen specs detalladas para que Claude Code (u otro coding agent) tenga contexto suficiente para implementar sin ambigüedad.

| Documento                                                  | Contenido                                                                                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [docs/quickstart.md](docs/quickstart.md)                   | De un clon limpio a un sistema funcionando — credenciales manuales, `.env`, build, verificación                                           |
| [docs/architecture.md](docs/architecture.md)               | Visión general del sistema, estructura del monorepo, diagrama de integración Hermes ↔ MCP servers ↔ Brain                                 |
| [docs/roadmap.md](docs/roadmap.md)                         | **Empieza aquí para saber qué es esto y qué viene**: estado actual y las fases abiertas                                                   |
| [docs/decisions-log.md](docs/decisions-log.md)             | La bitácora completa: cada fase cerrada, cada bug encontrado, cada hipótesis descartada y cada decisión revertida, con su porqué          |
| [docs/agent-evals/spec.md](docs/agent-evals/spec.md)       | Spec de la suite de evals de inyección — convierte los requisitos de `security.md` en comprobaciones ejecutables (Fase 18)                |
| [docs/security.md](docs/security.md)                       | **Modelo de seguridad**: requisitos innegociables numerados (`SEC-x.y`) por capas, qué verifica cada fase, y qué riesgos quedan aceptados |
| [docs/hermes/spec.md](docs/hermes/spec.md)                 | Spec de despliegue/configuración de hermes-agent + specs de los MCP servers y el Skill que construimos nosotros                           |
| [docs/personal-brain/spec.md](docs/personal-brain/spec.md) | Spec funcional y técnica completa del Personal Brain                                                                                      |

## Decisiones ya tomadas (no las vuelvas a preguntar)

- **Hermes = NousResearch/hermes-agent desplegado**, no un orquestador propio. Lo que construimos es: (a) un servidor MCP que sabe lanzar Claude Code en Docker por tarea, (b) un servidor MCP adaptador para Brain, (c) la configuración de hermes-agent (MCP servers registrados, cron, modelo, gateway de Telegram) y (d) un Skill que define el procedimiento "coger tarea → preguntar a Brain → delegar en Claude Code → reportar".
- **Stack**: TypeScript en todo el código que construimos nosotros (los MCP servers, el Brain). hermes-agent en sí es Python/TypeScript upstream, no lo tocamos salvo configuración.
- **Integraciones de tareas para Hermes en v1**: GitHub Issues (etiquetadas) y Telegram (conversacional, ad-hoc) — ambas vía lo que ya trae hermes-agent (MCP de GitHub + gateway nativo), sin conectores propios. Notion y Jira quedan como futuribles post-v1.
- **Aislamiento de ejecución de Claude Code**: cada tarea corre en un contenedor Docker efímero, con su propio checkout del repo, lanzado por nuestro servidor MCP `claude-code-runner`, y destruido al terminar — independientemente de si la tarea vino de GitHub o de Telegram.
- **Separación de privilegios (innegociable)**: `claude-code-runner-mcp` corre en su propio contenedor y es el **único** con acceso al socket de Docker; hermes-agent corre en un contenedor **sin** socket y se comunica con él por MCP sobre HTTP autenticado en una red interna. Motivo: acceso al socket de Docker ≡ control total del host, y hermes-agent es el componente que ingiere texto no confiable (cuerpos de issues). Ver [docs/security.md](docs/security.md).
- **Sin puertos entrantes**: hablar con Hermes desde fuera de casa no requiere abrir nada en el router — el gateway de Telegram usa long polling y el cron de GitHub sondea de salida. Nada de túneles ni port forwarding (SEC-0.1/SEC-0.2).
- **Infraestructura**: un servidor local (hoy WSL2/Docker Desktop del Operador; destino planeado, un Mac Mini dedicado) con Docker. Se descarta un VPS por coste — ver [docs/architecture.md §Despliegue](docs/architecture.md#deployment) para el razonamiento y las implicaciones de seguridad/disponibilidad.
- **Relación entre proyectos**: Brain es la memoria compartida, expuesta como servidor MCP; hermes-agent (y potencialmente otros agentes MCP-compatibles futuros) la consultan y escriben en ella. Brain debe poder vivir y evaluarse de forma independiente de Hermes.
- **Alcance**: personal, no multi-tenant — pero el modelo de datos de Brain se diseña para que el patrón generalice a un "company brain" real en el futuro (ver spec de Brain, sección de permisos).
- **Brain se mantiene básico en este proyecto**: ingestión + búsqueda por similitud, sin capa de consolidación (extracción de hechos vía LLM, reconciliación, mental models). Esa capa está diseñada en el spec como referencia, pero no se construye aquí — es trabajo futuro que haré yo por mi cuenta.
- **Orden de las fases (Milestone v1 = Fases 0 a 5)**: fundación (0), `claude-code-runner-mcp` (1), hermes-agent en local + GitHub (2), Telegram (3), Brain básico (4), integración Brain↔Hermes (5). Notion/Jira y pulido de portfolio son futuribles post-v1. Ver [docs/roadmap.md](docs/roadmap.md).

## Métricas de uso

`personalai-metrics` (en `apps/metrics-cli`) imprime un informe de solo lectura del uso real del sistema: tareas delegadas a Claude Code y su tasa de éxito por tool, y eventos ingestados en Brain. Necesita `DATABASE_URL` apuntando a la misma base de datos que usan el runner y Brain.

```sh
pnpm --filter @personalai/metrics-cli run build
DATABASE_URL=postgresql://... node apps/metrics-cli/dist/index.js
DATABASE_URL=postgresql://... node apps/metrics-cli/dist/index.js --json
```

Las mismas métricas se pueden pedir por Telegram: Hermes las sirve con la tool MCP `get_metrics` a través del skill `status-report` ("dame las métricas", "¿cuántas tareas has resuelto?"). El SQL vive en `@personalai/shared`, así que las dos superficies dan el mismo número.

Y hay un **bot de control** de Telegram (`apps/control-bot`) con su propio token: `/metricas` responde calculando directamente sobre la base de datos, sin modelo de por medio y sin gastar cuota de Claude Pro. Es la vía determinista; la conversacional sigue existiendo para quien prefiera preguntar con lenguaje natural.

La cuenta de tareas de las últimas 5 h es un **proxy** de la ventana de cuota de Claude Pro, no consumo real: Anthropic no expone esa telemetría por API (ver Fase 12 del roadmap).

## Licencia

Este proyecto es de uso personal y no está licenciado para redistribución.
