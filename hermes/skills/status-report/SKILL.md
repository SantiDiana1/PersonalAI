---
name: status-report
description: 'Responde a las preguntas del Operador sobre el propio sistema: estado operativo (sesión OAuth compartida, tareas atascadas, consumo aproximado de la ventana Pro) y métricas de uso acumulado (tareas resueltas, tasa de éxito por tool, eventos en Brain) — a demanda por chat o por un cronjob periódico.'
version: 1.0.0
author: PersonalAI
license: MIT
metadata:
  hermes:
    tags: [telegram, cron, operability, status, metrics]
    related_skills: [run-task, resolve-issue]
---

# status-report: informar del estado operativo de Hermes

## Overview

Un único skill para todas las preguntas del Operador **sobre el propio
sistema**. Dos preguntas distintas, dos tools, y elegir mal es el error que
este skill tiene que evitar:

| El Operador pregunta                                                                                                 | Tool                | Responde a                    |
| -------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------- |
| "¿cómo estás?", "¿algo pendiente?", "¿está viva la sesión?"                                                          | `get_runner_status` | ¿está todo bien **ahora**?    |
| "¿cuántas tareas has resuelto?", "dame las métricas", "¿cuál es tu tasa de éxito?", "¿cuánto has ingerido en Brain?" | `get_metrics`       | ¿cuánto se ha **usado** esto? |

Y tres disparadores (docs/decisions-log.md, Fase 6 US-6.3/US-6.4, y Fase 9 US-9.2):

- **Estado, a demanda** — el Operador pregunta por la salud del sistema en
  cualquier chat (Telegram u otro).
- **Métricas, a demanda** — el Operador pide números de uso acumulado.
- **Por cron** — un job de `hermes cron` (ver `hermes/config/README.md §5`)
  dispara el **informe de estado** periódicamente sin que nadie lo pida, para
  avisar de forma proactiva de una sesión caducada o de tareas atascadas. El
  cron no pide métricas: son acumuladas y no cambian de forma urgente.

Ambas tools son de solo lectura, sin parámetros, y viven en el mismo servidor
MCP `claude-code-runner`.

Si la petición pide claramente las dos cosas ("dame un informe completo"),
llama a las dos y responde con las dos secciones. Si es ambigua, prefiere
`get_runner_status` — es la que puede traer algo urgente.

## Reglas

1. **Solo lectura.** Este skill nunca llama a `run_coding_task` ni a ninguna
   otra tool que mute estado. Si el Operador pide algo más que un estado (p.
   ej. "y arréglalo"), eso es una petición nueva para el skill `run-task`,
   no una extensión de este.
2. **Una sola llamada por tool.** No reintentes si falla — repórtalo tal
   cual (ver "Si la tool falla" más abajo).
   2b. **Nunca calcules una métrica tú mismo.** Si `get_metrics` no está
   disponible, dilo — no estimes números a partir de lo que recuerdes de la
   conversación ni de tareas que hayas visto pasar. Un número inventado en un
   informe de métricas es peor que no dar el informe: se cita después como si
   fuera real. Mismo principio que la regla anti-alucinación de
   `run-design-task`.
3. **Las ventanas temporales son una aproximación, dilo.** Las cuentas de
   5h/7d/30d son tareas lanzadas por este runner, no la telemetría real de la
   cuota de Anthropic (que no se expone por API) — el mensaje al Operador debe
   dejarlo claro, nunca presentarlo como "cuota restante exacta". Las demás
   métricas (tareas resueltas, tasa de éxito, eventos de Brain) **sí** son
   exactas: no las marques como aproximadas, o el aviso deja de significar
   nada donde importa.

## Prerequisites

- Servidor MCP `claude-code-runner` registrado y conectado — expone
  `get_runner_status` (Fase 6) y `get_metrics` (Fase 9), ambas documentadas en
  `apps/claude-code-runner-mcp/src/mcpServer.ts`.

## Workflow

### Paso 1a — Estado: llamar a `get_runner_status`

Sin parámetros. Devuelve:

```json
{
  "session": { "valid": true } | { "valid": false, "reason": "expired" | "revoked" | "unknown", "detail": "..." },
  "persistenceAvailable": true,
  "tasksNeedingAttention": [
    { "id": "...", "repo": "owner/repo", "taskTitle": "...", "status": "needs_human_input" | "failed", "startedAt": "...", "finishedAt": "..." }
  ],
  "tasksStartedLast5h": 2,
  "tasksStartedLast7d": 11
}
```

