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

/**
 * Allowlist fija de comandos slash que `run_claude_command` puede ejecutar —
 * ver docs/hermes/spec.md §3.7 (Fase 8, US-8.2). La superficie de comandos
 * ejecutables es exactamente esta lista, no un intérprete de comandos
 * arbitrario expuesto a texto no confiable (mismo principio que SEC-3.3
 * aplicado aquí a "qué comando", no solo a "qué tool").
 */
export const ALLOWED_SLASH_COMMANDS = ['/design', '/dataviz'] as const;
export type AllowedSlashCommand = (typeof ALLOWED_SLASH_COMMANDS)[number];

/**
 * Contrato de la tool MCP `run_claude_command` (Fase 8, US-8.2).
 *
 * Diseño rediseñado respecto al propuesto originalmente en
 * docs/hermes/spec.md §3.7: `claude -p` en modo headless NO tiene acceso a la
 * tool `Artifact` (verificado empíricamente, Fase 8 — ver "Hallazgo real
 * US-8.1" en el roadmap), así que esta tool nunca devuelve un `artifactUrl`
 * ya publicado. En su lugar, devuelve el HTML autocontenido que el comando
 * generó (`htmlContent`) para que el Skill que la invoca lo entregue por
 * Telegram/issue — el Operador decide si lo publica a mano.
 */
export interface RunClaudeCommandInput {
  /** Validado contra ALLOWED_SLASH_COMMANDS — nunca un comando arbitrario. */
  slashCommand: AllowedSlashCommand;
  /** Texto libre tras el comando, p.ej. "landing page para mi proyecto X". */
  prompt: string;
  /** Opcional: solo si el comando necesita contexto de un repo concreto (clonado read-only, sin push). */
  repo?: string;
  brainContext?: string;
  /** Por defecto 900 (15 min) — más corto que run_coding_task porque no hay clonado+build, solo generación. */
  timeoutSeconds?: number;
}

export interface RunClaudeCommandOutput {
  status: TaskRunStatus;
  /** HTML/Markdown autocontenido generado por el comando, si tuvo éxito. Nunca un link ya publicado — ver nota de diseño arriba. */
  htmlContent?: string;
  summary: string;
  logsUrl?: string;
}

/** Resultado que el entrypoint del contenedor escribe en /workspace/command-result.json (modo `run_claude_command`). */
export interface ContainerCommandResult {
  status: 'success' | 'failed' | 'needs_human_input';
  summary: string;
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
