/**
 * apps/brain-mcp — servidor MCP adaptador sobre la API de apps/brain.
 * Fase 5 (docs/decisions-log.md): tres tools, wrappers finos sobre POST /v1/query,
 * /v1/ingest y /v1/observations — ver docs/personal-brain/spec.md §5.2.
 */
import { greet, packageInfo } from '@personalai/shared';
import { logger } from './logger.js';
import { startServer } from './server.js';

export { startServer } from './server.js';
export { createBrainClient, brainClientFromEnv } from './brainClient.js';
export type { BrainClient } from './brainClient.js';

/** Placeholder de Fase 0 — se mantiene como smoke test de que el workspace sigue enlazado. */
export function ping(): string {
  return `${packageInfo.name} says: ${greet('brain-mcp')}`;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  startServer().catch((err: unknown) => {
    logger.error({ err }, 'brain-mcp no pudo arrancar');
    process.exitCode = 1;
  });
}
