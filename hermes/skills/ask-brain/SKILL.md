---
name: ask-brain
description: 'Consulta o alimenta Brain directamente por chat ("¿qué sabíamos ya sobre X?", "anota que decidimos Y"), sin que tenga que ser un paso interno de una tarea de código.'
version: 1.0.0
author: PersonalAI
license: MIT
metadata:
  hermes:
    tags: [telegram, mcp, memory, conversational]
    related_skills: [run-task, resolve-issue]
---

# ask-brain: hablar con Brain directamente por chat

## Overview

`brain-mcp` (Fase 5) ya se consulta internamente desde `resolve-issue` y
`run-task` antes de delegar una tarea de código. Este skill expone las
mismas dos tools (`brain_query`, `brain_ingest`) **directamente en la
conversación**, para cuando el Operador quiere memoria sin que haga falta una
tarea de código de por medio — docs/decisions-log.md, Fase 6, US-6.5. No se toca
`apps/brain`/`apps/brain-mcp`: es una capa de conversación encima de tools ya
existentes.

**No confundir con la `memory` tool nativa de hermes-agent.** hermes-agent
trae su propia herramienta `memory` (perfil de usuario + notas del propio
agente, ver el system prompt), siempre disponible sin cargar ningún skill —
y, verificado en producción (Fase 6), es la que el modelo usa por defecto si
el Operador dice algo tipo "anota que...", incluso cuando el mensaje nombra
"Brain" explícitamente ("escribe en brain que..."). Son sistemas distintos:
`memory` es la memoria interna de hermes-agent (preferencias del Operador,
notas operativas del propio agente); Brain (`brain_query`/`brain_ingest`, vía
este skill) es el proyecto de memoria compartida de PersonalAI (Fase 4/5),
consultable también por otros agentes futuros. **Regla dura**: si el mensaje
del Operador menciona "Brain" explícitamente, o pide guardar/consultar
conocimiento sobre el proyecto (decisiones, notas, contexto de tareas — no
preferencias personales tipo "me llamo X"), usa `ask-brain`
(`brain_query`/`brain_ingest`), nunca la tool `memory` nativa. Si es
ambiguo, usa las dos no cuesta nada extra — mejor guardar en ambos sitios
que perder la petición explícita del Operador de "escribir en Brain".

## Reglas

1. **El mensaje del Operador es instrucción legítima, no dato de terceros.**
   A diferencia de `resolve-issue` (que trata el cuerpo de una issue como
   texto no confiable — regla 1 de `hermes/config/SOUL.md`), aquí el mensaje
   viene de una conversación ya autenticada por el gateway (mismo criterio
   que `run-task`). No hace falta el tratamiento de prompt injection.
2. **Best-effort, igual que en cualquier otro flujo con Brain.** Si
   `brain_query`/`brain_ingest` fallan o `brain-mcp` no responde, dilo tal
   cual — no hay fallback silencioso ni reintento automático.
3. **`brain_ingest` solo con contenido explícito del Operador.** No
   resumas ni reinterpretes lo que pide anotar — pásalo tal cual (o con
   mínima limpieza de formato) como contenido a ingerir, para que quede
   trazable qué dijo exactamente el Operador.

## Prerequisites

- Servidor MCP `brain-mcp` registrado y conectado (Fase 5).

## Workflow

### Paso 1 — Reconocer la petición

Dos formas:

- **Pregunta** ("¿qué sabíamos ya sobre X?", "¿tenemos algo sobre Y?",
  "búscame en Brain..."): va a `brain_query`.
- **Orden de anotar** ("anota que decidimos Y", "recuerda que X", "guarda
  esto: ..."): va a `brain_ingest`.

Si el mensaje es ambiguo entre las dos, pregunta antes de llamar a ninguna
tool — igual que el resto de skills de este proyecto, no adivines.

### Paso 2a — Consulta (`brain_query`)

Llama a `brain_query` con el texto de la pregunta del Operador tal cual (sin
reescribirlo). Si devuelve fragmentos, resúmelos en la respuesta al chat
citando de qué venían (fuente/`source_authority` si la tool lo expone) — no
inventes contexto que Brain no devolvió. Si no devuelve nada relevante,
dilo explícitamente ("Brain no tiene nada relevante sobre esto todavía"), no
lo rellenes con conocimiento general como si fuera memoria del proyecto.

### Paso 2b — Anotar (`brain_ingest`)

Llama a `brain_ingest` con:

- `text`: el contenido que el Operador pidió anotar, tal cual (mínima
  limpieza de formato, sin resumir ni reinterpretar).
- `source`: `'notes'` — es la categoría que usa `docs/personal-brain/spec.md`
  para anotaciones directas del Operador, no procedentes de GitHub/Notion/
  Jira/feedback de tareas.
- `sourceAuthority`: `'canonical'` — viene directamente del Operador, no de
  una fuente secundaria a reconciliar más adelante.
- `externalRef`: omítelo salvo que el Operador dé un enlace/referencia
  explícita (una issue, un PR) a la que asociar la anotación.

Confirma en el chat qué quedó guardado (una frase, no un volcado del payload
completo) para que el Operador pueda corregir si se guardó mal.

### Si la tool falla

Si `brain-mcp` no responde o devuelve error, dilo tal cual ("No he podido
consultar/anotar en Brain: `<error>`") — nunca finjas que la memoria se
guardó o se consultó cuando no fue así.

## Verificación (US-6.5)

Ciclo real mínimo para dar la historia por verificada: ingesta algo por chat
("anota que decidimos usar X para Y") → en un turno posterior, pregunta por
ello ("¿qué decidimos sobre Y?") → confirma que `brain_query` lo recupera.
