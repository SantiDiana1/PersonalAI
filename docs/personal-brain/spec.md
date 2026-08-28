# Spec — Personal Brain

## 0. Alcance de este proyecto — léelo antes que nada

> **Decisión de alcance (Fase 0/tras Fase 0)**: en este proyecto, Brain se construye deliberadamente **básico**: ingestión de eventos + búsqueda por similitud semántica, nada más. La capa de **consolidación** (extracción de observations vía LLM, reconciliación de contradicciones, mental models — sección 4.2) es la pieza que de verdad convertiría esto en un "company brain" real, y **está diseñada en este documento pero no se construye en este proyecto**. Es trabajo futuro **que ya tiene sitio asignado**: [Milestone v4, Fase 11](../roadmap.md#milestone-v4--company-brain) — deliberadamente el último bloque del proyecto, por la regla de no abrir la pieza más grande hasta tener cerrada la base bajo ella. (Hasta el 2026-08-28 esta nota decía "fuera del roadmap"; dejó de ser cierto al planificarse v4.)
>
> Por qué: el objetivo de este proyecto es demostrar bien el patrón Hermes ↔ MCP ↔ Brain con un Brain simple pero real (no un stub vacío), no construir de fondo el sistema completo de consolidación — eso el Operador prefiere diseñarlo y construirlo él mismo más adelante, con calma. El resto de este spec sigue describiendo la visión completa del "company brain" (útil como referencia de diseño para ese trabajo futuro), pero cada sección indica explícitamente qué parte se construye aquí y qué parte no.

## 1. Resumen

Personal Brain es una implementación **personal** (single-user) del patrón "company brain" descrito en:

- [How to Build a Company Brain for AI Agents](https://vectorize.io/articles/how-to-build-company-brain) (vectorize.io) — el marco de las 4 propiedades y las 4 capas que sigue este spec.
- [Company Brain](https://gurusup.com/es/brain) (gurusup.com) — la idea de que el conocimiento no escrito también debe poder capturarse (en nuestra v1, esto se simplifica: no hay "active knowledge hunting" contactando a personas, ver sección 8).

La distinción que hace el propio artículo de vectorize es clave para justificar este proyecto: un **"company brain"** tiene alcance organizacional (múltiples personas, permisos por usuario); un **"second brain"** tiene alcance personal (un único usuario, su propio contexto). Este proyecto documenta un **second brain con la arquitectura de un company brain** — mismo diseño de 4 capas, mismo modelo de datos pensado para permisos — pero **en este proyecto solo se construyen 2 de las 4 capas** (ingestion y una retrieval mínima); consolidation y la parte "evolving" de action quedan documentadas para más adelante (ver §0).

## 2. Objetivos

- Ser la memoria persistente y consultable que evita que yo (o un agente como Hermes) tengamos que re-derivar contexto que ya existe en algún sitio (una decisión de arquitectura tomada hace 3 meses, una convención de un repo, el motivo de un bug ya resuelto) — **en v1, a nivel de "aquí hay un fragmento de texto relacionado", no de hecho estructurado y reconciliado**.
- Servir de primer paso hacia, a escala personal, las **4 propiedades** de un company brain real (estado real en este proyecto, no aspiracional):
  1. **Shared** — ✅ construido: una única fuente de verdad (Brain) que consultan tanto yo como cualquier agente (Hermes u otros futuros).
  2. **Enforceable** — ✅ construido: Hermes (Fase 5) está obligado a consultar a Brain antes de actuar vía el Skill `resolve-issue`, tanto por GitHub como por Telegram.
  3. **Evolving** — ⚠️ parcial: Brain recibe feedback real de Hermes (`hermes_feedback`) y crece con el uso, pero **no reconcilia ni sintetiza** ese feedback — eso es la parte de consolidación fuera de alcance (§4.2). Se actualiza sola en el sentido de "acumula", no en el sentido de "aprende y resume".
  4. **Agent-readable** — ✅ construido: API estructurada (HTTP + MCP), no solo texto para humanos.
- Documentar de verdad la capa de **consolidación** (extracción de observations + reconciliación de contradicciones + mental models) como diseño de referencia — es la capa que, según el artículo, diferencia un company brain real de "un vector store con extra pasos". **No se implementa en este proyecto** (ver §0), queda lista para cuando el Operador quiera construirla.

## 3. No-objetivos (v1 — este proyecto)

- **La capa de consolidación no se construye en este proyecto** (extracción de observations vía LLM, reconciliación de contradicciones, mental models — §4.2). Trabajo futuro del Operador, documentado como referencia.
- No es multi-tenant ni tiene permisos por usuario reales — es de un único usuario (yo). El modelo de datos sí incluye un campo de `visibility`/`source_authority` pensado para eso, pero no se construye la lógica de autorización completa.
- No implementa "active knowledge hunting" (contactar a alguien por WhatsApp/email cuando falta un dato, como propone gurusup) — es una idea interesante pero pensada para un contexto de equipo, no para un usuario único. Queda documentada como trabajo futuro (sección 8).
- No sustituye a mis herramientas de notas existentes (Notion, Obsidian, lo que use) — las **ingesta**, no las reemplaza.
- No hace fine-tuning ni entrena modelos propios — usa un proveedor de embeddings comercial (vía API) para la búsqueda por similitud.
- Retrieval por entidad, temporal y por grafo (§4.3) **no se construyen** en v1 — dependen de que existan `Observation`s con `entity` asignada, que a su vez depende de la consolidación (fuera de alcance). v1 es únicamente similarity search sobre el texto crudo ingestado.

## 4. Las capas — qué se construye y qué no

### 4.1 Ingestion (`src/ingestion/`) — ✅ se construye en este proyecto (Fase 4)

Fuentes soportadas, por prioridad:

1. **Notas personales** (Markdown — de un vault de Obsidian/Notion export, o archivos sueltos) — vía import manual/CLI en Fase 4, vía sync automático en trabajo futuro.
2. **GitHub** — descripciones de PR, comentarios de review y commits de mis propios repos (fuente canónica para "por qué se hizo X en el código").
3. **Notion / Jira** — páginas/tickets marcados como fuente de contexto (no todas las tareas, solo documentos de referencia: decisiones, runbooks) — Fase 7 de v2 (post-v1, ver `docs/decisions-log.md`).
4. **Resultados de Hermes** — cada llamada a `brain_record_observation` (vía `brain-mcp`, ver sección 5.2) que hermes-agent hace tras ejecutar una tarea (por GitHub o por Telegram) es, en sí mismo, una fuente de ingestion (la más valiosa, porque es feedback directo de una acción real) — Fase 5. En v1 esto se persiste tal cual como `RawEvent` (`source: 'hermes_feedback'`), sin extracción LLM.

Filtro de canonicidad (tomado del artículo, sí se construye): cada fuente se etiqueta con una `source_authority` (`canonical` | `supporting`). Un PR description es `canonical`; una nota rápida sin revisar es `supporting`. En v1 este campo se persiste y se puede usar para ordenar/filtrar resultados, pero no hay lógica de reconciliación que lo use activamente (eso es consolidación, fuera de alcance).

Cada evento de ingestion se normaliza a un `RawEvent`:

```ts
interface RawEvent {
  id: string;
  source: 'notes' | 'github' | 'notion' | 'jira' | 'hermes_feedback';
  sourceAuthority: 'canonical' | 'supporting';
  externalRef?: string; // url, PR id, etc.
  text: string;
  occurredAt: string; // fecha del evento real, no de la ingesta
  ingestedAt: string;
}
```

Este es el **único** modelo de datos "de contenido" que se construye en v1, junto con su embedding (ver §6).

### 4.2 Consolidation — FUERA DE ALCANCE DE ESTE PROYECTO (diseño de referencia únicamente)

> Nada de esta sección está construido todavía. Es el contenido de [Milestone v4, Fase 11](../roadmap.md#milestone-v4--company-brain), el último bloque planificado del proyecto: hasta que se abra, `apps/brain/src/consolidation` no existe y esta sección es diseño de referencia, no descripción de algo que corra.

La capa que, según el artículo de referencia, diferencia un company brain real de "un vector store con extra pasos" — tres trabajos:

1. **Extracción de observations**: un LLM procesa cada `RawEvent` y extrae hechos estructurados (`Observation`), no una copia del texto. P. ej.: un PR titulado "Switch deploy region to eu-west-1" se convierte en `"A partir de [fecha], los despliegues de <repo> usan la región eu-west-1"`.
2. **Reconciliación**: al crear una `Observation` nueva, se busca si contradice una `Observation` existente (misma entidad/tema). Si hay conflicto, se aplica una política de reconciliación:
   - **Recency-weighted** (política por defecto, si se implementa): gana la observation más reciente.
   - **Source-authority-weighted**: una fuente `canonical` gana sobre una `supporting` aunque sea más antigua (override explícito, configurable por tipo de hecho).
   - La observation "perdedora" no se borraría — se marcaría `superseded_by` para mantener trazabilidad (auditable, como pide el patrón de consolidación).
3. **Mental models**: un job periódico agruparía observations relacionadas (mismo tema/entidad, ej. "cómo despliega el repo X") en un `MentalModel` — resumen sintetizado que se convertiría en la unidad de retrieval preferente antes que devolver observations sueltas.

```ts
// Diseño de referencia — no se implementa en este proyecto.
interface Observation {
  id: string;
  statement: string; // el hecho extraído, en lenguaje natural estructurado
  entity: string; // p.ej. "repo:personalAI", "topic:deploy"
  sourceEventId: string;
  sourceAuthority: 'canonical' | 'supporting';
  validFrom: string;
  supersededBy?: string; // si fue reconciliada por otra observation
  createdAt: string;
}

interface MentalModel {
  id: string;
  entity: string;
  summary: string;
  observationIds: string[];
  updatedAt: string;
}
```

### 4.3 Retrieval (`src/retrieval/`) — parcial: solo semántica se construye en este proyecto (Fase 4)

El artículo de referencia recomienda multi-estrategia (single-strategy pierde queries que las otras sí capturan). En este proyecto:

- **Semántica** — ✅ se construye: embeddings sobre `text` de cada `RawEvent` (pgvector, similarity search). Es la única estrategia de retrieval de v1.
- **Por entidad** — fuera de alcance: filtrar directo por `entity` (`repo:personalAI`) requiere que las `Observation`s existan con ese campo asignado — depende de la consolidación (§4.2).
- **Temporal** — fuera de alcance: "¿cuál es la convención _actual_?" vs "¿qué se decidió en su momento?" requiere el campo `supersededBy` de `Observation` — depende de la consolidación.
- **Grafo** — fuera de alcance (ya lo era en el diseño original, v2 no bloqueante): traversal simple sobre relaciones `entity -> entity`.

En v1, el resultado de `POST /v1/query` es simplemente los `k` `RawEvent`s más similares por embedding, con su score — sin re-ranking por entidad ni penalización por superseded (no aplica, no hay ese concepto en v1).

### 4.4 Action (`src/api` + `brain-mcp` + consumidores) — ✅ se construye en este proyecto (Fase 4/5)

Brain no actúa por sí mismo — expone la capa de retrieval y recibe feedback. Brain en sí habla HTTP/REST (`apps/brain/src/api`); el consumidor real, [hermes-agent](https://github.com/NousResearch/hermes-agent) (ver [hermes/spec.md](../hermes/spec.md)), no le habla directamente — pasa por **`apps/brain-mcp`**, un servidor MCP fino que traduce tools MCP a llamadas a esta API. Esto es intencional: hermes-agent (y cualquier otro cliente MCP futuro — Claude Desktop, Cursor, etc.) obtiene a Brain como una integración MCP estándar, sin acoplarse a los detalles HTTP internos.

La propiedad "evolving" de action se cumple solo parcialmente en v1: Brain **acumula** feedback real de Hermes (vía `brain_record_observation` → `RawEvent` tipo `hermes_feedback`), pero no lo sintetiza ni reconcilia — eso requeriría la consolidación (§4.2).

## 5. API

### 5.1 API interna (HTTP/REST, `apps/brain/src/api`)

Base: `POST /v1/*`, JSON, autenticado con un token estático simple (Bearer) — solo la llama `brain-mcp` (mismo host/red interna del servidor local), no hace falta OAuth para v1.

### `POST /v1/query`

Request:

```json
{
  "question": "¿cuál es la convención de nombres de branches en personalAI?",
  "k": 5
}
```

Response (v1 — solo fragmentos por similitud, sin observations/mentalModels):

```json
{
  "fragments": [
    {
      "id": "...",
      "text": "...",
      "score": 0.83,
      "source": "github",
      "sourceAuthority": "canonical",
      "occurredAt": "..."
    }
  ]
}
```

> Nota de compatibilidad futura: si el Operador retoma la consolidación (§4.2) más adelante, este endpoint puede ampliarse para devolver también `mentalModels`/`observations` sin romper el contrato actual (añadir campos, no quitar `fragments`).

### `POST /v1/ingest`

Ingesta manual/automática de un `RawEvent` (ver 4.1). Genera su embedding de forma asíncrona (no bloquea la respuesta). **No** dispara ninguna consolidación (no existe en v1).

### `POST /v1/observations`

Feedback directo de un agente tras actuar — se trata como un `RawEvent` de tipo `hermes_feedback` y se persiste con su embedding, igual que cualquier otro `RawEvent`. El nombre del endpoint se mantiene (por claridad semántica del contrato con Hermes — "esto es un resultado de acción, no una nota"), aunque en v1 no exista una `Observation` real detrás.

### 5.2 API vía MCP (`apps/brain-mcp`, lo que realmente consume Hermes)

`brain-mcp` expone tres tools MCP, cada una un wrapper delgado sobre el endpoint REST equivalente:

```ts
// tool: brain_query — envuelve POST /v1/query
interface BrainQueryInput {
  question: string;
  k?: number; // por defecto un valor razonable, p.ej. 5
}
interface BrainQueryOutput {
  fragments: Array<{
    id: string;
    text: string;
    score: number;
    source: string;
    sourceAuthority: 'canonical' | 'supporting';
    occurredAt: string;
  }>;
}

// tool: brain_ingest — envuelve POST /v1/ingest
interface BrainIngestInput {
  source: RawEvent['source'];
  sourceAuthority: 'canonical' | 'supporting';
  text: string;
  externalRef?: string;
}

// tool: brain_record_observation — envuelve POST /v1/observations
interface BrainRecordObservationInput {
  text: string; // resultado de la acción del agente, en lenguaje natural
  externalRef?: string; // p.ej. URL del PR
}
```

Este es el contrato que se registra en la configuración de hermes-agent (`hermes mcp add brain-mcp ...`) y el que usa el Skill `resolve-issue` (ver [hermes/spec.md](../hermes/spec.md#5-el-skill-resolve-issue)). Si `brain-mcp` no responde, debe fallar de forma segura: hermes-agent debe poder seguir con la tarea sin contexto (el Skill lo trata como "no context available", nunca como bloqueante).

## 6. Modelo de datos (Postgres, esquema `brain`)

Lo que **se crea** en este proyecto:

```sql
create extension if not exists vector;

create table raw_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_authority text not null check (source_authority in ('canonical','supporting')),
  external_ref text,
  text text not null,
  embedding vector(1024),
  occurred_at timestamptz not null,
  ingested_at timestamptz not null default now()
);
```

Lo que **no se crea** en este proyecto (diseño de referencia para la consolidación futura, §4.2 — se documenta aquí para no perderlo, pero no forma parte de las migraciones de v1):

```sql
-- Diseño de referencia — NO se crea en este proyecto.
create table observations (
  id uuid primary key default gen_random_uuid(),
  statement text not null,
  entity text not null,
  source_event_id uuid references raw_events(id),
  source_authority text not null,
  valid_from timestamptz not null,
  superseded_by uuid references observations(id),
  embedding vector(1024),
  created_at timestamptz not null default now()
);

create table mental_models (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  summary text not null,
  embedding vector(1024),
  updated_at timestamptz not null default now()
);

create table mental_model_observations (
  mental_model_id uuid references mental_models(id),
  observation_id uuid references observations(id),
  primary key (mental_model_id, observation_id)
);
```

## 7. Permisos y privacidad (aunque sea single-user)

Aunque v1 es de un único usuario, el spec deja el diseño listo para generalizar (parte de lo que hace interesante este proyecto para portfolio):

- Cada `RawEvent` guarda `source_authority` — el equivalente simplificado del "per-fact permissioning" que describe el artículo. En una versión multi-usuario, este campo se ampliaría a una lista de `allowed_scopes`.
- Ningún secreto (tokens, credenciales) se ingesta nunca como texto plano — hay un filtro de sanitización en `ingestion/` antes de persistir cualquier `RawEvent` (regex básico para patrones de token conocidos + rechazo si se detecta alto entropy string sospechoso). **Esto sí se construye en v1** — es parte de ingestion, no de consolidación.
- Borrado: un endpoint `DELETE /v1/raw-events/:id` (v1) permite borrar un evento ingestado por error. El `DELETE /v1/observations/:entity` del diseño original (borrar todo el contexto de una entidad) depende de que existan `Observation`s con `entity` — queda documentado junto a la consolidación (§4.2), fuera de alcance.

## 8. Trabajo futuro (fuera de este proyecto, documentado para no perder la idea)

- **Consolidación completa** (§4.2): extracción de observations, reconciliación de contradicciones, mental models. La pieza principal de trabajo futuro — el Operador la retomará por su cuenta.
- **Retrieval por entidad, temporal y por grafo** (§4.3): depende de la consolidación anterior.
- **Active knowledge hunting** (inspirado en gurusup): si Brain detecta un hueco recurrente (la misma pregunta sin respuesta más de N veces), podría generarme una notificación tipo "oye, esto no lo tengo documentado, ¿me lo explicas?" — capturando la respuesta como nueva observation. Tiene sentido en un contexto personal como recordatorio, no como "contactar a otra persona".
- **Grafo de entidades real** (Neo4j o similar) si el traversal por SQL se queda corto — solo relevante una vez exista el modelo de entidades de la consolidación.
- **Multi-tenancy real** con permisos por scope si el proyecto se reutiliza para un cliente.

## 9. Stack técnico

- TypeScript + Node.js.
- Postgres + `pgvector` para embeddings y datos estructurados en el mismo motor (evita operar dos bases de datos distintas para un proyecto personal).
- Hugging Face Inference API (`BAAI/bge-m3` por defecto) para embeddings — decisión explícita del Operador (Fase 4), ver §11. La abstracción `EmbeddingProvider` (`apps/brain/src/embeddings.ts`) no ata el resto del código a este proveedor concreto. En v1 no hace falta un LLM de extracción/consolidación (eso es §4.2, fuera de alcance).
- Node.js `http` nativo (sin Fastify/Express) para la API HTTP — decisión tomada en Fase 4 para seguir la misma convención que `apps/claude-code-runner-mcp` (cero dependencias de framework, zod para validación) en vez de introducir una segunda forma de montar un servidor HTTP en el monorepo.

## 10. Métricas de éxito (v1 — adaptadas del paso 5 del artículo, a escala personal)

- **Tasa de preguntas repetidas**: ¿cuántas veces le pregunto a Brain (o Hermes necesita) algo que ya debería saber? Debería bajar con el tiempo, incluso con retrieval simple.
- **Utilidad percibida en Hermes**: de las ejecuciones de Hermes que consultaron a Brain, ¿en cuántas el contexto devuelto (fragmentos por similitud) fue relevante? (juicio manual/log revisado a mano en v1, no hace falta automatizarlo).
- Tasa de reconciliación — no aplica en v1, depende de la consolidación fuera de alcance. Métrica a retomar si el Operador construye esa capa más adelante.

## 11. Preguntas abiertas

- ¿Notion/Obsidian export como fuente principal de notas, o directamente un vault de Obsidian sincronizado por filesystem? Afecta al conector de ingestion de la Fase 4.
- ~~¿Qué proveedor de embeddings se usa por defecto?~~ **Resuelto (Fase 4)**: Hugging Face Inference API, modelo `BAAI/bge-m3` por defecto (multilingüe — incluye español, fuerte en retrieval según MTEB, hasta 8192 tokens de contexto), 1024 dimensiones. Decisión explícita del Operador (no el proveedor "mismo que Claude Code" que sugería originalmente esta pregunta — Anthropic no ofrece una API de embeddings propia). Configurable vía `HUGGINGFACE_API_KEY`/`BRAIN_EMBEDDING_MODEL`/`BRAIN_EMBEDDING_DIMENSIONS` — ver `apps/brain/src/embeddings.ts`. El esquema de `raw_events.embedding` (§6) usa `vector(1024)`, no `vector(1536)` como en un borrador anterior de este documento (ese número asumía OpenAI `text-embedding-3-small`, no usado aquí).
