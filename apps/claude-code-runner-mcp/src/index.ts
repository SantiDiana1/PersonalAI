/**
 * apps/claude-code-runner-mcp — servidor MCP que lanza Claude Code en un
 * contenedor Docker efímero por tarea.
 *
 * Scaffolding de Fase 0 (US-0.1). La tool real (run_coding_task) y el
 * aislamiento Docker llegan en la Fase 2 (ver docs/roadmap.md y
 * docs/hermes/spec.md §3).
 */
import { greet, packageInfo } from '@personalai/shared';

export function ping(): string {
  return `${packageInfo.name} says: ${greet('claude-code-runner-mcp')}`;
}