### Paso 1b — Métricas: llamar a `get_metrics`

Sin parámetros. Devuelve:

```json
{
  "persistenceAvailable": true,
  "metrics": {
    "generatedAt": "2026-08-26T10:00:00.000Z",
    "tasks": {
      "byTool": [
        {
          "tool": "run_coding_task",
          "total": 12,
          "running": 1,
          "byStatus": { "success": 8, "failed": 2, "needs_human_input": 1, "timed_out": 0 },
          "successRate": 0.727
        }
      ],
      "startedLast5h": 2,
      "startedLast7d": 11,
      "startedLast30d": 37
    },
    "brain": {
      "totalEvents": 120,
      "eventsLast7d": 9,
      "bySource": [{ "source": "github", "count": 100 }]
    }
  }
}
```

Al formatearlo:

- **Nunca mezcles las dos tools en una sola tasa.** `run_coding_task` y
  `run_claude_command` se informan por separado porque fallan por motivos que
  no tienen nada que ver — un `/design` fallido no dice nada sobre la calidad
  del flujo de código. Da una tasa por tool, nunca una global.
- **`successRate: null` NO es 0 %.** Significa que ninguna tarea de esa tool
  ha terminado todavía. Dilo como "sin datos todavía"; un "0 % de éxito" ahí
  sería falso y alarmante.
- **`brain: null`** significa que el esquema de Brain no existe en esa base de
  datos. Dilo, no omitas la sección en silencio.
- `generatedAt` es el momento de la consulta, no hace falta citarlo salvo que
  el Operador pregunte por la frescura del dato.

### Paso 2 — Formatear la respuesta

Construye un mensaje breve, en el mismo estilo directo que define
`hermes/config/SOUL.md` (nada de "¡Todo genial! ✅" si no lo está):

- **Sesión OAuth**: si `session.valid` es `false`, esto va primero y en
  negrita — es lo más urgente ("Sesión de Claude Code no válida (`reason`):
  `detail`. Hace falta `claude setup-token` de nuevo en el host."). Si es
  `true`, una línea corta ("Sesión OAuth: válida.").
- **Tareas pendientes de atención**: si `tasksNeedingAttention` no está
  vacío, lístalas (repo, título, estado, cuándo) — son las que quedaron en
  `needs_human_input`/`failed` en los últimos 7 días. Si está vacío, dilo
  ("Sin tareas en needs_human_input/failed en los últimos 7 días.").
- **Consumo aproximado**: una línea con `tasksStartedLast5h` y
  `tasksStartedLast7d`, explícitamente marcada como aproximación ("~N tareas
  lanzadas en las últimas 5h / M en 7 días — cuenta de este runner, no la
  cuota real de Anthropic, que no se expone por API").
- Si `persistenceAvailable` es `false`, dilo explícitamente en vez de omitir
  las dos secciones anteriores en silencio: "Sin base de datos configurada en
  el runner — no hay histórico de tareas disponible."

### Si la tool falla

Si la tool que toca (`get_runner_status` o `get_metrics`) no responde, o el
servidor MCP `claude-code-runner` no está disponible, repórtalo tal cual ("No he podido consultar el estado del
runner: `<error>`") — no lo disfraces de "todo bien" ni reintentes sin que el
Operador lo pida.

## Registro del cronjob (US-6.3)

A diferencia de `run-task` (que no necesita cron, solo se activa en un turno
interactivo), este skill sí necesita un job **recurrente** para su mitad
proactiva — ver `hermes/config/README.md §5`:

```bash
hermes cron create 'every 24h' --name status-report --skill status-report \
  --deliver telegram:<tu_chat_id> \
  'Ejecuta el workflow de status-report y manda el resumen a este chat, sin que se te haya pedido.'
hermes cron list
hermes cron tick     # para probar el ciclo sin esperar 24h
```

El cronjob necesita `--deliver telegram:<chat_id>` explícito (a diferencia de
`run-task`, donde se omite porque hereda el origen de la conversación): un
cronjob recurrente no tiene "chat de origen" propio, así que hay que fijar el
chat/hilo del Operador a mano al crearlo. `<chat_id>` es el mismo ID numérico
que `TELEGRAM_ALLOWED_USERS` (SEC-1.1). Verificado en el despliegue real:
también hace falta `every` delante del intervalo (`'every 24h'`, no `'24h'`)
— sin él, `hermes cron create` interpreta el schedule como un disparo único
(`repeat: 1`), igual que hace `run-task` a propósito, pero aquí queremos
justo lo contrario.
