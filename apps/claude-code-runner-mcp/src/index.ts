/**
 * apps/claude-code-runner-mcp — servidor MCP que lanza Claude Code en un
 * contenedor Docker efímero por tarea. Ver docs/hermes/spec.md §3.
 */
import { logger } from './logger.js';
import { startServer } from './server.js';

export { runCodingTask } from './runCodingTask.js';
export type { RunCodingTaskDeps } from './runCodingTask.js';
export * from './types.js';

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  startServer().catch((err: unknown) => {
    logger.error({ err }, 'claude-code-runner-mcp no pudo arrancar');
    process.exitCode = 1;
  });
}
