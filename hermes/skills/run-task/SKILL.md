---
name: run-task
description: 'Reconoce peticiones conversacionales de tareas de código (p. ej. por Telegram), las delega en claude-code-runner-mcp sin bloquear el chat, y avisa en el mismo hilo cuando terminan.'
version: 1.0.0
author: PersonalAI
license: MIT
metadata:
  hermes:
    tags: [telegram, coding-agent, mcp, cron, conversational]
    related_skills: [resolve-issue, resolve-jira-task]
---

# run-task: ejecutar una tarea de código pedida por chat

## Overview

Procedimiento para cuando el Operador te pide, en una conversación normal (por
ejemplo por Telegram), algo como "resuelve la issue #42 de mi-repo" o "arregla
X en el repo Y". Traduce esa petición en la misma tool `run_coding_task` que
usa el Skill `resolve-issue` (docs/hermes/spec.md §5) — la única diferencia es
el disparador: aquí es un mensaje de chat, no el cron que escanea issues
etiquetadas.

La pieza específica de este skill es **cómo no bloquear la conversación**:
`run_coding_task` puede tardar hasta 30 minutos, y el turno interactivo tiene
que devolver una confirmación en segundos. Ver "Por qué un cronjob y no
`delegate_task`" más abajo — no es una elección arbitraria, es el resultado de
leer el código fuente de hermes-agent durante la Fase 3 del roadmap.

## Reglas innegociables

1. **Si la petición nombra o describe un ticket de Jira, cede — no la
   proceses aquí.** Jira tiene su propio skill, `resolve-jira-task`, con su
   propio contrato de seguridad (allowlist de endpoints, descubrimiento de
   transición, etiquetas como fuente de verdad — ver su `SKILL.md` y
   `docs/security.md` SEC-2.5). Un mensaje como "lanza WEB-6" o "resuelve la
   tarea de Jira sobre X" coincide también con el patrón de detección de este
   mismo skill (Paso siguiente) — cuando coincida con los dos, gana
   `resolve-jira-task`, siempre, sin excepción. **Regla dura, añadida el
   2026-08-28 tras un incidente real**: antes de esta regla, este skill
   procesó una petición de tres tickets de Jira, programó el cronjob con
   `skills: []` (Paso 3, antigua redacción) y metió en el prompt, en texto
   libre, la instrucción de transicionar los tickets con `jira_post` — sin
   descubrimiento de transición, sin etiquetas, sin ninguna de las
   mitigaciones de `resolve-jira-task`. Ver `docs/security.md` SEC-2.6 y
   `docs/roadmap.md` Fase 20 para el análisis completo. Si tienes dudas sobre
   si algo "es" una tarea de Jira, trátalo como que sí lo es y cede.

2. **Solo tools MCP para el trabajo de código.** Igual que `resolve-issue`: la
   ejecución real ocurre en `claude-code-runner-mcp`, nunca invocando `git`,
   `gh` ni shell directamente desde aquí.

