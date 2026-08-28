# Spec — Hermes

> **Proyecto de andar por casa.** Este spec asume un único operador, uso personal, no producción ni multiusuario.

## 0. Aclaración importante: qué es "Hermes" aquí

**Hermes = [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) desplegado en un servidor local (Mac Mini del Operador, no un VPS — decisión de coste, ver [architecture.md §Despliegue](../architecture.md#despliegue))**, no un orquestador que construimos desde cero. Es un proyecto open-source (MIT, ~230k★) de Nous Research que ya trae:

- Un **agent loop** con modelo intercambiable (Anthropic, OpenAI, OpenRouter, Nous Portal, endpoints propios).
- **Memoria persistente** propia (memoria curada, búsqueda FTS5 de sesiones, modelado de usuario) y un **sistema de skills** (memoria procedimental, compatible con el estándar abierto [agentskills.io](https://agentskills.io/)).
- Un **gateway multi-plataforma** (Telegram, Discord, Slack, WhatsApp, Signal, CLI) — un único proceso, se le puede hablar desde el móvil mientras trabaja en el servidor local.
- **Cron scheduler** integrado para automatizaciones ("daily reports, nightly backups, weekly audits... running unattended").
- **Delegación de subagentes** para paralelizar trabajo.
- **Siete backends de ejecución de comandos**: local, Docker, SSH, Singularity, Modal, Daytona, Vercel Sandbox — con aislamiento de contenedor ya contemplado en su modelo de seguridad ("Command approval, DM pairing, container isolation").
- **Integración MCP nativa**: "Connect any MCP server for extended capabilities" — este es el mecanismo de extensión que usamos para todo lo que hermes-agent no trae de fábrica.

Dado esto, **nuestro trabajo no es reimplementar nada de lo anterior**. Es construir las tres piezas que le faltan para este caso de uso concreto:

1. **`claude-code-runner-mcp`** — servidor MCP que sabe lanzar Claude Code en un contenedor Docker efímero por tarea (sección 3).
2. **`brain-mcp`** — servidor MCP adaptador sobre la API de nuestro Personal Brain (contrato detallado en [personal-brain/spec.md](../personal-brain/spec.md#52-api-vía-mcp-appsbrain-mcp-lo-que-realmente-consume-hermes)).
3. **El Skill `resolve-issue`** — el procedimiento, en el formato de skills de hermes-agent, que le dice al agente qué hacer y en qué orden (sección 5).

Todo lo demás (leer GitHub Issues, leer Notion, leer Jira) se resuelve registrando servidores MCP **de terceros ya existentes** para esas plataformas — no se escriben conectores propios.

### 0.1 Autenticación: dos caminos distintos, no uno

> **Reescrito el 2026-08-26 (US-13.7).** Hasta esa fecha esta sección afirmaba que _todo_ el sistema se autenticaba con una única sesión Pro compartida. **Eso es falso** desde el cambio de política de Anthropic verificado en la Fase 12 (US-12.3), y no era un matiz: describía mal **dónde va el dinero**. La versión anterior quedó un tiempo con una banda de "INVALIDADO" encima mientras el texto seguía diciendo lo contrario — se sustituye entera.

El sistema tiene **dos caminos de consumo separados**, con facturación distinta. Confundirlos es el error que costó la Fase 12 entera.

**Camino 1 — el runner (`claude-code-runner-mcp`): suscripción Pro. Sigue funcionando.**

Cada tarea lanza un contenedor efímero que ejecuta `claude -p`, el binario oficial de Claude Code, con `CLAUDE_CODE_OAUTH_TOKEN` inyectado como variable de entorno. Anthropic acepta ese uso contra la suscripción: es su propio cliente. Verificado tras el bloqueo con `checkSessionValid` → `{"valid": true}`.

**Camino 2 — el agent loop de hermes-agent: créditos de pago. No puede usar el plan.**

hermes-agent hace peticiones HTTP directas a `api.anthropic.com` y **nunca invoca el binario `claude`** — comprobado en su código: `hermes_cli/providers.py` no contiene ningún `subprocess`/`Popen`/`spawn`, y el alias `"claude-code": "anthropic"` (línea 265) es un alias puro, no un camino distinto. Para Anthropic eso es una _third-party app_, y desde el cambio de política la rechaza con `HTTP 400 invalid_request_error`: _"Third-party apps now draw from your extra usage, not your plan limits"_.

**No es un 429 de cuota agotada. Es un 400, un rechazo de política.** La distinción es diagnóstica y conviene tenerla a mano: un `429 rate_limit_error` significa que la petición **se aceptó** y se contabilizó contra una cuota; un `400` significa que ni siquiera se admite. Fue exactamente así como se confirmó, el 2026-08-26, que reactivar los créditos había desbloqueado el sistema: la misma llamada pasó de `400` a `429`.

Todo lo conversacional depende del camino 2 — `run-task`, `resolve-issue`, `resolve-jira-task`, `status-report`, `ask-brain`, `run-design-task`— porque todos pasan por el agent loop. El bot de control (`apps/control-bot`) es la única superficie que sobrevive a un corte de ambos caminos, precisamente por no usar modelo alguno.

**Consecuencia operativa, que es lo que de verdad importa**: mientras el agent loop consuma créditos, **cada turno cuesta dinero real**, incluida cada pasada de un cronjob que no encuentra nada que hacer. El control de gasto deja de ser higiene y pasa a ser el freno principal — ver US-13.6 del roadmap (tope mensual explícito) y la nota de coste del cron en [decisions-log.md](../decisions-log.md#milestone-v2--qué-es-la-segunda-versión).

El secreto sigue siendo uno solo (`hermes-claude-auth`, el valor del token OAuth), compartido por ambos caminos vía sus respectivos `.env`. Lo que cambió no es cómo se guarda la credencial, sino **contra qué se factura cada uso**.

### 0.2 Nota de riesgo — actualizada, ya no es teórica

> **Reescrito el 2026-08-26 (US-13.7).** La versión anterior decía "no hay bloqueo técnico: el token OAuth es válido para cualquier llamada". Eso ha dejado de ser cierto para el agent loop.

Usar un token OAuth de una cuenta de consumidor fuera de Claude Code y Claude.ai **viola los Términos de Servicio de consumidor de Anthropic**, y desde el cambio de política **Anthropic lo hace cumplir técnicamente**, no solo contractualmente:

- **Para el agent loop (camino 2), hay bloqueo técnico y ya se materializó.** No es un riesgo pendiente: ocurrió, tumbó todo lo conversacional del sistema, y motivó las Fases 12 y 13. La forma de operar dentro de las reglas es que ese camino consuma de créditos de pago o de otro proveedor — que es la configuración actual.
- **Para el runner (camino 1), el riesgo contractual sigue vigente y sin resolver.** Anthropic acepta hoy `claude -p` con ese token contra la suscripción, pero el uso que hace este proyecto —invocarlo desatendido desde un agente— no es el uso interactivo que los ToS contemplan. Sigue asumido **de forma consciente** por el Operador como experimento personal de bajo volumen, con la misma consecuencia posible que antes: suspensión de la cuenta Pro entera, no solo del uso automatizado.
- **Lo que cambió, en una frase**: el riesgo dejó de ser uniforme. Un camino ya fue cortado y está regularizado; el otro sigue siendo una apuesta.
- Mitigación sin cambios: el token es el único punto de fallo. Si Anthropic revoca la sesión, se reautentica a mano (§3.3). La reautenticación **no se automatiza**, deliberadamente, para no agravar la situación con extracción de tokens adicional.

### 0.3 Corrección de diseño — `hermes-claude-auth` es un token, no un volumen de archivos

**Verificado en la práctica al ejecutar US-0.4 (Fase 0)**: el diseño original de este documento asumía que `claude setup-token` genera un archivo de sesión persistente (tipo `~/.claude/.credentials.json`) que se podía montar como volumen Docker read-only y compartir entre contenedores. Esto **no es así**:

- `claude setup-token` (`Usage: claude setup-token [options]` — _"Set up a long-lived authentication token"_) **imprime el token por stdout** y no persiste ningún archivo de sesión reutilizable en `~/.claude/`. Confirmado montando un volumen Docker en el `$HOME` de un contenedor efímero, ejecutando `claude setup-token` con login interactivo completo, y verificando después que no existe `~/.claude/.credentials.json` ni ningún token real en `~/.claude.json` (solo metadata de arranque) — el volumen quedaba vacío de credenciales tras el login.
- El mecanismo real y documentado por Anthropic para este caso (headless/CI) es: capturar el token impreso y exportarlo como variable de entorno `CLAUDE_CODE_OAUTH_TOKEN` — que tanto `claude -p` (el CLI) como hermes-agent (`hermes_cli/auth.py: api_key_env_vars=(...,"CLAUDE_CODE_OAUTH_TOKEN")`) soportan nativamente.

**Diseño corregido**: `hermes-claude-auth` es el **valor del token** (`sk-ant-oat01-...`), generado una vez con `claude setup-token`, guardado como secreto (`.env` fuera de git en el servidor local, único entorno de este proyecto — nunca en el repo ni horneado en una imagen), e inyectado como `CLAUDE_CODE_OAUTH_TOKEN` tanto en el proceso de hermes-agent como en cada contenedor efímero de `claude-code-runner-mcp`. Todas las referencias de este documento a "volumen `hermes-claude-auth` montado read-only en `/root/.claude`" deben leerse como "variable de entorno `CLAUDE_CODE_OAUTH_TOKEN` inyectada desde el secreto `hermes-claude-auth`" — el resto del razonamiento (sesión única compartida, sin API key, riesgo de ToS de §0.2, reautenticación manual) no cambia.

Verificado extremo a extremo (US-0.4): `docker run --env-file .env ... claude -p "..."` responde correctamente usando únicamente `CLAUDE_CODE_OAUTH_TOKEN`, sin exponer el valor del token en ningún log.

**Esta sección sigue siendo válida tal cual** tras la reescritura de §0.1/§0.2 (US-13.7): el hallazgo es sobre **cómo se almacena** la credencial (un token en una variable de entorno, no un volumen de archivos), y eso no lo tocó el cambio de política de Anthropic. Lo único que hay que releer con la cabeza puesta en §0.1 es la frase "sesión única compartida": la credencial sí es única, pero **lo que se factura con ella ya no**.

## 1. Objetivos

- Reducir el tiempo entre "escribo una issue en uno de mis repos (o le mando una tarea por Telegram)" y "tengo un PR que la resuelve o la intenta resolver".
- Convertir Hermes en mi sistema de IA personal hablable desde el móvil (Telegram, §9), no solo un bot que reacciona a etiquetas de GitHub.
- Demostrar cómo extender un agente de terceros ya maduro con MCP servers y skills propios, en vez de construir un orquestador desde cero.
- Demostrar un patrón de aislamiento seguro para delegar ejecución de código a un coding agent (Claude Code) sin darle acceso irrestricto al servidor local.
- Servir de consumidor de referencia del Brain — validar que la memoria organizacional aporta valor real a un agente que actúa.
- Experimentar, para uso personal, con un único mecanismo de auth por suscripción Pro para todo el sistema (ver §0.1), evitando gestionar credenciales de API distintas para cada componente.

## 2. No-objetivos (v1)

- No modificamos el código fuente de hermes-agent — se despliega tal cual (imagen upstream) y se configura únicamente; su proveedor `anthropic`/`claude-code` ya soporta `CLAUDE_CODE_OAUTH_TOKEN` de fábrica (ver §0.1/§0.3), no hace falta ningún wrapper.
- No sustituye a un humano revisando el PR antes de mergear — el flujo abre PRs, no los mergea automáticamente.
- No gestiona proyectos completos ni planifica sprints — solo ejecuta tareas ya definidas y etiquetadas explícitamente para él.
- No soporta múltiples usuarios/tenants — un único operador (yo) configura sus propias credenciales y su propia instancia de hermes-agent.
- No implementa heurísticas de qué issues merece la pena coger — la selección es explícita (label/estado en la fuente), no inferida.
- No se automatiza la reautenticación de la sesión de Claude Code cuando expira o es revocada — es un paso manual del operador (ver 3.3).
- No se despliega este sistema para terceros ni se ofrece como servicio — uso estrictamente personal, dado el riesgo de ToS descrito en §0.2.

## 3. `claude-code-runner-mcp`

El componente más parecido a "construir un ejecutor desde cero" de todo el proyecto — es la pieza que de verdad escribimos nosotros en TypeScript.

### 3.1 Contrato MCP

Expone dos tools. `run_coding_task` es la principal (la única hasta la Fase 5);
`get_runner_status` se añadió en la Fase 6 ([decisions-log.md — Fase 6](../decisions-log.md#fase-6--cierre-operativo-y-superficie-conversacional),
US-6.3/US-6.4) como excepción acotada al principio de "una sola tool" del
diseño original — es de solo lectura, sin parámetros, y no amplía la
superficie de ataque de la forma en que lo haría una tool genérica de
ejecución (ver el docstring de `createMcpServer` en `src/mcpServer.ts` para
el razonamiento completo):

```ts
// tool: get_runner_status
//
// Sin input. Resumen de solo lectura para los skills status-report (a
// demanda) y el cronjob de resumen periódico. Reusa checkSessionValid
// (§3.3) — lanza el mismo contenedor efímero de comprobación de sesión que
// usa run_coding_task — y una query nueva sobre runner.task_runs (§7).
interface GetRunnerStatusOutput {
  session:
    { valid: true } | { valid: false; reason: 'expired' | 'revoked' | 'unknown'; detail: string };
  persistenceAvailable: boolean; // false si DATABASE_URL no está configurada
  tasksNeedingAttention: Array<{
    id: string;
    repo: string;
    taskTitle: string;
    status: 'needs_human_input' | 'failed';
    startedAt: string;
    finishedAt?: string;
  }>; // needs_human_input/failed de los últimos 7 días
  tasksStartedLast5h: number | null; // aproximación, NO telemetría real de Anthropic
  tasksStartedLast7d: number | null;
}
```

`run_coding_task`:

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

Los requisitos completos y numerados viven en **[docs/security.md](../security.md)**, que es la fuente única de verdad. Resumen de lo que aplica a este componente:

- Un contenedor efímero por tarea, destruido al terminar o al hacer timeout — nunca quedan contenedores huérfanos (SEC-5.4).
- El contenedor **no tiene acceso al Docker socket** (SEC-5.1) y su red está restringida a una allowlist (`api.anthropic.com`, `github.com`), sin acceso libre a Internet (SEC-5.2).
- Credenciales de GitHub con scope mínimo (SEC-6.1), nunca un token global de cuenta. El token de Claude Code, compartido vía el secreto `hermes-claude-auth`, se inyecta únicamente como variable de entorno, nunca se escribe a disco (SEC-6.2).
- Sin acceso al filesystem del host más allá del workspace efímero de esa tarea (SEC-5.6).
- `claude-code-runner-mcp` es el **único** componente del sistema con acceso al socket de Docker del host (SEC-4.1) — ni hermes-agent, ni brain-mcp lo tienen.

Esta es la parte de seguridad más sensible del proyecto: un agente que ejecuta código arbitrario delegado por otro agente es, por definición, una superficie de ataque. Especial cuidado con **prompt injection** desde el cuerpo de issues de terceros (ver sección 6 y [security.md §0](../security.md#0-why-this-document-exists)).

### 3.5 Transporte MCP: HTTP en red interna, no stdio

**Decisión de arquitectura (Fase 2).** El runner se expone por **Streamable HTTP** (`StreamableHTTPServerTransport` del SDK oficial), no por stdio, y corre en **su propio contenedor** — el único con el socket de Docker montado.

El motivo es directo: un servidor MCP stdio corre como _subproceso del cliente_. Si registrásemos el runner por stdio, viviría dentro del contenedor de hermes-agent, y ese contenedor necesitaría el socket de Docker — justo el componente que ingiere texto no confiable. Eso rompe SEC-2.1, que es el requisito del que cuelga toda la arquitectura. Ver la comparativa de alternativas descartadas en [security.md §1](../security.md#1-the-central-concept-the-docker-socket-is-the-master-key).

Consecuencias:

- Registro en hermes-agent con `hermes mcp add claude-code-runner --url http://claude-code-runner:8080/mcp --auth header` (no `--command`).
- El puerto **no se publica** al host ni a la LAN — vive solo en la red interna de Compose (SEC-3.1).
- Cada petición exige `Authorization: Bearer <secreto>` (SEC-3.2). Sin cabecera válida → `401`, sin ejecutar nada.
- La superficie sigue siendo exactamente una tool, `run_coding_task` (SEC-3.3).

### 3.6 Nota de implementación: rutas de workspace en despliegue contenerizado

Detalle no obvio que **bloquea** el despliegue de §3.5 si se ignora, detectado al diseñar la Fase 2.

Cuando el runner corría en el host (Fase 1), clonaba el repo en un directorio temporal propio (`mkdtemp` bajo `/tmp`) y lo pasaba como bind mount al contenedor efímero. Eso funciona porque la ruta existe en el host, que es quien resuelve los bind mounts.

Al meter el runner en un contenedor, esto **se rompe en silencio**: el runner pediría al demonio de Docker montar `/tmp/claude-code-runner-XXX`, pero el demonio resuelve esa ruta **en el host**, donde no existe (o, peor, existe y es otra cosa). El contenedor efímero recibiría un `/workspace` vacío y la tarea fallaría de forma confusa, sin error claro.

**Solución adoptada**: una raíz de workspaces dedicada, montada en el contenedor del runner **en la misma ruta** que tiene en el host (p. ej. `/var/lib/personalai/workspaces` → `/var/lib/personalai/workspaces`). Así toda ruta que el runner calcula es válida también para el demonio. Requiere hacer configurable la raíz de los checkouts (variable `CLAUDE_CODE_RUNNER_WORKSPACE_ROOT`) en vez de usar `os.tmpdir()` a pelo. Esa raíz contiene solo workspaces del proyecto (SEC-4.4).

**Verificado empíricamente (Fase 2, US-2.1)**, ejecutando el mismo escenario en las dos configuraciones desde dentro del contenedor del runner: sin la raíz compartida, el contenedor hermano recibe un `/workspace` **vacío** (confirmando que el fallo es real y silencioso); con la raíz montada en la misma ruta, ve correctamente el contenido del checkout.

**Nota operativa**: como el contenedor del runner corre como root (ver el razonamiento en su `Dockerfile`), los directorios de workspace aparecen en el host propiedad de root. No es un problema de funcionamiento — quien los crea y los borra es el propio runner, que es root dentro de su contenedor — pero conviene saberlo al inspeccionar o limpiar esa raíz a mano desde el host.

### 3.7 `run_claude_command` (Fase 8 del [roadmap](../decisions-log.md#fase-8--comandos-de-claude-code-vía-chat-run_claude_command))

**Implementada, con el contrato rediseñado tras verificar empíricamente US-8.1** — ver el hallazgo real más abajo. El diseño original de esta sección (previo a la implementación) proponía devolver un `artifactUrl` ya publicado; se descarta por evidencia real, no por hipótesis.

**Motivación**: `run_coding_task` asume que el resultado de una tarea es código — una rama con commits. Pero Claude Code trae comandos slash que no producen un diff, sino una página HTML autocontenida (`/design` para canvases de diseño, `/dataviz` para visualizaciones). Hermes no tenía forma de pedir "diséñame una landing para X" y recibir ese tipo de entregable — solo sabía pedir código.

**Hallazgo real (US-8.1)**: verificado empíricamente, dos veces — primero con `ANTHROPIC_API_KEY`, después repitiendo el test con el token OAuth real de `hermes-claude-auth` (el mismo mecanismo exacto que usa este runner en producción) — que `claude -p` en modo headless **no tiene la tool `Artifact` disponible en el toolset de la sesión**, ni siquiera aparece como tool diferida (`ToolSearch` devuelve "No matching deferred tools found"). Esto ocurre pese a que la [documentación oficial de Artifacts](https://code.claude.com/docs/en/artifacts) lista el plan Pro como compatible y no excluye explícitamente el modo `-p`/headless de su tabla de disponibilidad (solo excluye "Agent SDK, GitHub Action, y contextos de servidor MCP"), y pese a cumplir el resto de requisitos documentados (CLI v2.1.245 ≥ v2.1.183 requerido, sin `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`/`CLAUDE_CODE_DISABLE_ARTIFACT`). Con Claude Code real intentando publicar, el error observado fue el esperable por diseño (`ToolSearch` sin resultado), no un error de red o de plan — así que tampoco es (solo) la allowlist del proxy (`api.anthropic.com`/`github.com`, sin `platform.claude.com`/`claude.ai` que la [documentación de red](https://code.claude.com/docs/en/network-config) señala como necesarios para auth/publish) lo que lo bloquea, aunque también haría falta ampliarla si esto cambiara. Conclusión: no confirmable sin acceso al despliegue real (Mac Mini) para descartar algo específico de ese host, pero con la misma imagen/CLI/token no hay motivo para esperar un resultado distinto.

**Contrato MCP implementado** (`apps/claude-code-runner-mcp/src/types.ts`), tool nueva y separada de `run_coding_task`:

```ts
// tool: run_claude_command
//
// Misma auth, mismo aislamiento de contenedor y mismo rate limiting que
// run_coding_task (§3.2–§3.4) — comparte infraestructura, no es un
// componente nuevo, solo una segunda forma de invocar el mismo runner.
const ALLOWED_SLASH_COMMANDS = ['/design', '/dataviz'] as const;

interface RunClaudeCommandInput {
  slashCommand: (typeof ALLOWED_SLASH_COMMANDS)[number]; // validado contra el allowlist fijo, NO cualquier comando arbitrario
  prompt: string; // texto libre tras el comando (p.ej. "landing page para mi proyecto X")
  repo?: string; // opcional: solo si el comando necesita contexto de un repo concreto (clonado read-only, sin push)
  brainContext?: string; // igual que en run_coding_task
  timeoutSeconds?: number; // por defecto 900 (15 min)
}

interface RunClaudeCommandOutput {
  status: 'success' | 'failed' | 'needs_human_input' | 'timed_out';
  htmlContent?: string; // el HTML autocontenido generado de verdad — NUNCA un link ya publicado
  summary: string;
  logsUrl?: string;
}
```

Puntos de diseño:

- **Allowlist de comandos, no comandos libres.** Mismo principio que "la superficie MCP sigue siendo exactamente una tool" (SEC-3.3) — aquí se traduce en "la superficie de comandos ejecutables es exactamente esta lista" (`ALLOWED_SLASH_COMMANDS`), validada tanto en el schema Zod de la tool (`mcpServer.ts`) como en `runClaudeCommand()` (`isAllowedSlashCommand`, defensa en profundidad si algo la llama directamente).
- **Sin commit, sin PR, sin publicación.** El entregable es `htmlContent`. El entrypoint del contenedor (`docker/runner/entrypoint.sh`, modo detectado por la presencia de `command-prompt.md` en vez de `prompt.md`) le pide a Claude Code que escriba el resultado en `/workspace/artifact-output.html` en vez de intentar publicarlo — el runner lo lee de ahí tras `docker wait`, igual que ya lee `result.json` para `run_coding_task`.
- El aislamiento de contenedor (SEC-5.\*), la sesión compartida (§0.1) y el rate limiting (SEC-4.3) aplican igual que a `run_coding_task` — comparten el mismo runner y la misma cuota de la ventana de 5h/semanal.

**Entrega del resultado**: reutiliza el mecanismo de confirmación inmediata + cronjob de un disparo de §9.3. **Corrección real, verificada en producción** (primera petición real de Telegram): pegar `htmlContent` como texto plano es técnicamente correcto pero inútil en la práctica — el Operador no puede abrir una landing desde un bloque de código en el móvil. Fix: `run_claude_command` también escribe una copia persistente del HTML en `CLAUDE_CODE_RUNNER_ARTIFACTS_DIR` (si está configurada — volumen compartido en la misma ruta entre `claude-code-runner` y `hermes`, mismo patrón que `WORKSPACE_ROOT` de §3.6) y devuelve `htmlFilePath`; el Skill responde entonces con el tag `MEDIA:<htmlFilePath>` que el gateway de hermes-agent reconoce y entrega como adjunto `.html` real y abrible. Sin la variable configurada, cae al fallback de pegar `htmlContent` como texto, avisando explícitamente de que hay que guardarlo a mano. Publicarlo de verdad como Artifact en claude.ai (copiarlo a una sesión propia de Claude Code/claude.ai) sigue siendo una acción manual del Operador en cualquiera de los dos casos.

**Skill dedicado: `run-design-task`** (`hermes/skills/run-design-task/`), no una extensión de `run-task`/`resolve-issue` — mezclar "tarea de código" y "tarea de Artifact" en el mismo skill obligaría a esa lógica de discriminación a vivir dentro de un skill ya complejo. Disparado por chat (Telegram), siguiendo el mismo patrón de `run-task` (§9.3: confirmación inmediata + `cronjob(repeat: 1)`). La variante disparada por issue/ticket queda sin construir — no hay caso de uso real todavía, se añadirá si aparece uno.

## 4. Servidores MCP de terceros (GitHub, Notion, Jira, Azure DevOps)

Se usan servidores MCP ya existentes y mantenidos, no conectores propios:

- **GitHub**: [github/github-mcp-server](https://github.com/github/github-mcp-server) (oficial). Se autentica con un GitHub App o PAT fine-grained, scoped solo a los repos donde quiero que Hermes actúe (`issues:write`, `contents:write`, `pull_requests:write` — nada más).
- **Notion**: servidor MCP oficial de Notion. Apunta a una base de datos concreta ("Hermes Tasks") filtrando por una propiedad `status`.
- **Jira**: servidor MCP de Atlassian/comunidad, configurado con un JQL fijo (por defecto `labels = hermes AND status = "To Do"`). Fuente **personal** del Operador (post-v1, [decisions-log.md — Fase 7](../decisions-log.md#fase-7--ampliar-fuentes-y-canales)).
- **Azure DevOps**: servidor MCP oficial o de comunidad (evaluar [microsoft/azure-devops-mcp](https://github.com/microsoft/azure-devops-mcp) al implementar), con un filtro de work items equivalente al JQL de Jira. Fuente **de la empresa** del Operador — **nunca** registrado en la misma instancia de hermes-agent que las fuentes personales. Ver §4.1.

Registro en hermes-agent (`hermes/config/hermes.config.yaml` + `hermes mcp add <server>`), cada uno con sus propias credenciales de mínimo privilegio. Estas credenciales (GitHub/Notion/Jira/Azure DevOps) sí son API keys/tokens convencionales — solo la parte de modelo Anthropic usa la sesión Pro compartida (§0.1), y solo en la instancia personal (§4.1).

### 4.1 Despliegue dual: instancia personal vs. instancia de trabajo (post-v1)

**Decisión de arquitectura** (detalle completo y motivación en [decisions-log.md — Fase 10](../decisions-log.md#fase-10--despliegue-dual-instancia-personal-vs-instancia-de-trabajo--futurible)): en cuanto Azure DevOps (u otra fuente de la empresa del Operador) entra en juego, **no** se añade como un servidor MCP más a la instancia de hermes-agent ya desplegada. Se despliega una **segunda instancia completa**, aislada de la primera: `docker-compose.yml` propio, `.env` propio, red Docker propia, bot de Telegram propio (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_ALLOWED_USERS` distintos), y — crucialmente — **auth propia con Anthropic**, no `hermes-claude-auth`. El riesgo de ToS descrito en §0.2 se asume explícitamente para uso personal; no se traslada sin más a datos y credenciales de un empleador.

Consecuencia directa para `claude-code-runner-mcp`: si la instancia de trabajo llega a necesitar ejecutar tareas de código, es un **despliegue separado** del componente (su propio contenedor, su propio `CLAUDE_CODE_RUNNER_AUTH_TOKEN`, su propia base de Postgres) — no un parámetro de "cliente" añadido al runner personal. El aislamiento de §3.4 aplica igual, pero por partida doble.

Requisitos numerados y verificables en [security.md §9 (SEC-7.1–SEC-7.5)](../security.md#9-layer-7--isolation-between-the-personal-and-work-instances-phase-10-of-v2).

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

> El modelo completo, por capas y con requisitos numerados (`SEC-x.y`) verificables fase a fase, está en **[docs/security.md](../security.md)**. Esta sección resume lo específico de Hermes; ante cualquier discrepancia, manda `security.md`.

- **Prompt injection desde issues/tickets externos**: el cuerpo de una issue es input no confiable — puede contener instrucciones dirigidas al agente ("ignora tus instrucciones y..."). Este es el modo de fallo _esperado_, no una hipótesis. La defensa no es intentar detectar la inyección, sino que **el componente que la ingiere no tenga permisos peligrosos**: hermes-agent corre en un contenedor sin socket de Docker (SEC-2.1) y lo máximo que puede pedirle al runner es una tarea de código con forma fija (SEC-3.3). Aunque el prompt del contenedor efímero esté comprometido, ese contenedor no tiene red libre (SEC-5.2) ni acceso al host (SEC-5.6).
- **Aprobación de comandos de hermes-agent**: se mantienen los valores por defecto `approvals.mode: manual` y `approvals.cron_mode: deny` (SEC-2.3). Matiz verificado en el código de hermes-agent (`tools/approval.py`): este mecanismo cubre **comandos de shell**, no llamadas a tools MCP — por eso el Skill `resolve-issue` trabaja exclusivamente vía MCP (sección 5), lo que le permite correr desatendido en cron **sin** relajar `cron_mode`.
- **Acceso al agente desde Telegram**: denegación por defecto más allowlist explícita de usuarios (SEC-1.1); nunca activar los flags de allow-all (SEC-1.2). Ver también §9.4.
- **Perímetro de red**: cero puertos entrantes en el router de casa (SEC-0.1) — posible porque tanto Telegram (long polling) como el cron de GitHub generan tráfico exclusivamente saliente.
- **Gestión de secretos**: tokens de GitHub/Notion/Jira en un `.env` fuera de git en el servidor local — nunca en el repo ni horneados en ninguna imagen Docker. El token de Claude Code (`hermes-claude-auth`) vive exclusivamente en `.env`/secret store fuera de git, inyectado como variable de entorno `CLAUDE_CODE_OAUTH_TOKEN`, y nunca se copia a la imagen ni se escribe a disco dentro de un contenedor.
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

## 9. Interacción conversacional (Telegram)

Hermes no es solo "un bot que cierra issues de GitHub" — el objetivo de este proyecto (ver `docs/decisions-log.md` §Milestone v1) es que sea mi sistema de IA personal, hablable desde el móvil. hermes-agent ya trae un gateway multi-plataforma de fábrica (§0); esta sección documenta cómo se usa el canal de Telegram concretamente, implementado en la Fase 3 del roadmap.

### 9.1 Configuración del gateway

`hermes gateway setup` registra el bot de Telegram (bot token de @BotFather) y activa **DM pairing**: el gateway solo responde a un `chat_id` explícitamente emparejado por el Operador. Cualquier mensaje de un `chat_id` no emparejado se ignora o se responde con un rechazo explícito — nunca se ejecuta una tarea a partir de un remitente no verificado. Esto reutiliza el mismo modelo de seguridad que hermes-agent ya documenta ("Command approval, DM pairing, container isolation", §0), no es un mecanismo nuevo.

### 9.2 De mensaje a tarea

Un mensaje conversacional del tipo "resuelve la issue #42 de mi-repo" o "arregla X en el repo Y" se traduce en los mismos parámetros (`repo`, `taskTitle`, `taskDescription`) que consume `run_coding_task` — es la misma tool que usa el Skill `resolve-issue` (sección 5), solo que el disparador es un mensaje de chat en vez del cron de GitHub. El skill que implementa esto es `run-task` (`hermes/skills/run-task/SKILL.md`), disponible en cualquier turno interactivo (no solo en cron) vía el mecanismo estándar de progressive disclosure de hermes-agent (`skills_list()`/`skill_view()`). Si el mensaje no deja claro el repo o el alcance de la tarea, Hermes pregunta antes de ejecutar — nunca asume un repo por defecto ni interpreta de más una petición ambigua.

### 9.3 Confirmación inmediata y notificación de finalización

`run_coding_task` puede tardar hasta el timeout configurado (por defecto 30 minutos, §3.1) — no es razonable dejar la conversación de Telegram bloqueada esperando la respuesta de la tool en el mismo turno.

**Mecanismo elegido: un cronjob de un solo disparo (`cronjob(action='create', repeat=1)`), sin `deliver` explícito.** Implementado en el skill `run-task` (`hermes/skills/run-task/SKILL.md`).

El diseño original de esta sección planteaba dos opciones a decidir empíricamente durante la Fase 3: delegación de subagentes (`delegate_task`) como preferida, y polling de `runner.task_runs` vía cron como fallback. **Ninguna de las dos se usó**, tras leer el código fuente de hermes-agent (`tools/delegate_tool.py`, `tools/cronjob_tools.py`) dentro del propio contenedor desplegado:

- **`delegate_task` queda descartado, no es una alternativa viable.** Su propia descripción de tool lo dice explícitamente: se ejecuta _síncronamente_ dentro del turno padre, y si el turno padre se interrumpe (el Operador manda otro mensaje, `/stop`, `/new`) el hijo se cancela y su trabajo se descarta — "children cannot continue in the background". Eso es justo lo contrario de lo que piden US-3.3/US-3.4: una tarea de hasta 30 minutos donde es más que probable que el Operador escriba algo más mientras tanto. La propia documentación de la tool recomienda, para "trabajo duradero que debe sobrevivir al turno actual", usar `cronjob(action='create')` — que es lo que se implementó.
- El polling de `runner.task_runs` no hizo falta: el mecanismo de entrega de cronjobs de hermes-agent ya resuelve esto de forma nativa. Si se omite el parámetro `deliver` al crear el job, `tools/cronjob_tools.py::_origin_from_env()` captura `platform`/`chat_id`/`thread_id` de la sesión activa (vía `gateway.session_context.get_session_env`) y los usa como destino por defecto — es el mismo mecanismo (`cron.wrap_response: true`) que ya usa cualquier cronjob de hermes-agent, no un canal construido a medida para este proyecto.

Flujo resultante, en dos turnos separados:

1. **Turno interactivo (Telegram → Hermes)**: reconoce la petición, aclara si hace falta (§9.2), y en cuanto tiene `repo`/`taskTitle`/`taskDescription` claros, llama a `cronjob(action='create', prompt=<autocontenido>, schedule=<pocos segundos en el futuro>, repeat=1)` sin fijar `deliver`. Responde de inmediato — "Vale, me pongo con ello — te aviso en este mismo chat cuando termine" — sin esperar a que el cronjob se dispare. Este turno termina aquí; el chat queda libre.
2. **Turno del cronjob (independiente, minutos después)**: el prompt autocontenido (el sub-turno no tiene memoria de la conversación original) instruye llamar a `run_coding_task` y, si `status === 'success'`, abrir PR con `create_pull_request` del MCP de GitHub. Su respuesta final se entrega automáticamente al chat/hilo de origen — sin ninguna llamada explícita a `send_message` ni lógica de entrega propia.

Verificación pendiente (Fase 3, US-3.3/US-3.4): al menos una ejecución real de principio a fin, incluyendo una tarea de varios minutos, confirmando que la confirmación llega en segundos y el aviso de finalización llega al mismo hilo sin intervención manual.

### 9.4 Seguridad

El canal de entrada (GitHub vs. Telegram) nunca cambia las garantías de seguridad de la ejecución: una tarea iniciada por Telegram pasa por el mismo `run_coding_task`, con el mismo aislamiento de contenedor (§3.4) y el mismo rate limiting (SEC-4.3), que una originada en una issue de GitHub (SEC-1.4).

Dos puntos específicos de este canal, ambos innegociables:

- **Control de acceso (SEC-1.1/SEC-1.2)**: un bot de Telegram es descubrible — su nombre de usuario es público y cualquiera puede escribirle. hermes-agent ya deniega por defecto (verificado en `gateway/run.py::_is_user_authorized`, cuya resolución termina en "Default: deny"); encima se pone una allowlist explícita (`TELEGRAM_ALLOWED_USERS`) y/o DM pairing aprobado a mano. Los flags de allow-all (`GATEWAY_ALLOW_ALL_USERS`, `TELEGRAM_ALLOW_ALL_USERS`) no se activan nunca. Se verifica con una segunda cuenta de Telegram, no se asume.
- **Sin exposición de red (SEC-0.1)**: hablar con Hermes desde fuera de casa **no requiere abrir ningún puerto** del router. El gateway usa long polling contra `api.telegram.org` (`getUpdates`, verificado en `gateway/platforms/telegram.py`), no webhooks: tanto el Operador como Hermes hablan con los servidores de Telegram, nunca directamente entre sí. Cualquier propuesta de "exponerlo con un túnel para que funcione" indica un malentendido, no una necesidad real.

### 9.5 `status-report` y `ask-brain` (Fase 6)

Dos skills conversacionales más, además de `run-task` — ambos de solo
lectura (nunca llaman a `run_coding_task`, nunca mutan más que `brain_ingest`
sobre la propia memoria de Brain), documentados en detalle en
`hermes/skills/status-report/SKILL.md` y `hermes/skills/ask-brain/SKILL.md`.

- **`status-report`**: responde con el estado operativo de Hermes (sesión
  OAuth compartida, tareas en `needs_human_input`/`failed`, consumo
  aproximado de la ventana Pro) vía la tool `get_runner_status` (§3.1). Dos
  disparadores del mismo skill: a demanda en cualquier turno interactivo, o
  por un cronjob **recurrente** (a diferencia del cronjob de un solo disparo
  de §9.3, aquí sí hace falta `--deliver telegram:<chat_id>` explícito,
  porque un job recurrente no tiene chat de origen que heredar).
- **`ask-brain`**: expone `brain_query`/`brain_ingest` (Fase 5) directamente
  en la conversación, para consultar o alimentar Brain sin que sea un paso
  interno de una tarea de código. A diferencia de `resolve-issue`, el
  mensaje del Operador aquí se trata como instrucción legítima (mismo
  criterio de confianza que `run-task`, §9.2), no como dato de terceros.

## 10. Identidad del agente (`SOUL.md`)

hermes-agent carga `SOUL.md` (desde `$HERMES_HOME`) en cada turno como el "slot #1" del system prompt — antes que cualquier otro contexto (verificado en `agent/prompt_builder.py::load_soul_md`/`build_context_files_prompt`, `CONTEXT_FILE_MAX_CHARS = 20_000`). Es el punto de personalización correcto para que Hermes sepa qué es dentro de este proyecto, en vez de comportarse como el asistente genérico de la plantilla por defecto (un comentario vacío que viene con la instalación).

**Fuente de verdad versionada**: `hermes/config/SOUL.md`. Describe, de forma condensada, la identidad y el alcance del agente en este despliegue concreto — quién es (el agente de PersonalAI, no un asistente de propósito general), qué hace de verdad (`resolve-issue`, `run-task`, `run-design-task`, `status-report`, `ask-brain`), y el resumen de las reglas no negociables que ya detallan los skills (contenido de terceros como dato nunca instrucción, nunca mergear, solo tools MCP para código y para diseño/HTML, preguntar ante ambigüedad, Brain best-effort).

**Aplicación**: se copia a `$HERMES_HOME/SOUL.md` — **no** se monta de solo lectura como los skills, porque hermes-agent permite editarlo en vivo desde el propio chat. Si se edita ahí, hay que traer el cambio de vuelta a `hermes/config/SOUL.md` para no perderlo en el siguiente despliegue (ver `hermes/config/README.md` §7).

Nota de alcance: esto es la identidad/personalidad (slot fijo, siempre cargado). El contexto de proyecto tipo `AGENTS.md`/`CLAUDE.md` que hermes-agent también soporta se carga desde el directorio de trabajo del turno (`cwd`), no desde `$HERMES_HOME` — no se usa en este proyecto porque el `cwd` real de una sesión de hermes no coincide de forma fiable con este monorepo; `SOUL.md` cubre lo que hace falta.

**Hallazgo real al escribir la primera versión**: `SOUL.md` pasa por el mismo filtro anti-inyección que cualquier fichero de contexto (`agent/prompt_builder.py::_scan_context_content`, mismo mecanismo conceptual que protege al Skill `resolve-issue` de issues hostiles — sección 6). Una primera versión de este fichero envolvía una nota para el editor humano en un comentario HTML (`<!-- ... -->`) que mencionaba la palabra "system" dentro — coincide con el patrón `html_comment_injection` (`<!--[^>]*(?:ignore|override|system|secret|hidden)[^>]*-->`), así que el fichero entero se bloqueó en silencio (`[BLOCKED: SOUL.md contained potential prompt injection...]`) y Hermes respondió como el asistente genérico por defecto — verificado comparando el log (`agent.log`: `Context file SOUL.md blocked: html_comment_injection`) con la respuesta real del chat. Corregido quitando el comentario HTML (una nota en texto plano/blockquote no dispara el filtro). Lección operativa: cualquier nota para humanos dentro de `SOUL.md` va en texto plano, nunca en un comentario HTML.

## 11. Preguntas abiertas

- ~~¿El wrapper de hermes-agent...?~~ Resuelto en Fase 0 (§0.3): no hace falta wrapper, hermes-agent soporta `CLAUDE_CODE_OAUTH_TOKEN` nativamente.
- ¿Cómo se comparte la cuota de la ventana de 5h/semanal entre el chat de hermes-agent y las tareas de `claude-code-runner-mcp` sin que una acapare a la otra? Candidato simple para v1: límite duro de tareas de código concurrentes/por hora (ya recogido en §6), revisando manualmente si hace falta ajustar.
- ¿Se usa `hermes setup --portal` (Nous Portal, todo-en-uno) o BYO keys por integración? Ya no aplica al modelo Anthropic (ahora vía sesión Pro compartida), pero sigue siendo relevante para otros proveedores si en algún momento se quisiera usar un modelo distinto para partes no críticas.
- ¿Formato exacto del Skill `resolve-issue`? Pendiente de revisar la carpeta `skills/`/`optional-skills/` del repo de hermes-agent al implementar, para seguir su convención exacta (frontmatter, estructura de carpetas).
- ¿GitHub App real o PAT fine-grained por repo para v1? Recomendado: empezar con PAT fine-grained para ir más rápido.
- ¿Notificaciones cuando el skill abre un PR, necesita input humano, o se detecta una posible revocación de la sesión Pro? hermes-agent ya tiene gateway a Telegram/Discord — configurar para que avise también de estos casos, dado que aquí importa más que en un uso "normal" (§0.2).
- ¿Vale la pena una cuenta Pro separada solo para Hermes (§6), para aislar el riesgo de suspensión del uso profesional diario? Decisión personal, no bloqueante para empezar a probar.
