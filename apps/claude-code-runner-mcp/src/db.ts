import pg from 'pg';
import { logger } from './logger.js';
import type { RunCodingTaskOutput, TaskRunStatus } from './types.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

/** Esquema `runner`, tabla `task_runs` — ver docs/hermes/spec.md §7. */
const MIGRATION_SQL = `
create schema if not exists runner;

create table if not exists runner.task_runs (
  id uuid primary key default gen_random_uuid(),
  repo text not null,
  task_title text not null,
  status text not null default 'running',
  brain_context jsonb,
  result jsonb,
  branch_name text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
`;

/** Devuelve el pool compartido, o `null` si `DATABASE_URL` no está configurada (modo sin persistencia, solo para pruebas manuales). */
export function getPool(): pg.Pool | null {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    return null;
  }
  pool ??= new Pool({ connectionString });
  return pool;
}

export async function migrate(): Promise<void> {
  const p = getPool();
  if (!p) {
    logger.warn('DATABASE_URL no configurada — task_runs no se persistirá');
    return;
  }
  await p.query(MIGRATION_SQL);
}

export async function insertTaskRun(params: {
  repo: string;
  taskTitle: string;
  brainContext?: string;
}): Promise<string | null> {
  const p = getPool();
  if (!p) return null;
  const res = await p.query<{ id: string }>(
    `insert into runner.task_runs (repo, task_title, status, brain_context) values ($1, $2, 'running', $3) returning id`,
    [params.repo, params.taskTitle, params.brainContext ?? null],
  );
  return res.rows[0]?.id ?? null;
}

export async function finishTaskRun(
  id: string | null,
  status: TaskRunStatus,
  result: RunCodingTaskOutput,
): Promise<void> {
  const p = getPool();
  if (!p || !id) return;
  await p.query(
    `update runner.task_runs set status = $2, result = $3, branch_name = $4, finished_at = now() where id = $1`,
    [id, status, JSON.stringify(result), result.branchName ?? null],
  );
}
