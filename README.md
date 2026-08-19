# PersonalAI

Monorepo de portfolio que demuestra dos patrones de arquitectura de agentes de IA que hoy están de moda en el mundo de "agentic engineering":

1. **[Hermes](docs/hermes/spec.md)** — un despliegue en VPS de **[hermes-agent](https://github.com/NousResearch/hermes-agent)** (el agente open-source de Nous Research), configurado y extendido con servidores MCP propios y de terceros (GitHub, Notion, Jira, y nuestro propio Brain) más un Skill a medida que le enseña a coger tareas y delegar el trabajo de código en instancias efímeras de Claude Code corriendo en contenedores Docker.
2. **[Personal Brain](docs/personal-brain/spec.md)** — una implementación personal (no corporativa) del patrón "company brain" descrito en [vectorize.io](https://vectorize.io/articles/how-to-build-company-brain) y [gurusup.com](https://gurusup.com/es/brain): una capa de memoria compartida, evolutiva y consultable por agentes, que centraliza el contexto de mis proyectos, decisiones y notas.

No son dos demos aisladas: **Hermes consulta a Brain (vía MCP) antes de actuar**. Ese es el hilo conductor y la parte más interesante de este proyecto a nivel de portfolio: no es "otro wrapper de Claude Code", ni "otro RAG sobre mis notas" — es la combinación de un agente autónomo ya maduro, extendido con herramientas propias, más una memoria organizacional que aprende.

> **Importante**: "Hermes" no es un orquestador que construimos desde cero. Es [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent), un proyecto MIT ya existente con gateway multi-plataforma (Telegram, Discord, Slack...), memoria persistente, sistema de skills, cron scheduler, delegación de subagentes y backends de ejecución (local, Docker, SSH...) e integración MCP nativa. Nuestro trabajo no es reinventar ese motor, sino **desplegarlo y extenderlo**: registrarle los servidores MCP que necesita (GitHub/Notion/Jira/Brain) y construir el servidor MCP que sabe lanzar Claude Code en un contenedor aislado por tarea. Ver [hermes/spec.md](docs/hermes/spec.md#0-aclaración-importante-qué-es-hermes-aquí) para el detalle de esta distinción.

## Objetivo del proyecto

Este proyecto es principalmente una pieza de **portfolio técnico** (para enseñar a clientes/reclutadores que sé diseñar y construir agentes autónomos y sistemas de memoria tipo "company brain"), aunque también está pensado para **uso personal real** una vez esté operativo: quiero que Hermes me resuelva issues reales de mis propios repos, y que Brain sea mi segundo cerebro de verdad.

## Estructura de la documentación (spec-driven development)

Este repo se desarrolla siguiendo un enfoque *spec-first*: antes de escribir código, se definen specs detalladas para que Claude Code (u otro coding agent) tenga contexto suficiente para implementar sin ambigüedad.

| Documento | Contenido |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Visión general del sistema, estructura del monorepo, diagrama de integración Hermes ↔ MCP servers ↔ Brain |
| [docs/roadmap.md](docs/roadmap.md) | Roadmap *spec-driven*, por fases: objetivo, user stories con criterios de aceptación, y Definition of Done por fase |
| [docs/hermes/spec.md](docs/hermes/spec.md) | Spec de despliegue/configuración de hermes-agent + specs de los MCP servers y el Skill que construimos nosotros |
| [docs/personal-brain/spec.md](docs/personal-brain/spec.md) | Spec funcional y técnica completa del Personal Brain |

## Decisiones ya tomadas (no las vuelvas a preguntar)

- **Hermes = NousResearch/hermes-agent desplegado**, no un orquestador propio. Lo que construimos es: (a) un servidor MCP que sabe lanzar Claude Code en Docker por tarea, (b) un servidor MCP adaptador para Brain, (c) la configuración de hermes-agent (MCP servers registrados, cron, modelo) y (d) un Skill que define el procedimiento "coger tarea → preguntar a Brain → delegar en Claude Code → reportar".
- **Stack**: TypeScript en todo el código que construimos nosotros (los MCP servers, el Brain). hermes-agent en sí es Python/TypeScript upstream, no lo tocamos salvo configuración.
- **Integraciones de tareas para Hermes**: GitHub Issues, Notion y Jira desde el inicio, vía servidores MCP existentes de esas plataformas (no conectores custom).
- **Aislamiento de ejecución de Claude Code**: cada tarea corre en un contenedor Docker efímero, con su propio checkout del repo, lanzado por nuestro servidor MCP `claude-code-runner`, y destruido al terminar.
- **Infraestructura**: cualquier VPS Linux (Ubuntu 22.04/24.04) con Docker. El spec no asume un proveedor concreto.
- **Relación entre proyectos**: Brain es la memoria compartida, expuesta como servidor MCP; hermes-agent (y potencialmente otros agentes MCP-compatibles futuros) la consultan y escriben en ella. Brain debe poder vivir y evaluarse de forma independiente de Hermes.
- **Alcance**: personal, no multi-tenant — pero el modelo de datos de Brain se diseña para que el patrón generalice a un "company brain" real en el futuro (ver spec de Brain, sección de permisos).
