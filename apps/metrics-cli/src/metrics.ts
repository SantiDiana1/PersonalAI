/**
 * Consultas de métricas sobre las dos fuentes de verdad del sistema:
 * `runner.task_runs` (tareas delegadas a Claude Code) y `brain.raw_events`
 * (lo que Brain ha ingerido). Ver docs/roadmap.md US-9.2.
 *
 * Todo lo de este módulo es de SOLO LECTURA y trabaja contra una interfaz
 * mínima (`Queryable`) en vez de contra `pg.Pool` directamente: así los tests
 * ejercitan la lógica de agregación —que es donde están los errores
 * interesantes, no en el driver— sin levantar un Postgres.
 */

export interface Queryable {
  query<T extends object>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export type TaskRunTool = 'run_coding_task' | 'run_claude_command';

/** Estados terminales: una tarea `running` todavía no dice nada sobre éxito. */
const TERMINAL_STATUSES = ['success', 'failed', 'needs_human_input', 'timed_out'] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export interface ToolMetrics {
  tool: TaskRunTool;
  total: number;
  running: number;
  byStatus: Record<TerminalStatus, number>;
  /**
   * `success / (tareas terminadas)`, o `null` si todavía no ha terminado
   * ninguna. Null y 0 significan cosas distintas —"no hay datos" frente a
   * "todas fallaron"— y confundirlos es exactamente el tipo de métrica que
   * engaña, así que se distinguen en el tipo y no en el valor.
   */
  successRate: number | null;
}

export interface TaskMetrics {
  byTool: ToolMetrics[];
  startedLast5h: number;
  startedLast7d: number;
  startedLast30d: number;
}

export interface BrainMetrics {
  totalEvents: number;
  eventsLast7d: number;
  bySource: { source: string; count: number }[];
}

export interface Metrics {
  generatedAt: string;
  tasks: TaskMetrics;
  /** `null` cuando el esquema `brain` no existe en esta base de datos. */
  brain: BrainMetrics | null;
}

function toInt(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value;
  return Number.parseInt(value ?? '0', 10) || 0;
}

/** `true` si la tabla existe; `to_regclass` devuelve null en vez de lanzar. */
async function tableExists(db: Queryable, qualifiedName: string): Promise<boolean> {
  const res = await db.query<{ reg: string | null }>(`select to_regclass($1)::text as reg`, [
    qualifiedName,
  ]);
  return res.rows[0]?.reg != null;
}

export async function collectTaskMetrics(db: Queryable): Promise<TaskMetrics> {
  const counts = await db.query<{ tool: string; status: string; count: string }>(
    `select tool, status, count(*)::text as count
       from runner.task_runs
      group by tool, status`,
  );

  const windows = await db.query<{ last_5h: string; last_7d: string; last_30d: string }>(
    `select
       count(*) filter (where started_at > now() - interval '5 hours')::text  as last_5h,
       count(*) filter (where started_at > now() - interval '7 days')::text   as last_7d,
       count(*) filter (where started_at > now() - interval '30 days')::text  as last_30d
     from runner.task_runs`,
  );

  // Ambas tools aparecen siempre, incluso con cero filas: un informe donde
  // una tool desaparece por no tener datos se lee como si no existiera.
  const tools: TaskRunTool[] = ['run_coding_task', 'run_claude_command'];
  const byTool = tools.map<ToolMetrics>((tool) => {
    const rows = counts.rows.filter((r) => r.tool === tool);
    const byStatus = Object.fromEntries(
      TERMINAL_STATUSES.map((s) => [s, toInt(rows.find((r) => r.status === s)?.count)]),
    ) as Record<TerminalStatus, number>;

    const running = toInt(rows.find((r) => r.status === 'running')?.count);
    const finished = TERMINAL_STATUSES.reduce((acc, s) => acc + byStatus[s], 0);

    return {
      tool,
      total: finished + running,
      running,
      byStatus,
      successRate: finished === 0 ? null : byStatus.success / finished,
    };
  });

  const w = windows.rows[0];
  return {
    byTool,
    startedLast5h: toInt(w?.last_5h),
    startedLast7d: toInt(w?.last_7d),
    startedLast30d: toInt(w?.last_30d),
  };
}

export async function collectBrainMetrics(db: Queryable): Promise<BrainMetrics | null> {
  // Brain y el runner comparten base de datos pero son apps independientes y
  // cada una crea su propio esquema al arrancar. Un despliegue con el runner
  // levantado y Brain todavía no puede existir perfectamente, y en ese caso
  // esto informa "sin datos", no revienta el comando entero.
  if (!(await tableExists(db, 'brain.raw_events'))) {
    return null;
  }

  const totals = await db.query<{ total: string; last_7d: string }>(
    `select
       count(*)::text as total,
       count(*) filter (where ingested_at > now() - interval '7 days')::text as last_7d
     from brain.raw_events`,
  );

  const bySource = await db.query<{ source: string; count: string }>(
    `select source, count(*)::text as count
       from brain.raw_events
      group by source
      order by count(*) desc, source asc`,
  );

  return {
    totalEvents: toInt(totals.rows[0]?.total),
    eventsLast7d: toInt(totals.rows[0]?.last_7d),
    bySource: bySource.rows.map((r) => ({ source: r.source, count: toInt(r.count) })),
  };
}

export async function collectMetrics(db: Queryable, now: () => Date = () => new Date()) {
  const [tasks, brain] = await Promise.all([collectTaskMetrics(db), collectBrainMetrics(db)]);
  return { generatedAt: now().toISOString(), tasks, brain } satisfies Metrics;
}
