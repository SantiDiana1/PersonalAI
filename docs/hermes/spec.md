# Spec — Hermes

> **Proyecto de andar por casa.** Este spec asume un único operador, uso personal, no producción ni multiusuario.

## 0. Aclaración importante: qué es "Hermes" aquí

**Hermes = [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) desplegado en un VPS**, no un orquestador que construimos desde cero. Es un proyecto open-source (MIT, ~230k★) de Nous Research que ya trae:

- Un **agent loop** con modelo intercambiable (Anthropic, OpenAI, OpenRouter, Nous Portal, endpoints propios).
- **Memoria persistente** propia (memoria curada, búsqueda FTS5 de sesiones, modelado de usuario) y un **sistema de skills** (memoria procedimental, compatible con el estándar abierto [agentskills.io](https://agentskills.io/)).
- Un **gateway multi-plataforma** (Telegram, Discord, Slack, WhatsApp, Signal, CLI) — un único proceso, se le puede hablar desde el móvil mientras trabaja en el VPS.
- **Cron scheduler** integrado para automatizaciones ("daily reports, nightly backups, weekly audits... running unattended").
- **Delegación de subagentes** para paralelizar trabajo.
- **Siete backends de ejecución de comandos**: local, Docker, SSH, Singularity, Modal, Daytona, Vercel Sandbox — con aislamiento de contenedor ya contemplado en su modelo de seguridad ("Command approval, DM pairing, container isolation").
- **Integración MCP nativa**: "Connect any MCP server for extended capabilities" — este es el mecanismo de extensión que usamos para todo lo que hermes-agent no trae de fábrica.

Dado esto, **nuestro trabajo no es reimplementar nada de lo anterior**. Es construir las tres piezas que le faltan para este caso de uso concreto:

1. **`claude-code-runner-mcp`** — servidor MCP que sabe lanzar Claude Code en un contenedor Docker efímero por tarea (sección 3).
2. **`brain-mcp`** — servidor MCP adaptador sobre la API de nuestro Personal Brain (contrato detallado en [personal-brain/spec.md](../personal-brain/spec.md#api-vía-mcp)).
3. **El Skill `resolve-issue`** — el procedimiento, en el formato de skills de hermes-agent, que le dice al agente qué hacer y en qué orden (sección 5).

Todo lo demás (leer GitHub Issues, leer Notion, leer Jira) se resuelve registrando servidores MCP **de terceros ya existentes** para esas plataformas — no se escriben conectores propios.

### 0.1 Autenticación: token OAuth de larga duración para todo, vía suscripción Pro

**Decisión de este proyecto**: tanto el propio hermes-agent (para su agent loop / chat) como los contenedores de `claude-code-runner-mcp` (para resolver issues) se autentican **exclusivamente con un token OAuth de larga duración de la suscripción Pro del operador**, nunca con `ANTHROPIC_API_KEY`. En la práctica esto significa:

- El token se genera **una única vez** en el host con `claude setup-token` (login interactivo, ver §0.3), que **imprime por stdout** un token de larga duración (`sk-ant-oat01-...`) — no crea ni deja ningún archivo de sesión reutilizable. Ese token se guarda como secreto único, `hermes-claude-auth` (§0.3), inyectado como variable de entorno `CLAUDE_CODE_OAUTH_TOKEN`.
- **hermes-agent** no necesita ningún wrapper propio: soporta de fábrica el proveedor `anthropic` (alias `claude-code`) autenticándose vía `CLAUDE_CODE_OAUTH_TOKEN` (o, alternativamente, detectando `~/.claude/.credentials.json` si existiera de un login interactivo completo — no es el caso aquí). Confirmado explorando su código real (`agent/anthropic_adapter.py`, `hermes_cli/auth.py`) — ver `docs/hermes/exploration-notes.md` §4 para el detalle. No se construye ningún wrapper.
- **`claude-code-runner-mcp`** inyecta el mismo `CLAUDE_CODE_OAUTH_TOKEN` como variable de entorno en cada contenedor efímero, y ejecuta `claude -p` de forma no interactiva (§3.2) — el CLI de Claude Code soporta esta variable nativamente para uso headless, es su mecanismo documentado para CI/entornos sin navegador.
- Un único secreto (`hermes-claude-auth`, el valor del token), compartido por ambos componentes vía sus respectivos `.env`/secret store — **no** es un volumen Docker con archivos de sesión (ver §0.3 para la corrección respecto al diseño original de este spec).

### 0.2 Nota de riesgo — léela antes de desplegar

Esto **viola explícitamente los Términos de Servicio de consumidor de Anthropic**. Desde febrero de 2026, Anthropic aclaró que los tokens OAuth de cuentas Free/Pro/Max están autorizados únicamente para Claude Code y Claude.ai — no para el Agent SDK, ni para terceros que envuelvan el CLI para otros fines (como hace este proyecto con hermes-agent).

- **No hay bloqueo técnico**: el token OAuth es válido para cualquier llamada, la haga el CLI oficial o un wrapper. Por eso esto es viable de implementar.
- **Sí hay riesgo contractual**: si Anthropic lo detecta, la consecuencia habitual es suspensión de la cuenta — no solo del uso automatizado, sino de tu cuenta Pro entera, incluyendo tu uso normal de Claude Code para tu trabajo diario.
- **Precedente**: el propio proyecto NanoClaw tiene un issue abierto (#1224) discutiendo esto tras la aclaración de ToS de febrero 2026; la comunidad lo trata como "riesgo asumido por el usuario", no como algo resuelto o sancionado por Anthropic.
- Este proyecto se hace con ese riesgo **consciente y aceptado** por el operador, como experimento personal de bajo volumen — no como base para un despliegue de cara a terceros ni como pieza de portfolio profesional sin matizar este punto.
- Mitigación parcial: mantener el secreto `hermes-claude-auth` (el token) como único punto de fallo — si Anthropic revoca la sesión, se reautentica a mano (§3.3) y punto; no se automatiza la reautenticación para no agravar la situación con extracción de tokens adicional.

### 0.3 Corrección de diseño — `hermes-claude-auth` es un token, no un volumen de archivos

**Verificado en la práctica al ejecutar US-0.4 (Fase 0)**: el diseño original de este documento asumía que `claude setup-token` genera un archivo de sesión persistente (tipo `~/.claude/.credentials.json`) que se podía montar como volumen Docker read-only y compartir entre contenedores. Esto **no es así**:

- `claude setup-token` (`Usage: claude setup-token [options]` — _"Set up a long-lived authentication token"_) **imprime el token por stdout** y no persiste ningún archivo de sesión reutilizable en `~/.claude/`. Confirmado montando un volumen Docker en el `$HOME` de un contenedor efímero, ejecutando `claude setup-token` con login interactivo completo, y verificando después que no existe `~/.claude/.credentials.json` ni ningún token real en `~/.claude.json` (solo metadata de arranque) — el volumen quedaba vacío de credenciales tras el login.
- El mecanismo real y documentado por Anthropic para este caso (headless/CI) es: capturar el token impreso y exportarlo como variable de entorno `CLAUDE_CODE_OAUTH_TOKEN` — que tanto `claude -p` (el CLI) como hermes-agent (`hermes_cli/auth.py: api_key_env_vars=(...,"CLAUDE_CODE_OAUTH_TOKEN")`) soportan nativamente.

**Diseño corregido**: `hermes-claude-auth` es el **valor del token** (`sk-ant-oat01-...`), generado una vez con `claude setup-token`, guardado como secreto (`.env` fuera de git en local/dev; el mecanismo de secretos del VPS en producción — nunca en el repo ni horneado en una imagen), e inyectado como `CLAUDE_CODE_OAUTH_TOKEN` tanto en el proceso de hermes-agent como en cada contenedor efímero de `claude-code-runner-mcp`. Todas las referencias de este documento a "volumen `hermes-claude-auth` montado read-only en `/root/.claude`" deben leerse como "variable de entorno `CLAUDE_CODE_OAUTH_TOKEN` inyectada desde el secreto `hermes-claude-auth`" — el resto del razonamiento (sesión única compartida, sin API key, riesgo de ToS de §0.2, reautenticación manual) no cambia.

Verificado extremo a extremo (US-0.4): `docker run --env-file .env ... claude -p "..."` responde correctamente usando únicamente `CLAUDE_CODE_OAUTH_TOKEN`, sin exponer el valor del token en ningún log.

## 1. Objetivos

- Reducir el tiempo entre "escribo una issue en uno de mis repos (o una tarea en Notion/Jira)" y "tengo un PR que la resuelve o la intenta resolver".
- Demostrar cómo extender un agente de terceros ya maduro con MCP servers y skills propios, en vez de construir un orquestador desde cero.
- Demostrar un patrón de aislamiento seguro para delegar ejecución de código a un coding agent (Claude Code) sin darle acceso irrestricto al VPS.
- Servir de consumidor de referencia del Brain — validar que la memoria organizacional aporta valor real a un agente que actúa.
- Experimentar, para uso personal, con un único mecanismo de auth por suscripción Pro para todo el sistema (ver §0.1), evitando gestionar credenciales de API distintas para cada componente.

## 2. No-objetivos (v1)

- No modificamos el código fuente de hermes-agent más allá de lo necesario para el wrapper de auth de §0.1 — el resto se configura, no se reimplementa.
- No sustituye a un humano revisando el PR antes de mergear — el flujo abre PRs, no los mergea automáticamente.
- No gestiona proyectos completos ni planifica sprints — solo ejecuta tareas ya definidas y etiquetadas explícitamente para él.
- No soporta múltiples usuarios/tenants — un único operador (yo) configura sus propias credenciales y su propia instancia de hermes-agent.
- No implementa heurísticas de qué issues merece la pena coger — la selección es explícita (label/estado en la fuente), no inferida.
- No se automatiza la reautenticación de la sesión de Claude Code cuando expira o es revocada — es un paso manual del operador (ver 3.3).
- No se despliega este sistema para terceros ni se ofrece como servicio — uso estrictamente personal, dado el riesgo de ToS descrito en §0.2.

## 3. `claude-code-runner-mcp`

El componente más parecido a "construir un ejecutor desde cero" de todo el proyecto — es la pieza que de verdad escribimos nosotros en TypeScript.

### 3.1 Contrato MCP

Expone una única tool principal:

```ts
// tool: run_coding_task
//
// Auth: el contenedor NO recibe ninguna credencial de Anthropic nueva.
// Hereda la sesión de Claude Code del operador vía el secreto hermes-claude-auth
// (token de larga duración, inyectado como variable de entorno
// CLAUDE_CODE_OAUTH_TOKEN), generado una única vez en el host con
// `claude setup-token`. Es la MISMA sesión que usa hermes-agent para su
// propio chat (ver spec §0.1/§0.3). Ver §3.2 y §3.3.
interface RunCodingTaskInput {
  repo: string; // owner/repo
  baseBranch?: string; // por defecto la rama por defecto del repo
  taskTitle: string;
  taskDescription: string;
  brainContext?: string; // texto ya recuperado de brain-mcp, para inyectar en el prompt
  timeoutSeconds?: number; // por defecto 1800 (30 min)
}

interface RunCodingTaskOutput {
  status: 'success' | 'failed' | 'needs_human_input' | 'timed_out';
  branchName?: string; // rama empujada, si hubo cambios
  commitShas?: string[];
  summary: string; // resumen de lo hecho, generado por Claude Code
  logsUrl?: string; // referencia a logs guardados, si aplica
}
```

`needs_human_input` cubre tanto los casos en que Claude Code necesita aclaración sobre la tarea como el caso de sesión de Claude Code expirada o revocada (ver 3.3) — el `summary` distingue el motivo.

### 3.2 Qué hace internamente

1. Comprueba que el token de la sesión de Claude Code (`hermes-claude-auth`) sigue siendo válido (ver 3.3). Si no lo es, devuelve `status: 'needs_human_input'` inmediatamente, sin lanzar contenedor.
2. Clona (shallow) el repo indicado en un volumen efímero.
3. Genera un `prompt.md` con: título + descripción de la tarea, `brainContext` si se proporcionó, e instrucciones de estilo/convenciones básicas del repo.
4. Lanza un contenedor Docker (`docker run`, vía `dockerode`) a partir de una imagen `claude-code-runner-image` (Node.js + git + Claude Code CLI instalado, sin credenciales horneadas).
5. Monta el volumen con el repo + `prompt.md`, e inyecta como variables de entorno: `CLAUDE_CODE_OAUTH_TOKEN` (el secreto `hermes-claude-auth`, la sesión autenticada de Claude Code del operador) y el token de GitHub de vida corta scoped al repo concreto.
6. Ejecuta `claude -p` de forma no interactiva contra el prompt, con timeout.
7. Al terminar (o al hacer timeout), recoge del contenedor: los commits generados y un `result.json` que Claude Code (o un wrapper alrededor) escribe con resumen y estado.
8. Hace `docker rm -f` del contenedor — siempre, en cualquier desenlace. El secreto `hermes-claude-auth` no se toca ni se destruye; es compartido entre ejecuciones, incluidas las del propio hermes-agent.
9. Empuja la rama (si hay cambios) y devuelve el `RunCodingTaskOutput` como respuesta de la tool MCP. Abrir el PR en sí **no** lo hace esta tool — eso lo hace el Skill llamando al GitHub MCP, para no duplicar lógica de GitHub en dos sitios.

### 3.3 Limitación conocida: expiración o revocación de sesión

El token de sesión OAuth de Claude Code caduca periódicamente (del orden de horas) y, al usarse fuera del uso previsto por Anthropic (§0.2), puede además ser **revocado sin previo aviso** si Anthropic detecta el patrón de uso. Esto es una limitación aceptada, no un bug a resolver:

- `claude-code-runner-mcp` comprueba la validez de la sesión (p. ej. `claude /status` o equivalente) **antes** de lanzar cada contenedor (paso 3.2.1).
- El propio hermes-agent debería hacer una comprobación equivalente antes de procesar cualquier mensaje, ya que comparte la misma sesión.
- Si la sesión ha expirado o ha sido revocada, la tool devuelve `status: 'needs_human_input'` con un `summary` explícito, distinguiendo ambos casos si es posible ("sesión expirada, requiere `claude /login`" vs. "sesión rechazada por el servidor — posible revocación, revisar estado de la cuenta antes de reintentar").
- El Skill `resolve-issue` (sección 5) trata este caso igual que cualquier otro `needs_human_input`: comenta en la tarea original y no abre PR.
- La reautenticación (`claude /login` o `claude setup-token` en el host) es **manual**. No se automatiza.
- Consecuencia práctica: si Hermes va a correr desatendido varios días, conviene monitorizar este estado (vía el gateway de Telegram/Discord de hermes-agent, sección 9) para no descubrir la expiración — o una eventual suspensión de cuenta — solo cuando se acumulan tareas en `needs_human_input`.

### 3.4 Aislamiento de ejecución (no negociable)

- Un contenedor efímero por tarea, destruido al terminar o al hacer timeout — nunca quedan contenedores huérfanos.
- El contenedor **no tiene acceso al Docker socket** (no puede lanzar más contenedores) y su red está restringida a una allowlist (`api.anthropic.com`, `github.com` — solo lo estrictamente necesario para esa tarea; sin acceso libre a Internet).
- Credenciales de vida corta con scope mínimo para GitHub (token limitado al repo de la tarea, nunca un token global de cuenta). El token de Claude Code, al ser compartido vía el secreto `hermes-claude-auth`, es la única credencial de larga duración presente en el sistema — se inyecta únicamente como variable de entorno del proceso `claude` dentro del contenedor, nunca se escribe a disco ni queda accesible al resto del sistema de archivos del contenedor.
- Sin acceso al filesystem del host más allá del volumen efímero de esa tarea (el secreto de auth no es un volumen — ver §0.3).
- `claude-code-runner-mcp` es el **único** componente del sistema con acceso al socket de Docker del host — ni hermes-agent, ni brain-mcp lo necesitan.

Esta es la parte de seguridad más sensible del proyecto: un agente que ejecuta código arbitrario delegado por otro agente es, por definición, una superficie de ataque. Especial cuidado con **prompt injection** desde el cuerpo de issues de terceros (ver sección 6).

## 4. Servidores MCP de terceros (GitHub, Notion, Jira)

Se usan servidores MCP ya existentes y mantenidos, no conectores propios:

- **GitHub**: [github/github-mcp-server](https://github.com/github/github-mcp-server) (oficial). Se autentica con un GitHub App o PAT fine-grained, scoped solo a los repos donde quiero que Hermes actúe (`issues:write`, `contents:write`, `pull_requests:write` — nada más).
- **Notion**: servidor MCP oficial de Notion. Apunta a una base de datos concreta ("Hermes Tasks") filtrando por una propiedad `status`.
- **Jira**: servidor MCP de Atlassian/comunidad, configurado con un JQL fijo (por defecto `labels = hermes AND status = "To Do"`).

Registro en hermes-agent (`hermes/config/hermes.config.yaml` + `hermes mcp add <server>`), cada uno con sus propias credenciales de mínimo privilegio. Estas credenciales (GitHub/Notion/Jira) sí son API keys/tokens convencionales — solo la parte de modelo Anthropic usa la sesión Pro compartida (§0.1).

## 5. El Skill `resolve-issue`

Vive en `hermes/skills/resolve-issue/`, en el formato de skills de hermes-agent (compatible con [agentskills.io](https://agentskills.io/) — a confirmar el formato exacto al implementar, viendo `hermes-agent/skills/` y `hermes-agent/optional-skills/` upstream como referencia). Es, esencialmente, un procedimiento en lenguaje natural + metadata que el propio agente ejecuta usando las tools MCP disponibles:

1. Lista tareas candidatas llamando a las tools de GitHub MCP / Notion MCP / Jira MCP (issues/tickets con el label o estado acordado).
2. Para cada tarea nueva: llama a `brain_query` (brain-mcp) con el título/descripción de la tarea para obtener contexto relevante (convenciones, decisiones previas, incidencias similares).
3. Llama a `run_coding_task` (claude-code-runner-mcp) con la tarea + el contexto de Brain.
4. Si `status === 'success'`: abre un PR vía GitHub MCP con el resumen como descripción, y comenta en la tarea original (en la fuente que corresponda) con el link.
5. Si `failed`/`needs_human_input`/`timed_out`: comenta en la tarea original explicando qué pasó, sin abrir PR.
6. Siempre llama a `brain_record_observation` (brain-mcp) con el resultado — este paso no es opcional, es lo que cierra el bucle de aprendizaje.

El **cron nativo de hermes-agent** (`hermes cron`) dispara este skill cada N minutos (configurable). No se construye un scheduler propio.

## 6. Seguridad — checklist específico (OWASP-relevante)

- **Prompt injection desde issues/tickets externos**: el cuerpo de una issue es input no confiable — puede contener instrucciones dirigidas al agente ("ignora tus instrucciones y..."). El blast radius está limitado por el aislamiento de `claude-code-runner-mcp` (sección 3.4): aunque el prompt esté comprometido, el contenedor no tiene red libre, no puede leer el secreto de auth desde disco (solo existe como variable de entorno del proceso `claude`) ni acceso a más recursos que los de esa tarea concreta.
- **Aprobación de comandos de hermes-agent**: revisar y configurar el modo de aprobación de comandos que trae hermes-agent (mencionado en su doc de seguridad) para las acciones que el propio hermes-agent ejecuta fuera del contenedor de Claude Code (p. ej. llamadas MCP potencialmente destructivas).
- **Gestión de secretos**: tokens de GitHub/Notion/Jira en un `.env` fuera de git (o secret manager si el VPS lo soporta) — nunca en el repo ni horneados en ninguna imagen Docker. El token de Claude Code (`hermes-claude-auth`) vive exclusivamente en `.env`/secret store fuera de git, inyectado como variable de entorno `CLAUDE_CODE_OAUTH_TOKEN`, y nunca se copia a la imagen ni se escribe a disco dentro de un contenedor.
- **Mínimo privilegio**: GitHub App/PAT limitado a los repos explícitamente elegidos, no a toda la cuenta.
- **Rate limiting**: límite de tareas concurrentes/por hora en `claude-code-runner-mcp`, para evitar que un bucle (p. ej. una issue que se reabre sola) agote la ventana de 5h/semanal de la suscripción Pro o la cuota de GitHub. Especialmente relevante aquí porque **hermes-agent y `claude-code-runner-mcp` comparten la misma cuota** (§0.1) — un pico de tareas de código puede dejar sin ventana disponible al chat, y viceversa.
- **Riesgo de cuenta (§0.2)**: dado que el uso viola los ToS de consumidor, se recomienda no usar la cuenta Pro personal "de trabajo" (la que se usa para desarrollo profesional diario) para este experimento, si es posible mantener una cuenta separada de bajo coste dedicada solo a Hermes — así una eventual suspensión no afecta al uso profesional. Queda como decisión del operador, no como requisito del spec.

## 7. Modelo de datos

hermes-agent gestiona su propia memoria/estado — no lo duplicamos. Lo único que persistimos nosotros es el estado operacional de `claude-code-runner-mcp` (Postgres, esquema `runner`):

```sql
create table task_runs (
  id uuid primary key default gen_random_uuid(),
  repo text not null,
  task_title text not null,
  status text not null default 'running', -- running|success|failed|timed_out|needs_human_input
  brain_context jsonb,
  result jsonb,
  branch_name text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
```

Útil sobre todo para depuración y para las métricas de uso personal (nº de tareas resueltas, tasa de éxito, frecuencia de `needs_human_input` por sesión caducada/revocada).

## 8. Stack técnico

- **hermes-agent**: se despliega tal cual (imagen Docker upstream), sin ninguna modificación de código — su proveedor `anthropic`/`claude-code` ya soporta `CLAUDE_CODE_OAUTH_TOKEN` de fábrica (ver §0.1/§0.3). No hace falta ningún wrapper.
- **`claude-code-runner-mcp`** y **`brain-mcp`**: TypeScript + Node.js, SDK oficial de MCP (`@modelcontextprotocol/sdk`), `dockerode` para orquestar contenedores.
- Postgres para el estado operacional del runner (esquema separado del de Brain).
- `pino` para logging estructurado.
- Secreto `hermes-claude-auth` (token de larga duración `CLAUDE_CODE_OAUTH_TOKEN`, generado manualmente por el operador antes del primer despliegue vía `claude setup-token` ejecutado en el host, guardado en `.env`/secret store fuera de git), **compartido entre hermes-agent y `claude-code-runner-mcp`** — ver §0.3.

## 9. Preguntas abiertas

- ~~¿El wrapper de hermes-agent...?~~ Resuelto en Fase 0 (§0.3): no hace falta wrapper, hermes-agent soporta `CLAUDE_CODE_OAUTH_TOKEN` nativamente.
- ¿Cómo se comparte la cuota de la ventana de 5h/semanal entre el chat de hermes-agent y las tareas de `claude-code-runner-mcp` sin que una acapare a la otra? Candidato simple para v1: límite duro de tareas de código concurrentes/por hora (ya recogido en §6), revisando manualmente si hace falta ajustar.
- ¿Se usa `hermes setup --portal` (Nous Portal, todo-en-uno) o BYO keys por integración? Ya no aplica al modelo Anthropic (ahora vía sesión Pro compartida), pero sigue siendo relevante para otros proveedores si en algún momento se quisiera usar un modelo distinto para partes no críticas.
- ¿Formato exacto del Skill `resolve-issue`? Pendiente de revisar la carpeta `skills/`/`optional-skills/` del repo de hermes-agent al implementar, para seguir su convención exacta (frontmatter, estructura de carpetas).
- ¿GitHub App real o PAT fine-grained por repo para v1? Recomendado: empezar con PAT fine-grained para ir más rápido.
- ¿Notificaciones cuando el skill abre un PR, necesita input humano, o se detecta una posible revocación de la sesión Pro? hermes-agent ya tiene gateway a Telegram/Discord — configurar para que avise también de estos casos, dado que aquí importa más que en un uso "normal" (§0.2).
- ¿Vale la pena una cuenta Pro separada solo para Hermes (§6), para aislar el riesgo de suspensión del uso profesional diario? Decisión personal, no bloqueante para empezar a probar.
