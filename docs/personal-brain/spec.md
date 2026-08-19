# Spec — Personal Brain

## 1. Resumen

Personal Brain es una implementación **personal** (single-user) del patrón "company brain" descrito en:

- [How to Build a Company Brain for AI Agents](https://vectorize.io/articles/how-to-build-company-brain) (vectorize.io) — el marco de las 4 propiedades y las 4 capas que sigue este spec.
- [Company Brain](https://gurusup.com/es/brain) (gurusup.com) — la idea de que el conocimiento no escrito también debe poder capturarse (en nuestra v1, esto se simplifica: no hay "active knowledge hunting" contactando a personas, ver sección 8).

La distinción que hace el propio artículo de vectorize es clave para justificar este proyecto: un **"company brain"** tiene alcance organizacional (múltiples personas, permisos por usuario); un **"second brain"** tiene alcance personal (un único usuario, su propio contexto). Este proyecto construye un **second brain con la arquitectura de un company brain** — mismo diseño de 4 capas, mismo modelo de datos pensado para permisos, pero aplicado a mi propio contexto (proyectos, decisiones técnicas, notas). Esto es intencional: demuestra que sé construir el patrón completo, con una superficie de datos manejable para un proyecto personal.

## 2. Objetivos

- Ser la memoria persistente y consultable que evita que yo (o un agente como Hermes) tengamos que re-derivar contexto que ya existe en algún sitio (una decisión de arquitectura tomada hace 3 meses, una convención de un repo, el motivo de un bug ya resuelto).
- Cumplir, a escala personal, las **4 propiedades** de un company brain real:
  1. **Shared** — una única fuente de verdad que consultan tanto yo como cualquier agente (Hermes u otros futuros).
  2. **Enforceable** — Hermes (y cualquier futuro agente) está obligado a consultar a Brain antes de actuar; no hay una ruta alternativa "más rápida" que la esquive.
  3. **Evolving** — se actualiza sola a partir de señales reales (resultado de PRs, notas nuevas), no requiere mantenimiento manual tipo wiki.
  4. **Agent-readable** — API estructurada, no solo texto para humanos.
- Implementar de verdad la capa de **consolidación** (extracción de observations + reconciliación de contradicciones + mental models) — es la capa que, según el artículo, diferencia un company brain real de "un vector store con extra pasos". Es la parte que más quiero poder enseñar en el portfolio.

## 3. No-objetivos (v1)

- No es multi-tenant ni tiene permisos por usuario reales — es de un único usuario (yo). El modelo de datos sí incluye un campo de `visibility`/`source_authority` pensado para eso, pero no se construye la lógica de autorización completa.
- No implementa "active knowledge hunting" (contactar a alguien por WhatsApp/email cuando falta un dato, como propone gurusup) — es una idea interesante pero pensada para un contexto de equipo, no para un usuario único. Queda documentada como trabajo futuro (sección 8).
- No sustituye a mis herramientas de notas existentes (Notion, Obsidian, lo que use) — las **ingesta**, no las reemplaza.
- No hace fine-tuning ni entrena modelos propios — usa un LLM comercial (vía API) para extracción/consolidación y embeddings.

## 4. Las 4 capas

### 4.1 Ingestion (`src/ingestion/`)

Fuentes soportadas, por prioridad:

1. **Notas personales** (Markdown — de un vault de Obsidian/Notion export, o archivos sueltos) — vía import manual/CLI en Fase 1, vía sync automático en fases posteriores.
2. **GitHub** — descripciones de PR, comentarios de review y commits de mis propios repos (fuente canónica para "por qué se hizo X en el código").
3. **Notion / Jira** — páginas/tickets marcados como fuente de contexto (no todas las tareas, solo documentos de referencia: decisiones, runbooks).
4. **Resultados de Hermes** — cada llamada a `brain_record_observation` (vía `brain-mcp`, ver sección 5.2) que hermes-agent hace tras ejecutar una tarea es, en sí mismo, una fuente de ingestion (la más valiosa, porque es feedback directo de una acción real).

Filtro de canonicidad (tomado del artículo): cada fuente se etiqueta con una `source_authority` (`canonical` | `supporting`). Un PR description es `canonical`; una nota rápida sin revisar es `supporting`. La consolidación pesa más las fuentes canónicas al reconciliar contradicciones.

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

### 4.2 Consolidation (`src/consolidation/`)

La capa más importante del spec — tres trabajos, tal cual el artículo de referencia:

1. **Extracción de observations**: un LLM procesa cada `RawEvent` y extrae hechos estructurados (`Observation`), no una copia del texto. P. ej.: un PR titulado "Switch deploy region to eu-west-1" se convierte en `"A partir de [fecha], los despliegues de <repo> usan la región eu-west-1"`.
2. **Reconciliación**: al crear una `Observation` nueva, se busca si contradice una `Observation` existente (misma entidad/tema). Si hay conflicto, se aplica una política de reconciliación:
   - **Recency-weighted** (política por defecto v1): gana la observation más reciente.
   - **Source-authority-weighted**: una fuente `canonical` gana sobre una `supporting` aunque sea más antigua (override explícito, configurable por tipo de hecho).
   - La observation "perdedora" no se borra — se marca `superseded_by` para mantener trazabilidad (auditable, como pide el patrón de consolidación).
3. **Mental models**: un job periódico agrupa observations relacionadas (mismo tema/entidad, ej. "cómo despliega el repo X") en un `MentalModel` — resumen sintetizado que se convierte en la unidad de retrieval preferente antes que devolver observations sueltas.

```ts
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

### 4.3 Retrieval (`src/retrieval/`)

Multi-estrategia (single-strategy pierde queries que las otras sí capturan, según el artículo):

- **Semántica**: embeddings sobre `statement` de cada `Observation`/`MentalModel` (pgvector, similarity search).
- **Por entidad**: si la query menciona un repo/proyecto concreto (`repo:personalAI`), filtra directo por ese `entity`.
- **Temporal**: soporte para "¿cuál es la convención _actual_?" (excluye observations `superseded_by`) vs "¿qué se decidió en su momento?" (histórico, incluye todas).
- **Grafo** (v2, no bloqueante para v1): traversal simple sobre relaciones `entity -> entity` cuando la pregunta requiere saltar de una entidad a otra relacionada.

Resultado combinado con un re-ranking simple (score de similarity + boost si hay match de entidad + penalización si la observation está superseded).

### 4.4 Action (`src/api` + `brain-mcp` + consumidores)

Brain no actúa por sí mismo — expone la capa de retrieval y recibe feedback. Brain en sí habla HTTP/REST (`apps/brain/src/api`); el consumidor real, [hermes-agent](https://github.com/NousResearch/hermes-agent) (ver [hermes/spec.md](../hermes/spec.md)), no le habla directamente — pasa por **`apps/brain-mcp`**, un servidor MCP fino que traduce tools MCP a llamadas a esta API. Esto es intencional: hermes-agent (y cualquier otro cliente MCP futuro — Claude Desktop, Cursor, etc.) obtiene a Brain como una integración MCP estándar, sin acoplarse a los detalles HTTP internos.

## 5. API

### 5.1 API interna (HTTP/REST, `apps/brain/src/api`)

Base: `POST /v1/*`, JSON, autenticado con un token estático simple (Bearer) — solo la llama `brain-mcp` (mismo host/red interna del VPS), no hace falta OAuth para v1.

### `POST /v1/query`

Request:

```json
{
  "question": "¿cuál es la convención de nombres de branches en personalAI?",
  "entity": "repo:personalAI",
  "temporal": "current"
}
```

Response:

```json
{
  "mentalModels": [{ "id": "...", "summary": "...", "entity": "repo:personalAI" }],
  "observations": [{ "id": "...", "statement": "...", "validFrom": "..." }]
}
```

### `POST /v1/ingest`

Ingesta manual/automática de un `RawEvent` (ver 4.1). Dispara consolidación de forma asíncrona (no bloquea la respuesta).

### `POST /v1/observations`

Feedback directo de un agente tras actuar — se trata como un `RawEvent` de tipo `hermes_feedback` y entra por el mismo pipeline de consolidación.

### 5.2 API vía MCP (`apps/brain-mcp`, lo que realmente consume Hermes)

`brain-mcp` expone tres tools MCP, cada una un wrapper delgado sobre el endpoint REST equivalente:

```ts
// tool: brain_query — envuelve POST /v1/query
interface BrainQueryInput {
  question: string;
  entity?: string;
  temporal?: 'current' | 'historical';
}
interface BrainQueryOutput {
  mentalModels: Array<{ id: string; summary: string; entity: string }>;
  observations: Array<{ id: string; statement: string; validFrom: string }>;
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
  entity: string;
  text: string; // resultado de la acción del agente, en lenguaje natural
  externalRef?: string; // p.ej. URL del PR
}
```

Este es el contrato que se registra en la configuración de hermes-agent (`hermes mcp add brain-mcp ...`) y el que usa el Skill `resolve-issue` (ver [hermes/spec.md](../hermes/spec.md#5-el-skill-resolve-issue)). Si `brain-mcp` no responde, debe fallar de forma segura: hermes-agent debe poder seguir con la tarea sin contexto (el Skill lo trata como "no context available", nunca como bloqueante).

## 6. Modelo de datos (Postgres, esquema `brain`)

```sql
create extension if not exists vector;

create table raw_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_authority text not null check (source_authority in ('canonical','supporting')),
  external_ref text,
  text text not null,
  occurred_at timestamptz not null,
  ingested_at timestamptz not null default now()
);

create table observations (
  id uuid primary key default gen_random_uuid(),
  statement text not null,
  entity text not null,
  source_event_id uuid references raw_events(id),
  source_authority text not null,
  valid_from timestamptz not null,
  superseded_by uuid references observations(id),
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create table mental_models (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  summary text not null,
  embedding vector(1536),
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

- Cada `Observation` guarda `source_authority` — el equivalente simplificado del "per-fact permissioning" que describe el artículo. En una versión multi-usuario, este campo se ampliaría a una lista de `allowed_scopes`.
- Ningún secreto (tokens, credenciales) se ingesta nunca como texto plano — hay un filtro de sanitización en `ingestion/` antes de persistir cualquier `RawEvent` (regex básico para patrones de token conocidos + rechazo si se detecta alto entropy string sospechoso).
- Borrado: un endpoint `DELETE /v1/observations/:entity` permite borrar todo el contexto de una entidad (equivalente personal al "right to be forgotten" del artículo) — útil si ingesto algo por error o quiero limpiar contexto obsoleto.

## 8. Trabajo futuro (fuera de v1, documentado para no perder la idea)

- **Active knowledge hunting** (inspirado en gurusup): si Brain detecta un hueco recurrente (la misma pregunta sin respuesta más de N veces), podría generarme una notificación tipo "oye, esto no lo tengo documentado, ¿me lo explicas?" — capturando la respuesta como nueva observation. Tiene sentido en un contexto personal como recordatorio, no como "contactar a otra persona".
- **Grafo de entidades real** (Neo4j o similar) si el traversal por SQL se queda corto.
- **Multi-tenancy real** con permisos por scope si el proyecto se reutiliza para un cliente.

## 9. Stack técnico

- TypeScript + Node.js.
- Postgres + `pgvector` para embeddings y datos estructurados en el mismo motor (evita operar dos bases de datos distintas para un proyecto personal).
- Un proveedor de embeddings + LLM vía API (OpenAI o Anthropic) para extracción de observations y consolidación — configurable, no atado a un único proveedor.
- Fastify o Express para la API HTTP.

## 10. Métricas de éxito (adaptadas del paso 5 del artículo, a escala personal)

- **Tasa de preguntas repetidas**: ¿cuántas veces le pregunto a Brain (o Hermes necesita) algo que ya debería saber? Debería bajar con el tiempo.
- **Tasa de reconciliación**: cuántas observations nuevas contradicen una existente — señal de que el sistema encuentra contradicciones reales, no solo acumula.
- **Utilidad percibida en Hermes**: de las ejecuciones de Hermes que consultaron a Brain, ¿en cuántas el contexto devuelto fue relevante? (juicio manual/log revisado a mano en v1, no hace falta automatizarlo).

## 11. Preguntas abiertas

- ¿Notion/Obsidian export como fuente principal de notas, o directamente un vault de Obsidian sincronizado por filesystem? Afecta al conector de ingestion de la Fase 1.
- ¿Qué proveedor de embeddings/LLM se usa por defecto? Recomendado: mismo proveedor que usa Claude Code para minimizar el número de credenciales a gestionar en el VPS.
