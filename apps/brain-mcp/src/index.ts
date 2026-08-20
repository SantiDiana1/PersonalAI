/**
 * apps/brain-mcp — servidor MCP adaptador sobre la API de apps/brain.
 *
 * Scaffolding de Fase 0 (US-0.1). Las tools reales (brain_query, brain_ingest,
 * brain_record_observation) llegan en la Fase 4 (ver docs/roadmap.md y
 * docs/personal-brain/spec.md §5.2).
 */
import { greet, packageInfo } from '@personalai/shared';

export function ping(): string {
  return `${packageInfo.name} says: ${greet('brain-mcp')}`;
}
