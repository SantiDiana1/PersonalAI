import { migrate } from './db.js';
import { embeddingProviderFromEnv } from './embeddings.js';
import { httpOptionsFromEnv, startHttpServer } from './httpServer.js';

/**
 * Arranque del servicio HTTP de Brain (docs/personal-brain/spec.md §5.1,
 * Fase 4 de docs/roadmap.md). Sin MCP todavía — eso es `apps/brain-mcp`,
 * Fase 5.
 */
export async function startServer(): Promise<void> {
  const embeddings = embeddingProviderFromEnv();
  await migrate(embeddings.dimensions);
  await startHttpServer(httpOptionsFromEnv(), embeddings);
}
