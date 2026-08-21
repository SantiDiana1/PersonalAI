import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { migrate } from './db.js';
import { httpOptionsFromEnv, startHttpServer } from './httpServer.js';
import { logger } from './logger.js';
import { createMcpServer } from './mcpServer.js';

export type TransportMode = 'stdio' | 'http';

/**
 * Transporte a usar. `http` es el modo de despliegue (Fase 2, contenedor
 * propio y aislado — ver docs/hermes/spec.md §3.5); `stdio` se mantiene para
 * desarrollo local y para invocar el servidor desde un cliente MCP de prueba
 * sin levantar red, que es como se validó la Fase 1.
 */
export function transportModeFromEnv(): TransportMode {
  const raw = process.env['CLAUDE_CODE_RUNNER_TRANSPORT']?.trim().toLowerCase();
  if (!raw || raw === 'stdio') return 'stdio';
  if (raw === 'http') return 'http';
  throw new Error(`CLAUDE_CODE_RUNNER_TRANSPORT inválido: ${raw} (valores: stdio, http)`);
}

export async function startServer(): Promise<void> {
  await migrate();

  const mode = transportModeFromEnv();

  if (mode === 'http') {
    await startHttpServer(httpOptionsFromEnv());
    return;
  }

  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
  logger.info('claude-code-runner-mcp escuchando por stdio');
}
