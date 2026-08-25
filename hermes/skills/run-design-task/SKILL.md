---
name: run-design-task
description: 'Reconoce peticiones conversacionales de un diseño/Artifact (p. ej. por Telegram), las delega en run_claude_command sin bloquear el chat, y entrega el HTML generado cuando termina.'
version: 1.0.0
author: PersonalAI
license: MIT
metadata:
  hermes:
    tags: [telegram, coding-agent, mcp, cron, conversational, artifacts]
    related_skills: [run-task, resolve-issue]
---

# run-design-task: pedir un diseño/Artifact por chat

## Overview

Procedimiento para cuando el Operador pide, en una conversación normal (por
ejemplo por Telegram), un resultado visual — "diséñame una landing para mi
proyecto X", "hazme un dashboard con estos datos" — en vez de una tarea de
código. Traduce esa petición en la tool `run_claude_command`
(`apps/claude-code-runner-mcp`, docs/hermes/spec.md §3.7 — Fase 8, US-8.2/
US-8.3), deliberadamente **separado** de `run-task`/`resolve-issue`: mezclar
"tarea de código" (rama con commits) y "tarea de Artifact" (página HTML)
en el mismo skill obligaría a esa lógica de discriminación a vivir dentro de
un skill ya complejo.

## Hallazgo real que define el contrato de este skill (Fase 8, US-8.1)

**No esperes ni prometas un link ya publicado a claude.ai.** Se verificó
empíricamente, dos veces (con `ANTHROPIC_API_KEY` y con el token OAuth real
de `hermes-claude-auth`), que `claude -p` en modo headless — el único modo en
el que corre Claude Code dentro del contenedor efímero — no tiene la tool
`Artifact` disponible, aunque la documentación oficial de Anthropic liste el
plan Pro como compatible con Artifacts. Por eso `run_claude_command` NUNCA
devuelve un `artifactUrl`: devuelve `htmlContent`, el HTML autocontenido que
Claude Code generó de verdad al ejecutar `/design`/`/dataviz` (no un
placeholder — el diseño es real, solo falta el paso de publicarlo).
Publicarlo de verdad (copiarlo a una sesión propia de Claude Code o
claude.ai) sigue siendo una acción manual del Operador.

**Corrección real, verificada en producción**: la primera versión de este
skill entregaba `htmlContent` pegado como texto en el chat de Telegram — el
Operador no podía abrir el resultado desde el móvil, solo leerlo. Fix: si
`run_claude_command` devuelve `htmlFilePath` (requiere
`CLAUDE_CODE_RUNNER_ARTIFACTS_DIR` configurada en el despliegue — ver
`hermes/docker/.env.example`), este skill responde con el tag
`MEDIA:<htmlFilePath>` que el gateway de hermes-agent reconoce y entrega
como **adjunto real** de Telegram (fichero `.html` descargable/abrible),
documentado en la [guía oficial de
Telegram](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram)
de hermes-agent. Sin `htmlFilePath` (despliegue sin la variable
configurada), cae al fallback anterior — pegar `htmlContent` como bloque de
código — pero avisando explícitamente de que hay que guardarlo como
`.html` a mano para poder abrirlo, en vez de dejar que el Operador lo
descubra por sí mismo.

## Reglas innegociables

