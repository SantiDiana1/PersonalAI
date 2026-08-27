/**
 * Rastro de cambios de modelo (US-15.4) — "cada cambio deja rastro con
 * timestamp, visible por /proveedores o un comando equivalente".
 *
 * Vive en el mismo Postgres que ya usa `/metricas`, esquema propio
 * (`control_bot`) para no mezclarse con `runner`/`brain`. Mismo patrón de
 * `create schema/table if not exists` que `apps/claude-code-runner-mcp/src/db.ts`.
 */
import type { Queryable } from '@personalai/shared';

const MIGRATION_SQL = `
create schema if not exists control_bot;

create table if not exists control_bot.model_changes (
  id uuid primary key default gen_random_uuid(),
  alias text not null,
  provider text not null,
  model text not null,
  changed_at timestamptz not null default now()
);
`;

export async function migrateModelAudit(db: Queryable): Promise<void> {
  await db.query(MIGRATION_SQL);
}

export async function recordModelChange(
  db: Queryable,
  choice: { alias: string; provider: string; model: string },
): Promise<void> {
  await db.query(
    `insert into control_bot.model_changes (alias, provider, model) values ($1, $2, $3)`,
    [choice.alias, choice.provider, choice.model],
  );
}

export interface ModelChangeRecord {
  alias: string;
  provider: string;
  model: string;
  changedAt: Date;
}

/** El cambio más reciente, o `null` si nunca se ha cambiado nada todavía. */
export async function lastModelChange(db: Queryable): Promise<ModelChangeRecord | null> {
  const res = await db.query<{ alias: string; provider: string; model: string; changed_at: Date }>(
    `select alias, provider, model, changed_at from control_bot.model_changes
     order by changed_at desc limit 1`,
  );
  const row = res.rows[0];
  if (!row) return null;
  return { alias: row.alias, provider: row.provider, model: row.model, changedAt: row.changed_at };
}
