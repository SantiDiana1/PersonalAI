/**
 * @personalai/shared — tipos y utilidades compartidas entre apps/brain,
 * apps/brain-mcp y apps/claude-code-runner-mcp.
 *
 * En Fase 0 esto es solo scaffolding tipado; los tipos reales del modelo
 * de datos de Brain (RawEvent, Observation, MentalModel) y del contrato
 * de claude-code-runner-mcp llegan en las fases 1 y 2 respectivamente.
 */

/** Autoridad de una fuente de ingestion, ver docs/personal-brain/spec.md §4.1. */
export type SourceAuthority = 'canonical' | 'supporting';

/** Nombre y versión del paquete, útil para healthchecks/logging. */
export const packageInfo = {
  name: '@personalai/shared',
  version: '0.0.0',
} as const;

/** Placeholder tipado — confirma que el pipeline de build/typecheck funciona end-to-end. */
export function greet(name: string): string {
  return `Hello, ${name}, from @personalai/shared`;
}
