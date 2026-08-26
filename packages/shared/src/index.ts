/**
 * @personalai/shared — tipos y utilidades compartidas entre apps/brain,
 * apps/brain-mcp y apps/claude-code-runner-mcp.
 *
 * En Fase 0 esto es solo scaffolding tipado; los tipos reales del modelo
 * de datos de Brain (RawEvent, Observation, MentalModel) y del contrato
 * de claude-code-runner-mcp llegan en las fases 1 y 2 respectivamente.
 */

export {
  collectMetrics,
  collectTaskMetrics,
  collectBrainMetrics,
  type Queryable,
  type Metrics,
  type TaskMetrics,
  type BrainMetrics,
  type ToolMetrics,
  type TerminalStatus,
  type TaskRunTool,
} from './metrics.js';

/** Autoridad de una fuente de ingestion, ver docs/personal-brain/spec.md §4.1. */
export type SourceAuthority = 'canonical' | 'supporting';

/** Fuente de un `RawEvent`, ver docs/personal-brain/spec.md §4.1. */
export type RawEventSource = 'notes' | 'github' | 'notion' | 'jira' | 'hermes_feedback';

/**
 * Único modelo de datos "de contenido" de Brain en v1 (docs/personal-brain/spec.md §4.1).
 * La capa de consolidación (Observation/MentalModel) está fuera de alcance de
 * este proyecto — ver docs/personal-brain/spec.md §4.2.
 */
export interface RawEvent {
  id: string;
  source: RawEventSource;
  sourceAuthority: SourceAuthority;
  externalRef?: string;
  text: string;
  /** Fecha del evento real, no de la ingesta. */
  occurredAt: string;
  ingestedAt: string;
}

/** Un fragmento devuelto por `POST /v1/query`, ver docs/personal-brain/spec.md §5.1. */
export interface QueryFragment {
  id: string;
  text: string;
  score: number;
  source: RawEventSource;
  sourceAuthority: SourceAuthority;
  occurredAt: string;
}

/** Nombre y versión del paquete, útil para healthchecks/logging. */
export const packageInfo = {
  name: '@personalai/shared',
  version: '0.0.0',
} as const;

/** Placeholder tipado — confirma que el pipeline de build/typecheck funciona end-to-end. */
export function greet(name: string): string {
  return `Hello, ${name}, from @personalai/shared`;
}
