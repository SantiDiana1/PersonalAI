/**
 * apps/brain — servicio de memoria (Personal Brain).
 *
 * Fase 4 (docs/decisions-log.md): ingestion + retrieval semántico vía API HTTP
 * interna. Deliberadamente básico — ver docs/personal-brain/spec.md §0.
 * Sin MCP todavía (eso es apps/brain-mcp, Fase 5).
 */
import { greet, packageInfo } from '@personalai/shared';
import { logger } from './logger.js';
import { startServer } from './server.js';

export { startServer } from './server.js';

/** Placeholder de Fase 0 — se mantiene como smoke test de que el workspace sigue enlazado. */
export function ping(): string {
  return `${packageInfo.name} says: ${greet('brain')}`;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  startServer().catch((err: unknown) => {
    logger.error({ err }, 'brain no pudo arrancar');
    process.exitCode = 1;
  });
}