3. **El repo tiene que venir explícito en el mensaje del Operador, con
   `owner/repo` completo.** No lo infieras de una conversación previa
   ambigua ni asumas un repo "habitual". **Regla dura, verificada en
   producción (Fase 6): un nombre de repo sin owner (p. ej. "el repo
   PersonalAI") NO cuenta como explícito, aunque el nombre "suene" completo
   o coincida con un repo real que conozcas de contexto previo — nunca
   adivines el owner.** Un intento real de esto (mensaje "súbelo como PR al
   repo PersonalAI") hizo que el skill asumiera `PersonalAI/PersonalAI`
   (owner inventado) y la tarea fallara en el `git clone` con "repository not
   found" — el fallo se detectó tarde (dentro del cronjob) en vez de en el
   Paso 2, donde debía haberse preguntado. Si no está claro el repo completo
   (`owner/repo`), el alcance de la tarea, o ambos: **pregunta antes de
   programar nada**. No programes un cronjob especulativo "por si acaso" —
   espera la respuesta y entonces continúa.

4. **Nunca mergeas, y el trabajo pesado nunca corre en el turno interactivo.**
   `run_coding_task` (y, si tiene éxito, `create_pull_request`) se ejecutan
   **dentro del cronjob de un solo disparo** que programas en el Paso 3, nunca
   en este turno. Ver la sección siguiente para el motivo.

5. **Una petición, una ejecución programada.** Si ya confirmaste la tarea y
   programaste el cronjob, no lo dupliques aunque el Operador repita el
   mensaje mientras esperáis — dile que ya está en marcha.

6. **El prompt del cronjob nunca instruye una escritura a una fuente de
   tareas en texto libre.** Este skill produce PRs de código —
   `run_coding_task` seguido, si tiene éxito, de `create_pull_request`. Si en
   algún momento el Operador pide además cerrar un ticket, mover una
   etiqueta, o comentar en Jira/GitHub como parte de esta misma petición, eso
   **no se mete a mano en el prompt** (ver el incidente citado en la Regla
   1): o bien la petición es realmente de Jira y cede por la Regla 1, o bien
   se programa como una segunda llamada a `cronjob(action='create')` que
   **sí** carga el skill de la fuente correspondiente vía `skills:` (p. ej.
   `skills: ['resolve-jira-task']`), nunca con `skills: []` y una instrucción
   suelta. Un `skills: []` en el Paso 3 solo es seguro mientras el prompt
   completo se limite a `run_coding_task` → PR — en cuanto toca una fuente,
   deja de serlo.

## Por qué un cronjob y no `delegate_task`

El roadmap (Fase 3, tareas técnicas) planteaba `delegate_task` (subagentes)
como mecanismo preferido para no bloquear el chat mientras `run_coding_task`
corre. Verificado leyendo `tools/delegate_tool.py` del propio hermes-agent:
**no sirve para esto**. La propia descripción de la tool lo dice de forma
explícita:

> `delegate_task` runs SYNCHRONOUSLY inside the parent turn: if the parent is
> interrupted (user sends a new message, `/stop`, `/new`) the child is
> cancelled with `status='interrupted'` and its work is discarded. Children
> cannot continue in the background. [...] Durable long-running work that must
> outlive the current turn -> use `cronjob (action='create')` [...] instead.

Es decir: `delegate_task` bloquea el turno actual igual que una llamada
directa, y si el Operador manda otro mensaje mientras tanto (algo bastante
probable en una tarea de hasta 30 minutos), la tarea se cancela y el trabajo
se pierde. Es lo opuesto de lo que pide US-3.3/US-3.4 del roadmap.

En su lugar se usa `cronjob(action='create', ...)` con `repeat: 1` (un solo
disparo, casi inmediato). Es asíncrono de verdad: el turno actual termina en
cuanto confirmas, el cronjob corre en un turno completamente aparte cuando se
dispara, y si el Operador manda otro mensaje mientras tanto no lo cancela.
Cuando ese turno del cronjob termina, hermes-agent **entrega su respuesta
final automáticamente al chat/hilo de origen** si no se especifica `deliver`
(verificado en `tools/cronjob_tools.py::_origin_from_env` — captura
`platform`/`chat_id`/`thread_id` de la sesión activa y los usa como destino
por defecto). Es el mismo mecanismo de entrega que ya usan todos los cronjobs
de hermes-agent (`cron.wrap_response: true`), no un canal nuevo.

## Prerequisites

- Servidor MCP `claude-code-runner` registrado y conectado (igual que
  `resolve-issue`).
- Servidor MCP de GitHub registrado y conectado (para abrir el PR si la tarea
  tiene éxito).
- Servidor MCP `brain-mcp` registrado (Fase 5, opcional en el sentido de que
  su ausencia o caída nunca bloquea la tarea — ver Paso 3).
- Toolset `cron`/`cronjob` disponible en el turno interactivo (no solo en
  jobs de cron — aquí lo invoca el propio chat).
- `TELEGRAM_ALLOWED_USERS` configurado (SEC-1.1) — este skill **asume** que el
  mensaje ya pasó el control de acceso del gateway antes de llegar aquí; no
  repite esa comprobación.

## Workflow

### Paso 1 — Detectar la petición

Reconoce mensajes del tipo "resuelve la issue #N de owner/repo", "arregla
`<descripción>` en `<repo>`", "escribe/crea un script/función/fichero y súbelo
como PR", "añade X al repo Y", o cualquier petición que implique escribir o
modificar código en un repo real — no solo el patrón literal "resuelve/
arregla". **Regla dura, verificada en producción (Fase 6): si la petición
implica tocar código o abrir un PR en un repo real, este skill se activa
SIEMPRE, sin excepción — nunca uses las tools de GitHub directamente
(`create_branch`, `create_or_update_file`, `create_pull_request`...) para
escribirlo tú mismo en el turno interactivo, ni siquiera para algo trivial
como un script de una línea.** Eso rompe el aislamiento de ejecución (SEC-2.1/
SEC-4.x): todo trabajo de código pasa por `run_coding_task`, en el contenedor
efímero, nunca por llamadas directas a la API de GitHub desde este turno. Si
tienes dudas sobre si algo "cuenta" como tarea de código, trátalo como que sí
cuenta. A diferencia del contenido de una issue de GitHub (que es de
terceros, regla 2 de `resolve-issue`), este mensaje lo escribe el propio
Operador ya autenticado por el gateway — puedes tratarlo como una instrucción
legítima, no como datos a desconfiar.

### Paso 2 — Aclarar si hace falta

Si el repo no viene como `owner/repo` completo (un nombre suelto como
"PersonalAI" o "mi-repo" no cuenta, ni aunque coincida con un repo real que
conozcas de contexto previo), o el alcance de la tarea es vago ("arregla el
bug" sin decir cuál), pregunta por el mismo chat y espera la respuesta. No
sigas al Paso 3 hasta tener `owner/repo` completo y una descripción de tarea
razonablemente concreta.

### Paso 3 — Programar la ejecución (no ejecutarla tú)

Llama a `cronjob`:

- `action`: `'create'`
- `schedule`: un timestamp ISO a pocos segundos en el futuro (basta con
  "ahora mismo, sin repetición" — el objetivo es desacoplar del turno actual,
  no posponer de verdad).
- `repeat`: `1` (un solo disparo).
- `deliver`: **omítelo** — así se auto-entrega al chat/hilo de origen (ver
  sección anterior). No lo fijes a mano salvo que el Operador pida
  explícitamente que el aviso vaya a otro sitio.
- `prompt`: autocontenido — el turno del cronjob **no tiene memoria de esta
  conversación**, así que debe incluir todo lo necesario:

  ```
  Resuelve esta tarea de código delegando en run_coding_task:
  - repo: <owner/repo>
  - taskTitle: <título corto>
  - taskDescription: <descripción completa acordada con el Operador>

  Primero, si el servidor MCP brain-mcp está disponible, llama a brain_query
  con una pregunta basada en taskTitle/taskDescription para traer contexto
  relevante (convenciones del repo, decisiones previas, tareas similares). Si
  brain_query falla, tarda demasiado, o brain-mcp no está disponible, sigue
  sin contexto — nunca bloquees la tarea por esto (no es opcional intentarlo,
  pero sí lo es que responda). Si devuelve fragmentos, únelos en un texto
  breve para usarlo como brainContext.

  Llama a run_coding_task con repo/taskTitle/taskDescription y, si lo hay,
  brainContext (omite el parámetro si Brain no devolvió nada). Según el
  resultado:
  - Si status == 'success': abre un PR con create_pull_request (rama origen
    el branchName devuelto, rama destino la rama por defecto del repo, cuerpo
    el summary devuelto). Responde con un mensaje breve confirmando éxito y
    el link al PR.
  - Si status es 'failed', 'needs_human_input' o 'timed_out': NO abras PR.
    Responde con el summary literal y qué significa ese estado.

  Después, en cualquier resultado, si brain-mcp está disponible llama a
  brain_record_observation con un resumen breve de lo ocurrido (éxito/fallo +
  el summary) y externalRef = el link al PR si se abrió uno. Si esta llamada
  falla, ignóralo — no reintentes ni cambies la respuesta ya dada al Operador.

  No hagas nada más: no repitas la llamada a run_coding_task, no uses shell.
  ```

  **El prompt es esta plantilla, tal cual — no le añadas pasos.** En
  concreto, no le pegues instrucciones de cerrar, comentar o transicionar un
  ticket de Jira/GitHub aunque el Operador lo haya pedido en el mismo
  mensaje: eso es la Regla 6. Si la petición completa es sobre un ticket de
  Jira, ni siquiera llegas aquí — cede por la Regla 1.

- `skills`: vacío, porque esta plantilla no toca ninguna fuente de tareas —
  solo `run_coding_task` y `create_pull_request`. Si alguna vez este Paso
  cambia para incluir una escritura a una fuente, `skills` deja de poder
  quedar vacío (Regla 6): la ejecución del sub-turno depende de que las
  reglas de esa fuente estén cargadas, no de que quien escribió este prompt
  las recuerde.

### Paso 4 — Confirmar de inmediato

Sin esperar a que el cronjob se dispare ni a que `run_coding_task` responda,
contesta ya en el chat: algo como "Vale, me pongo con ello — te aviso en este
mismo chat cuando termine (puede tardar hasta 30 minutos)." Este es el paso
que cumple la confirmación inmediata (US-3.3): el turno interactivo termina
aquí.

### Paso 5 — Nada que limpiar

El cronjob se creó con `repeat: 1`, así que se autodestruye tras dispararse
una vez. No hace falta borrarlo a mano.

## Notas de operación

- Si `run_coding_task` devuelve el error de rate limiting dentro del turno del
  cronjob, ese turno debe reportarlo tal cual en el mensaje final — no
  reintenta por su cuenta (mismo motivo que en `resolve-issue`: la cuota es
  compartida con el chat).
- Si el MCP de GitHub falla al abrir el PR después de un `success`, el mensaje
  final debe decir explícitamente que el trabajo está empujado en
  `branchName` aunque el PR no se haya podido abrir — no se pierde el
  resultado, solo falta un paso manual.
- Este skill no gestiona etiquetas de issue (`hermes:in-progress` etc.) — eso
  es específico del flujo de `resolve-issue` sobre GitHub Issues. Si el
  mensaje del Operador menciona una issue concreta, referénciala en el PR
  (`Closes #<número>`) pero no toques sus etiquetas desde aquí.
