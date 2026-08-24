import pg from 'pg';
import type { QueryFragment, RawEvent, RawEventSource, SourceAuthority } from '@personalai/shared';
import { logger } from './logger.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

/** Devuelve el pool compartido, o `null` si `DATABASE_URL` no está configurada. */
export function getPool(): pg.Pool | null {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    return null;
  }
  pool ??= new Pool({ connectionString });
  return pool;
}

/** Solo para tests: fuerza a que la siguiente `getPool()` recree el pool. */
export function resetPoolForTests(): void {
  pool = null;
}

/**
 * Esquema `brain`, tabla `raw_events` — ver docs/personal-brain/spec.md §6.
 * `dimensions` debe coincidir con `EmbeddingProvider.dimensions` (por
 * defecto 1024, bge-m3) — cambiar de modelo de embeddings con datos ya
 * ingestados requiere re-ingestar todo, la dimensión del vector es fija por
 * columna en Postgres.
 */
function migrationSql(dimensions: number): string {
  return `
create extension if not exists vector;
create schema if not exists brain;

create table if not exists brain.raw_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_authority text not null check (source_authority in ('canonical','supporting')),
  external_ref text,
  text text not null,
  embedding vector(${dimensions}),
  occurred_at timestamptz not null,
  ingested_at timestamptz not null default now()
);

create index if not exists raw_events_embedding_idx
  on brain.raw_events using hnsw (embedding vector_cosine_ops);
`;
}

export async function migrate(dimensions: number): Promise<void> {
  const p = getPool();
  if (!p) {
    logger.warn('DATABASE_URL no configurada — Brain no arranca sin persistencia');
    throw new Error('DATABASE_URL no configurada');
  }
  await p.query(migrationSql(dimensions));
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

interface RawEventRow {
  id: string;
  source: RawEventSource;
  source_authority: SourceAuthority;
  external_ref: string | null;
  text: string;
  occurred_at: Date;
  ingested_at: Date;
}

function rowToRawEvent(row: RawEventRow): RawEvent {
  const event: RawEvent = {
    id: row.id,
    source: row.source,
    sourceAuthority: row.source_authority,
    text: row.text,
    occurredAt: row.occurred_at.toISOString(),
    ingestedAt: row.ingested_at.toISOString(),
  };
  if (row.external_ref) {
    event.externalRef = row.external_ref;
  }
  return event;
}

export interface InsertRawEventParams {
  source: RawEventSource;
  sourceAuthority: SourceAuthority;
  text: string;
  externalRef?: string;
  occurredAt: Date;
  /**
   * Opcional a propósito (docs/personal-brain/spec.md §5.1: "Genera su
   * embedding de forma asíncrona (no bloquea la respuesta)"): el endpoint
   * de ingesta inserta la fila sin embedding y responde de inmediato; el
   * embedding se calcula después y se persiste con `updateEmbedding`.
   */
  embedding?: number[];
}

export async function insertRawEvent(params: InsertRawEventParams): Promise<RawEvent> {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL no configurada');

  const res = await p.query<RawEventRow>(
    `insert into brain.raw_events (source, source_authority, external_ref, text, embedding, occurred_at)
     values ($1, $2, $3, $4, $5::vector, $6)
     returning id, source, source_authority, external_ref, text, occurred_at, ingested_at`,
    [
      params.source,
      params.sourceAuthority,
      params.externalRef ?? null,
      params.text,
      params.embedding ? toVectorLiteral(params.embedding) : null,
      params.occurredAt,
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Error('insert de raw_events no devolvió fila');
  return rowToRawEvent(row);
}

/** Persiste el embedding calculado de forma asíncrona tras el `insertRawEvent` inicial. */
export async function updateEmbedding(id: string, embedding: number[]): Promise<void> {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL no configurada');
  await p.query('update brain.raw_events set embedding = $2::vector where id = $1', [
    id,
    toVectorLiteral(embedding),
  ]);
}

interface QueryRow extends RawEventRow {
  distance: number;
}

/**
 * Similarity search puro (docs/personal-brain/spec.md §4.3) — sin
 * re-ranking por entidad ni penalización por "superseded": esos conceptos
 * dependen de la consolidación, fuera de alcance de v1.
 *
 * `score` = 1 - distancia coseno (pgvector `<=>`), en [0, 1] para vectores
 * normalizados (bge-m3 los normaliza) — 1 = idéntico.
 */
export async function querySimilar(embedding: number[], k: number): Promise<QueryFragment[]> {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL no configurada');

  const res = await p.query<QueryRow>(
    `select id, source, source_authority, external_ref, text, occurred_at, ingested_at,
            embedding <=> $1::vector as distance
     from brain.raw_events
     where embedding is not null
     order by embedding <=> $1::vector asc
     limit $2`,
    [toVectorLiteral(embedding), k],
  );

  return res.rows.map((row) => ({
    id: row.id,
    text: row.text,
    score: 1 - row.distance,
    source: row.source,
    sourceAuthority: row.source_authority,
    occurredAt: row.occurred_at.toISOString(),
  }));
}

/** `DELETE /v1/raw-events/:id` (docs/personal-brain/spec.md §7). Devuelve `true` si borró algo. */
export async function deleteRawEvent(id: string): Promise<boolean> {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL no configurada');
  const res = await p.query('delete from brain.raw_events where id = $1', [id]);
  return (res.rowCount ?? 0) > 0;
}
