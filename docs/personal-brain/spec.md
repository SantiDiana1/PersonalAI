# Spec — Personal Brain

## 0. Scope of this project — read this first

> **Scope decision (Phase 0 / just after Phase 0)**: in this project, Brain is deliberately built **basic**: event ingestion + semantic similarity search, nothing more. The **consolidation** layer (LLM-based observation extraction, contradiction reconciliation, mental models — section 4.2) is the piece that would genuinely turn this into a real "company brain", and it is **designed in this document but not built in this project**. It is future work **that now has a place assigned**: [Milestone v4, Phase 11](../roadmap.md#milestone-v4--company-brain) — deliberately the project's last block, following the rule of not opening the biggest piece until the base beneath it is closed. (Until 2026-08-28 this note said "outside the roadmap"; that stopped being true once v4 was planned.)
>
> Why: the goal of this project is to demonstrate the Hermes ↔ MCP ↔ Brain pattern well with a Brain that is simple but real (not an empty stub), not to build the full consolidation system in the background — the Operator prefers to design and build that himself later, unhurried. The rest of this spec still describes the complete "company brain" vision (useful as a design reference for that future work), but each section states explicitly which part is built here and which is not.

## 1. Summary

Personal Brain is a **personal** (single-user) implementation of the "company brain" pattern described in:

- [How to Build a Company Brain for AI Agents](https://vectorize.io/articles/how-to-build-company-brain) (vectorize.io) — the framework of 4 properties and 4 layers this spec follows.
- [Company Brain](https://gurusup.com/es/brain) (gurusup.com) — the idea that unwritten knowledge should also be capturable (in our v1 this is simplified: there is no "active knowledge hunting" contacting people, see section 8).

The distinction the vectorize article itself draws is key to justifying this project: a **"company brain"** has organisational scope (multiple people, per-user permissions); a **"second brain"** has personal scope (a single user, their own context). This project documents a **second brain with a company brain's architecture** — same 4-layer design, same data model designed with permissions in mind — but **only 2 of the 4 layers are built here** (ingestion and a minimal retrieval); consolidation and the "evolving" part of action are documented for later (see §0).

## 2. Objectives

- Be the persistent, queryable memory that keeps me (or an agent like Hermes) from having to re-derive context that already exists somewhere (an architecture decision made 3 months ago, a repo convention, the reason behind an already-fixed bug) — **in v1, at the level of "here is a related fragment of text", not a structured, reconciled fact**.
- Serve as a first step towards, at personal scale, the **4 properties** of a real company brain (actual state in this project, not aspirational):
  1. **Shared** — ✅ built: a single source of truth (Brain) consulted both by me and by any agent (Hermes or future others).
  2. **Enforceable** — ✅ built: Hermes (Phase 5) is required to consult Brain before acting, via the `resolve-issue` Skill, on both the GitHub and Telegram paths.
  3. **Evolving** — ⚠️ partial: Brain receives real feedback from Hermes (`hermes_feedback`) and grows with use, but **does not reconcile or synthesise** that feedback — that is the out-of-scope consolidation part (§4.2). It updates itself in the sense of "accumulates", not in the sense of "learns and summarises".
  4. **Agent-readable** — ✅ built: a structured API (HTTP + MCP), not just text for humans.
- Genuinely document the **consolidation** layer (observation extraction + contradiction reconciliation + mental models) as a design reference — it is the layer that, according to the article, separates a real company brain from "a vector store with extra steps". **Not implemented in this project** (see §0); it is ready for whenever the Operator wants to build it.

## 3. Non-objectives (v1 — this project)

- **The consolidation layer is not built in this project** (LLM observation extraction, contradiction reconciliation, mental models — §4.2). Future work for the Operator, documented as a reference.
- Not multi-tenant and has no real per-user permissions — it is single-user (me). The data model does include a `visibility`/`source_authority` field designed with that in mind, but the full authorisation logic is not built.
- Does not implement "active knowledge hunting" (contacting someone over WhatsApp/email when a fact is missing, as gurusup proposes) — an interesting idea, but designed for a team context, not a single user. Documented as future work (section 8).
- Does not replace my existing note-taking tools (Notion, Obsidian, whatever I use) — it **ingests** them, it does not replace them.
- Does no fine-tuning and trains no models of its own — it uses a commercial embeddings provider (via API) for similarity search.
- Entity, temporal and graph retrieval (§4.3) **are not built** in v1 — they depend on `Observation`s existing with an assigned `entity`, which in turn depends on consolidation (out of scope). v1 is purely similarity search over the raw ingested text.

## 4. The layers — what is built and what is not

### 4.1 Ingestion (`src/ingestion/`) — ✅ built in this project (Phase 4)

Supported sources, by priority:

1. **Personal notes** (Markdown — from an Obsidian vault / Notion export, or loose files) — via manual/CLI import in Phase 4, via automatic sync as future work.
2. **GitHub** — PR descriptions, review comments and commits from my own repos (the canonical source for "why X was done in the code").
3. **Notion / Jira** — pages/tickets marked as context sources (not every task, only reference documents: decisions, runbooks) — Phase 7 of v2 (post-v1, see `docs/decisions-log.md`).
4. **Hermes results** — every `brain_record_observation` call (via `brain-mcp`, see section 5.2) that hermes-agent makes after executing a task (from GitHub or Telegram) is itself an ingestion source (the most valuable one, because it is direct feedback from a real action) — Phase 5. In v1 this is persisted verbatim as a `RawEvent` (`source: 'hermes_feedback'`), with no LLM extraction.

Canonicity filter (taken from the article, and it is built): each source is tagged with a `source_authority` (`canonical` | `supporting`). A PR description is `canonical`; a quick unreviewed note is `supporting`. In v1 this field is persisted and can be used to sort/filter results, but there is no reconciliation logic actively using it (that is consolidation, out of scope).

Every ingestion event is normalised into a `RawEvent`:

```ts
interface RawEvent {
  id: string;
  source: 'notes' | 'github' | 'notion' | 'jira' | 'hermes_feedback';
  sourceAuthority: 'canonical' | 'supporting';
  externalRef?: string; // url, PR id, etc.
  text: string;
  occurredAt: string; // date of the real event, not of the ingestion
  ingestedAt: string;
}
```

This is the **only** "content" data model built in v1, together with its embedding (see §6).

### 4.2 Consolidation — OUT OF SCOPE FOR THIS PROJECT (design reference only)

> Nothing in this section is built yet. It is the content of [Milestone v4, Phase 11](../roadmap.md#milestone-v4--company-brain), the project's last planned block: until that opens, `apps/brain/src/consolidation` does not exist and this section is a design reference, not a description of something that runs.

The layer that, according to the reference article, separates a real company brain from "a vector store with extra steps" — three jobs:

1. **Observation extraction**: an LLM processes each `RawEvent` and extracts structured facts (`Observation`), not a copy of the text. E.g.: a PR titled "Switch deploy region to eu-west-1" becomes `"As of [date], deployments of <repo> use region eu-west-1"`.
2. **Reconciliation**: when a new `Observation` is created, it is checked against existing ones (same entity/topic) for contradiction. On conflict, a reconciliation policy applies:
   - **Recency-weighted** (default policy, if implemented): the most recent observation wins.
   - **Source-authority-weighted**: a `canonical` source beats a `supporting` one even if older (explicit override, configurable per fact type).
   - The "losing" observation would not be deleted — it would be marked `superseded_by` to preserve traceability (auditable, as the consolidation pattern requires).
3. **Mental models**: a periodic job would group related observations (same topic/entity, e.g. "how repo X deploys") into a `MentalModel` — a synthesised summary that would become the preferred retrieval unit, ahead of returning loose observations.

```ts
// Design reference — not implemented in this project.
interface Observation {
  id: string;
  statement: string; // the extracted fact, in structured natural language
  entity: string; // e.g. "repo:personalAI", "topic:deploy"
  sourceEventId: string;
  sourceAuthority: 'canonical' | 'supporting';
  validFrom: string;
  supersededBy?: string; // if it was reconciled away by another observation
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

### 4.3 Retrieval (`src/retrieval/`) — partial: only semantic search is built here (Phase 4)

The reference article recommends multi-strategy retrieval (single-strategy misses queries the others would catch). In this project:

- **Semantic** — ✅ built: embeddings over each `RawEvent`'s `text` (pgvector, similarity search). The only retrieval strategy in v1.
- **By entity** — out of scope: filtering directly by `entity` (`repo:personalAI`) requires `Observation`s to exist with that field assigned — depends on consolidation (§4.2).
- **Temporal** — out of scope: "what is the _current_ convention?" vs "what was decided at the time?" requires `Observation`'s `supersededBy` field — depends on consolidation.
- **Graph** — out of scope (it already was in the original design, non-blocking for v2): simple traversal over `entity -> entity` relations.

In v1, the result of `POST /v1/query` is simply the `k` most similar `RawEvent`s by embedding, with their score — no entity re-ranking and no superseded penalty (not applicable, that concept does not exist in v1).

### 4.4 Action (`src/api` + `brain-mcp` + consumers) — ✅ built in this project (Phase 4/5)

Brain does not act by itself — it exposes the retrieval layer and receives feedback. Brain itself speaks HTTP/REST (`apps/brain/src/api`); the real consumer, [hermes-agent](https://github.com/NousResearch/hermes-agent) (see [hermes/spec.md](../hermes/spec.md)), does not talk to it directly — it goes through **`apps/brain-mcp`**, a thin MCP server translating MCP tools into calls to this API. This is intentional: hermes-agent (and any future MCP client — Claude Desktop, Cursor, etc.) gets Brain as a standard MCP integration, without coupling to the internal HTTP details.

The "evolving" property of action is only partially satisfied in v1: Brain **accumulates** real feedback from Hermes (via `brain_record_observation` → a `hermes_feedback` `RawEvent`), but neither synthesises nor reconciles it — that would require consolidation (§4.2).

## 5. API

### 5.1 Internal API (HTTP/REST, `apps/brain/src/api`)

Base: `POST /v1/*`, JSON, authenticated with a simple static token (Bearer) — only `brain-mcp` calls it (same host / internal network of the local server), so OAuth is unnecessary for v1.

### `POST /v1/query`

Request:

```json
{
  "question": "what is the branch naming convention in personalAI?",
  "k": 5
}
```

Response (v1 — similarity fragments only, no observations/mentalModels):

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

> Forward-compatibility note: if the Operator picks consolidation up later (§4.2), this endpoint can be extended to also return `mentalModels`/`observations` without breaking the current contract (add fields, do not remove `fragments`).

### `POST /v1/ingest`

Manual/automatic ingestion of a `RawEvent` (see 4.1). Generates its embedding asynchronously (does not block the response). It triggers **no** consolidation (there is none in v1).

### `POST /v1/observations`

Direct feedback from an agent after acting — treated as a `hermes_feedback` `RawEvent` and persisted with its embedding, like any other `RawEvent`. The endpoint name is kept (for the semantic clarity of the contract with Hermes — "this is an action result, not a note"), even though in v1 there is no real `Observation` behind it.

### 5.2 The MCP API (`apps/brain-mcp`, what Hermes actually consumes)

`brain-mcp` exposes three MCP tools, each a thin wrapper over the equivalent REST endpoint:

```ts
// tool: brain_query — wraps POST /v1/query
interface BrainQueryInput {
  question: string;
  k?: number; // defaults to a sensible value, e.g. 5
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

// tool: brain_ingest — wraps POST /v1/ingest
interface BrainIngestInput {
  source: RawEvent['source'];
  sourceAuthority: 'canonical' | 'supporting';
  text: string;
  externalRef?: string;
}

// tool: brain_record_observation — wraps POST /v1/observations
interface BrainRecordObservationInput {
  text: string; // the result of the agent's action, in natural language
  externalRef?: string; // e.g. the PR URL
}
```

This is the contract registered in hermes-agent's configuration (`hermes mcp add brain-mcp ...`) and used by the `resolve-issue` Skill (see [hermes/spec.md](../hermes/spec.md#5-el-skill-resolve-issue)). If `brain-mcp` does not respond, it must fail safe: hermes-agent must be able to continue the task without context (the Skill treats it as "no context available", never as blocking).

## 6. Data model (Postgres, `brain` schema)

What **is created** in this project:

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

What is **not created** in this project (design reference for future consolidation, §4.2 — documented here so it is not lost, but not part of v1's migrations):

```sql
-- Design reference — NOT created in this project.
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

## 7. Permissions and privacy (even though it is single-user)

Although v1 is single-user, the spec leaves the design ready to generalise:

- Every `RawEvent` stores `source_authority` — the simplified equivalent of the "per-fact permissioning" the article describes. In a multi-user version, this field would be widened into a list of `allowed_scopes`.
- No secret (tokens, credentials) is ever ingested as plain text — there is a sanitisation filter in `ingestion/` before persisting any `RawEvent` (basic regex for known token patterns + rejection if a suspicious high-entropy string is detected). **This is built in v1** — it is part of ingestion, not consolidation.
- Deletion: a `DELETE /v1/raw-events/:id` endpoint (v1) allows removing an event ingested by mistake. The original design's `DELETE /v1/observations/:entity` (delete all context for an entity) depends on `Observation`s with an `entity` existing — documented alongside consolidation (§4.2), out of scope.

## 8. Future work (outside this project, documented so the idea is not lost)

- **Full consolidation** (§4.2): observation extraction, contradiction reconciliation, mental models. The main piece of future work — the Operator will pick it up himself.
- **Entity, temporal and graph retrieval** (§4.3): depends on the consolidation above.
- **Active knowledge hunting** (inspired by gurusup): if Brain detects a recurring gap (the same unanswered question more than N times), it could raise a notification along the lines of "hey, I have no record of this, can you explain it?" — capturing the answer as a new observation. This makes sense in a personal context as a reminder, not as "contact another person".
- **A real entity graph** (Neo4j or similar) if SQL traversal proves insufficient — only relevant once the consolidation entity model exists.
- **Real multi-tenancy** with per-scope permissions if the project is reused for a client.

## 9. Technical stack

- TypeScript + Node.js.
- Postgres + `pgvector` for embeddings and structured data in the same engine (avoids operating two different databases for a personal project).
- Hugging Face Inference API (`BAAI/bge-m3` by default) for embeddings — an explicit decision by the Operator (Phase 4), see §11. The `EmbeddingProvider` abstraction (`apps/brain/src/embeddings.ts`) keeps the rest of the code from being tied to this specific provider. In v1 no extraction/consolidation LLM is needed (that is §4.2, out of scope).
- Node.js native `http` (no Fastify/Express) for the HTTP API — decided in Phase 4 to follow the same convention as `apps/claude-code-runner-mcp` (zero framework dependencies, zod for validation) rather than introducing a second way of standing up an HTTP server in the monorepo.

## 10. Success metrics (v1 — adapted from step 5 of the article, at personal scale)

- **Repeat-question rate**: how often do I ask Brain (or does Hermes need) something it should already know? It should fall over time, even with simple retrieval.
- **Perceived usefulness in Hermes**: of the Hermes runs that consulted Brain, in how many was the returned context (similarity fragments) relevant? (manual judgement / logs reviewed by hand in v1; no need to automate it).
- Reconciliation rate — not applicable in v1, depends on the out-of-scope consolidation. A metric to revisit if the Operator builds that layer later.

## 11. Open questions

- Notion/Obsidian export as the primary note source, or a filesystem-synced Obsidian vault directly? Affects the Phase 4 ingestion connector.
- ~~Which embeddings provider is used by default?~~ **Resolved (Phase 4)**: Hugging Face Inference API, model `BAAI/bge-m3` by default (multilingual — Spanish included, strong at retrieval per MTEB, up to 8192 tokens of context), 1024 dimensions. An explicit decision by the Operator (not the "same provider as Claude Code" this question originally suggested — Anthropic offers no embeddings API of its own). Configurable via `HUGGINGFACE_API_KEY`/`BRAIN_EMBEDDING_MODEL`/`BRAIN_EMBEDDING_DIMENSIONS` — see `apps/brain/src/embeddings.ts`. The `raw_events.embedding` schema (§6) uses `vector(1024)`, not `vector(1536)` as in an earlier draft of this document (that number assumed OpenAI `text-embedding-3-small`, which is not used here).
