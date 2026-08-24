/**
 * Contrato de la tool MCP `run_coding_task`.
 * Ver docs/hermes/spec.md §3.1 — este archivo es la fuente de verdad en código
 * de ese contrato; el spec documenta el "por qué", este el "qué exactamente".
 */

export type TaskRunStatus = 'running' | 'success' | 'failed' | 'needs_human_input' | 'timed_out';

export interface RunCodingTaskInput {
  /** owner/repo */
  repo: string;
  /** por defecto, la rama por defecto del repo */
  baseBranch?: string;
  taskTitle: string;
  taskDescription: string;
  /** texto ya recuperado de brain-mcp (Fase 4) — de momento siempre ausente */
  brainContext?: string;
  /** por defecto 1800 (30 min) */
  timeoutSeconds?: number;
}

export interface RunCodingTaskOutput {
  status: TaskRunStatus;
  branchName?: string;
  commitShas?: string[];
  summary: string;
  logsUrl?: string;
}

/** Resultado que el entrypoint del contenedor escribe en /workspace/result.json. */
export interface ContainerResult {
  status: 'success' | 'failed' | 'needs_human_input';
  summary: string;
  commitShas: string[];
}

/** Resumen de una fila de `runner.task_runs` para `get_runner_status` (US-6.3/US-6.4). */
export interface TaskRunSummary {
  id: string;
  repo: string;
  taskTitle: string;
  status: TaskRunStatus;
  startedAt: string;
  finishedAt?: string;
}

/** Fila de `runner.task_runs`, ver docs/hermes/spec.md §7. */
export interface TaskRunRow {
  id: string;
  repo: string;
  taskTitle: string;
  status: TaskRunStatus;
  brainContext: string | null;
  result: RunCodingTaskOutput | null;
  branchName: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}
