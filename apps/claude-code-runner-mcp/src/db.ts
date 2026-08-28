import pg from 'pg';
import { collectMetrics, type Metrics, type Queryable } from '@personalai/shared';
import { logger } from './logger.js';
import type {
  RunClaudeCommandOutput,
  RunCodingTaskOutput,
  TaskRunStatus,
  TaskRunSummary,
  TaskRunTool,
} from './types.js';

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

-- Añadida en la Fase 9 (US-9.2) sobre una tabla que ya tenía datos reales en
-- producción. El bloque condicional no es ceremonia: \`migrate()\` corre en
-- cada arranque del servidor, y el backfill debe ejecutarse UNA vez —
-- reclasificar en cada boot sería trabajo repetido y, peor, machacaría una
-- corrección manual del Operador sobre una fila mal clasificada.
--
-- El backfill es heurístico por necesidad: las filas históricas no guardan
-- qué tool las creó, y lo único que las distingue es que \`run_claude_command\`
-- construye su \`task_title\` como "<comando> <prompt>" (ver
-- runClaudeCommand.ts) con el comando salido de ALLOWED_SLASH_COMMANDS. Es
-- fiable para los datos existentes, pero es una inferencia sobre el pasado,
-- no un dato registrado — las filas nuevas sí lo llevan explícito.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'runner' and table_name = 'task_runs' and column_name = 'tool'
  ) then
    alter table runner.task_runs
      add column tool text not null default 'run_coding_task';

    update runner.task_runs
      set tool = 'run_claude_command'
      where task_title like '/design %' or task_title like '/dataviz %';
  end if;
end $$;
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
  tool: TaskRunTool;
  brainContext?: string;
}): Promise<string | null> {
  const p = getPool();
  if (!p) return null;
  // Bug real, encontrado en producción (Fase 6, anotado sin arreglar
  // entonces; ahora bloqueaba también run_claude_command — Fase 8):
  // brain_context es `jsonb`, pero brainContext es texto libre (un párrafo
  // devuelto por brain_query), no JSON válido por sí mismo. Pasarlo tal
  // cual hacía que Postgres rechazara el insert con "invalid input syntax
  // for type json" en cuanto brainContext traía comillas/acentos/etc. —
  // JSON.stringify lo envuelve como un string JSON válido (p.ej. "el color
  // es #7C3AED" -> "\"el color es #7C3AED\""), que sí encaja en `jsonb`.
  const brainContextJson =
    params.brainContext !== undefined ? JSON.stringify(params.brainContext) : null;
  const res = await p.query<{ id: string }>(
    `insert into runner.task_runs (repo, task_title, status, brain_context, tool) values ($1, $2, 'running', $3, $4) returning id`,
    [params.repo, params.taskTitle, brainContextJson, params.tool],
  );
  return res.rows[0]?.id ?? null;
}

export async function finishTaskRun(
  id: string | null,
  status: TaskRunStatus,
  result: RunCodingTaskOutput | RunClaudeCommandOutput,
): Promise<void> {
  const p = getPool();
  if (!p || !id) return;
  // branchName solo existe en el resultado de run_coding_task — para
  // run_claude_command (Fase 8) queda null, que es el valor por defecto que
  // ya soportaban tareas needs_human_input/failed sin rama de este mismo campo.
  const branchName = 'branchName' in result ? (result.branchName ?? null) : null;
  await p.query(
    `update runner.task_runs set status = $2, result = $3, branch_name = $4, finished_at = now() where id = $1`,
    [id, status, JSON.stringify(result), branchName],
  );
}

/**
 * Lectura para `get_runner_status` (US-6.3/US-6.4 de docs/decisions-log.md — Fase
 * 6). Devuelve `null` si no hay persistencia configurada, en vez de lanzar —
 * este tool es de solo lectura para un resumen operativo, no debe romper el
 * flujo de status-report/cron por un `DATABASE_URL` ausente en un despliegue
 * de pruebas.
 */
export async function getRunnerStatusSummary(): Promise<{
  tasksNeedingAttention: TaskRunSummary[];
  tasksStartedLast5h: number;
  tasksStartedLast7d: number;
} | null> {
  const p = getPool();
  if (!p) return null;

  const attention = await p.query<{
    id: string;
    repo: string;
    task_title: string;
    status: TaskRunStatus;
    started_at: Date;
    finished_at: Date | null;
  }>(
    `select id, repo, task_title, status, started_at, finished_at
     from runner.task_runs
     where status in ('needs_human_input', 'failed')
       and started_at > now() - interval '7 days'
     order by started_at desc
     limit 20`,
  );

  // Aproximación, no telemetría real de la cuota de Anthropic (que no expone
  // API): cuenta de tareas que este runner lanzó en las ventanas de 5h/7
  // días, como proxy de "cuánto se ha usado la cuota Pro compartida
  // recientemente". Documentado explícitamente como aproximado en el mensaje
  // que consume esto — ver hermes/skills/status-report/SKILL.md.
  const windows = await p.query<{ last_5h: string; last_7d: string }>(
    `select
       count(*) filter (where started_at > now() - interval '5 hours') as last_5h,
       count(*) filter (where started_at > now() - interval '7 days') as last_7d
     from runner.task_runs`,
  );

  return {
    tasksNeedingAttention: attention.rows.map((row) => ({
      id: row.id,
      repo: row.repo,
      taskTitle: row.task_title,
      status: row.status,
      startedAt: row.started_at.toISOString(),
      ...(row.finished_at ? { finishedAt: row.finished_at.toISOString() } : {}),
    })),
    tasksStartedLast5h: Number.parseInt(windows.rows[0]?.last_5h ?? '0', 10),
    tasksStartedLast7d: Number.parseInt(windows.rows[0]?.last_7d ?? '0', 10),
  };
}

/**
 * Lectura para la tool MCP `get_metrics` (US-9.2) — el mismo dato que imprime
 * `personalai-metrics`, servido a Hermes para que pueda contarlo por chat.
 *
 * Reutiliza `collectMetrics` de @personalai/shared en vez de repetir el SQL
 * aquí: si el CLI y Telegram dieran números distintos para la misma pregunta,
 * ninguno de los dos serviría como evidencia.
 *
 * Devuelve `null` sin persistencia configurada, igual que
 * `getRunnerStatusSummary` — un despliegue de pruebas sin `DATABASE_URL` no
 * debe romper una consulta de solo lectura.
 */
export async function getMetrics(): Promise<Metrics | null> {
  const p = getPool();
  if (!p) return null;
  return collectMetrics(p as Queryable);
}