1. **Solo `run_claude_command` para generar el resultado. Nunca escribas tú
   mismo el fichero HTML con tus propias tools de fichero/bash — bajo
   NINGÚN concepto, ni siquiera para algo trivial.** Regla dura, bug real
   encontrado en producción: verificado que, ante peticiones reales de
   Telegram ("Hazme un diseño de una landing básica para...", "Hazme una
   nueva landing para mi página web personal"), Hermes escribió el HTML
   directamente con sus propias tools nativas de escritura de fichero
   dentro de **su propio contenedor** — nunca cargó este skill, nunca llamó
   a `run_claude_command`. El resultado: un fichero real pero inaccesible
   (vive dentro del contenedor de hermes, sin ningún mecanismo de entrega),
   y el Operador solo recibe una descripción en texto de algo que no puede
   abrir. Esto rompe el aislamiento (SEC-2.1/SEC-4.x) exactamente igual que
   el bug ya documentado en `run-task/SKILL.md` para tareas de código — es
   el mismo patrón, aplicado a diseño. Si dudas sobre si algo "cuenta" como
   una petición de diseño, trátalo como que sí cuenta (ver Paso 1) y pasa
   por `run_claude_command`, nunca lo resuelvas tú directamente. Tampoco
   uses la tool `Artifact` directamente (no la tienes disponible en este
   contexto — hermes-agent no es Claude Code).

2. **`slashCommand` tiene que ser uno de la allowlist** (`/design`,
   `/dataviz` — ver `ALLOWED_SLASH_COMMANDS` en
   `apps/claude-code-runner-mcp/src/types.ts`). Si el Operador pide algo que
   no encaja en ninguno de los dos (p. ej. "genera un PDF"), dile
   explícitamente qué comandos soportas en vez de intentar forzar uno.

3. **Si es ambiguo si la petición es de código o de diseño, pregunta antes
   de elegir la tool.** "Añade un botón a mi web" puede ser cualquiera de
   las dos — no asumas. Señales de que es diseño: pide algo visual,
   standalone, sin mencionar un repo/fichero concreto a modificar. Señales
   de que es código: menciona un repo, un fichero, o pide "arreglar"/
   "añadir" algo a un proyecto existente — en ese caso, ese es el trabajo de
   `run-task`, no de este skill.

4. **Nunca mergeas ni pusheas nada**, y el trabajo pesado nunca corre en el
   turno interactivo — mismo motivo que `run-task` (ver esa sección de su
   propio `SKILL.md`: `run_claude_command` puede tardar varios minutos, y el
   turno interactivo tiene que devolver una confirmación en segundos).

5. **Dentro del propio cronjob, llama a `run_claude_command` directamente —
   nunca delegues esa llamada a un subagente (`delegate_task` o
   equivalente).** Regla dura, verificada en producción: la primera
   ejecución real de este skill delegó la llamada a un subagente que **no
   tenía las tools de `claude-code-runner-mcp` disponibles**, y en vez de
   fallar con un error, se inventó por completo el resultado — un
   `"Artifact generado correctamente"` con HTML y ruta de fichero
   totalmente fabricados, con `tool_trace: []` (cero tools reales
   ejecutadas) en la sesión exportada. No es teórico: el fichero que decía
   haber creado no existía en ningún sitio, y no había ninguna fila nueva
   en `runner.task_runs`. Nunca confíes en un resultado de
   `run_claude_command` que no puedas correlacionar con una llamada real —
   si tienes dudas, verifica que el propio turno del cronjob invocó la tool
   MCP, no un subagente suyo.

## Prerequisites

- Servidor MCP `claude-code-runner` registrado y conectado.
- Servidor MCP `brain-mcp` registrado (opcional — su ausencia o caída nunca
  bloquea la tarea).
- Toolset `cron`/`cronjob` disponible en el turno interactivo.
- `TELEGRAM_ALLOWED_USERS` configurado (SEC-1.1) — este skill asume que el
  mensaje ya pasó el control de acceso del gateway.

## Workflow

### Paso 1 — Detectar la petición y elegir el comando

**Regla dura, verificada en producción (bug real, ver regla 1 de arriba):
si la petición implica generar una landing, web, portfolio, dashboard,
mockup, póster, o cualquier resultado visual/HTML, este skill se activa
SIEMPRE, sin excepción — no solo ante el patrón literal "diséñame X".**
Reconoce también variantes conversacionales reales que fallaron antes de
este fix: "hazme un diseño de una landing para...", "hazme una nueva
landing/web para...", "quiero una página para hablar de...", peticiones
en varios turnos que van afinando el encargo (tono, contenido, redes
sociales...), o cualquier petición de que se cree una página/web/landing
aunque no use la palabra "diseño" explícitamente. Si tienes dudas sobre si
algo "cuenta" como esto, trátalo como que sí cuenta. Elige `slashCommand`:

- `/design`: landing pages, mockups de UI, comparación de opciones visuales,
  pósters/flyers/one-pagers, webs personales/de portfolio.
- `/dataviz`: cualquier gráfico, dashboard, o visualización de datos.

Si no está claro cuál de los dos, o si la petición es realmente de código
(regla 3 de arriba), pregunta o redirige antes de continuar.

### Paso 2 — Aclarar si hace falta

Si la petición es demasiado vaga para generar algo razonable ("hazme un
diseño" sin más), pregunta qué quiere ver concretamente. Si el diseño
necesita contexto de un repo real (p. ej. "usa la paleta de mi proyecto X"),
pide el `owner/repo` completo — misma regla dura que `run-task`: nunca
inventes el owner.

### Paso 3 — Programar la ejecución (no ejecutarla tú)

Llama a `cronjob`:

- `action`: `'create'`, `schedule`: pocos segundos en el futuro, `repeat`:
  `1`.
- `deliver`: omítelo (se auto-entrega al chat/hilo de origen, igual que
  `run-task`).
- **Nunca pases `enabled_toolsets` a esta llamada — ni `["delegation"]` ni
  ningún otro valor. Déjalo completamente sin especificar.** Bug real,
  encontrado en producción: pasar `enabled_toolsets: ["delegation"]`
  restringe el turno del propio cronjob a **únicamente** la tool
  `delegate_task`, dejándolo sin acceso a `run_claude_command`,
  `brain_query` ni ninguna otra tool MCP — exactamente lo contrario de lo
  que se busca (confirmado comparando sesiones reales: con
  `enabled_toolsets` fijado, la sesión del cronjob tenía 1 sola tool
  disponible; sin fijarlo, 109). Es fácil caer en esto por asociación con
  la palabra "delegación"/"subagente" que aparece en el propio prompt de
  abajo — no la confundas con un parámetro real de `cronjob`.
- `prompt`: autocontenido —

  ````
  IMPORTANTE, regla dura verificada en producción: llama tú mismo, en ESTE
  turno, a las tools MCP reales (brain_query, run_claude_command,
  brain_record_observation). NUNCA uses delegate_task ni ningún otro
  mecanismo de subagente para hacer estas llamadas por ti — un subagente
  puede no tener estas tools disponibles y, en vez de fallar con un error,
  inventarse un resultado plausible (HTML, ruta de fichero, "éxito") sin
  haber ejecutado nada real. Si en algún momento no ves run_claude_command
  en tus tools disponibles en este turno, NO te lo inventes: responde con
  status "failed" explicando exactamente eso, nunca fabriques un resultado.

  Genera un Artifact delegando en run_claude_command:
  - slashCommand: </design o /dataviz>
  - prompt: <descripción completa acordada con el Operador>
  - repo: <owner/repo, solo si aporta contexto necesario>

  Si brain-mcp está disponible, llama primero a brain_query con una pregunta
  basada en el prompt para traer contexto relevante (p. ej. una paleta de
  colores ya decidida). Si falla o no responde, sigue sin contexto.

  Llama a run_claude_command con slashCommand/prompt y, si lo hay,
  brainContext. Según el resultado (el resultado REAL que te devuelve la
  tool, nunca uno que te inventes tú):
  - Si status == 'success' y hay htmlFilePath: responde con un mensaje breve
    confirmando el resultado, y en una línea aparte el tag
    "MEDIA:<htmlFilePath>" (ruta literal devuelta por la tool, sin
    modificarla) para que el gateway lo entregue como adjunto .html real,
    abrible desde el móvil.
  - Si status == 'success' y hay htmlContent pero NO htmlFilePath (despliegue
    sin CLAUDE_CODE_RUNNER_ARTIFACTS_DIR configurada): responde con un
    mensaje breve confirmando el resultado, pega el HTML completo como
    bloque de código (```html ... ```), y avisa explícitamente de que hay
    que guardarlo como fichero .html a mano para poder abrirlo — no asumas
    que el Operador lo sabe. Si es muy largo para un mensaje de Telegram,
    avisa de que el resultado se ha truncado y sugiere pedirlo con un
    alcance más acotado.
  - Si status es 'failed', 'needs_human_input' o 'timed_out': NO inventes un
    resultado. Responde con el summary literal.

  Después, si brain-mcp está disponible, llama a brain_record_observation
  con un resumen breve de lo ocurrido. Si falla, ignóralo.

  No hagas nada más: no repitas la llamada, no uses shell, no intentes
  publicar nada con una tool Artifact (no está disponible aquí), y no
  delegues ninguna de estas llamadas a un subagente.
  ````

### Paso 4 — Confirmar de inmediato

Responde ya en el chat: "Vale, me pongo a diseñarlo — te mando el resultado
en este mismo chat en unos minutos." Deja claro, si es la primera vez que el
Operador usa este skill, que el resultado es un fichero `.html` que se puede
abrir directamente (o, en el despliegue sin `htmlFilePath` configurado, el
HTML pegado como texto que hay que guardar a mano) — nunca un link ya
publicado a claude.ai. Evita esa expectativa concreta.

### Paso 5 — Nada que limpiar

El cronjob se autodestruye tras dispararse una vez (`repeat: 1`).

## Notas de operación

- Si `run_claude_command` devuelve el error de rate limiting, ese turno debe
  reportarlo tal cual — comparte cuota con `run_coding_task`/`run-task`.
- **Solo en el fallback sin `htmlFilePath`**: un HTML de diseño real puede
  superar cómodamente el límite de ~4096 caracteres de un mensaje de
  Telegram — es una limitación conocida y documentada, no un bug: si pasa,
  el cronjob debe decirlo explícitamente en vez de mandar un fragmento
  cortado sin avisar. Con `htmlFilePath` (el camino recomendado) esto no
  aplica: el adjunto `MEDIA:` no tiene ese límite (hasta 20 MB con la Bot
  API pública de Telegram).
