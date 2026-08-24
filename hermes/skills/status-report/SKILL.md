---
name: status-report
description: 'Resume el estado operativo de Hermes (sesión OAuth compartida, tareas recientes en needs_human_input/failed, consumo aproximado de la ventana Pro) — disparado a demanda por chat o por un cronjob periódico.'
version: 1.0.0
author: PersonalAI
license: MIT
metadata:
  hermes:
    tags: [telegram, cron, operability, status]
    related_skills: [run-task, resolve-issue]
---

# status-report: informar del estado operativo de Hermes

## Overview

Un único skill, dos disparadores (docs/roadmap.md, Fase 6, US-6.3 y US-6.4):

- **A demanda** — el Operador pregunta algo como "¿cómo estás?", "dame un
  estado", "¿algo pendiente?" en cualquier chat (Telegram u otro).
- **Por cron** — un job de `hermes cron` (ver `hermes/config/README.md §5`)
  lo dispara periódicamente sin que nadie lo pida, para avisar de forma
  proactiva de una sesión caducada o de tareas atascadas.

En ambos casos el contenido es el mismo: una única llamada de solo lectura a
la tool `get_runner_status` de `claude-code-runner-mcp`, formateada para
chat. No hay lógica de negocio distinta entre los dos caminos — solo cambia
quién/qué dispara el turno.

## Reglas

1. **Solo lectura.** Este skill nunca llama a `run_coding_task` ni a ninguna
   otra tool que mute estado. Si el Operador pide algo más que un estado (p.
   ej. "y arréglalo"), eso es una petición nueva para el skill `run-task`,
   no una extensión de este.
2. **Una sola llamada a `get_runner_status`.** No reintentes si falla —
   repórtalo tal cual (ver "Si la tool falla" más abajo).
3. **Los números son una aproximación, dilo.** `tasksStartedLast5h` /
   `tasksStartedLast7d` cuentan tareas lanzadas por este runner, no la
   telemetría real de la cuota de Anthropic (que no se expone por API) — el
   mensaje al Operador debe dejarlo claro, nunca presentarlo como "cuota
   restante exacta".

## Prerequisites

- Servidor MCP `claude-code-runner` registrado y conectado — expone
  `get_runner_status` (Fase 6, misma tool que documenta
  `apps/claude-code-runner-mcp/src/mcpServer.ts`).

## Workflow

### Paso 1 — Llamar a `get_runner_status`

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

Si `get_runner_status` no responde o el servidor MCP `claude-code-runner` no
está disponible, repórtalo tal cual ("No he podido consultar el estado del
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
