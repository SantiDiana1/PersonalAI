import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { brainClientFromEnv } from './brainClient.js';
import { httpOptionsFromEnv, startHttpServer } from './httpServer.js';
import { logger } from './logger.js';
import { createMcpServer } from './mcpServer.js';

export type TransportMode = 'stdio' | 'http';

/** Mismo esquema que apps/claude-code-runner-mcp: `http` en despliegue, `stdio` para desarrollo local. */
export function transportModeFromEnv(): TransportMode {
  const raw = process.env['BRAIN_MCP_TRANSPORT']?.trim().toLowerCase();
  if (!raw || raw === 'stdio') return 'stdio';
  if (raw === 'http') return 'http';
  throw new Error(`BRAIN_MCP_TRANSPORT inválido: ${raw} (valores: stdio, http)`);
}

export async function startServer(): Promise<void> {
  const client = brainClientFromEnv();
  const mode = transportModeFromEnv();

  if (mode === 'http') {
    await startHttpServer(httpOptionsFromEnv(), client);
    return;
  }

  const server = createMcpServer(client);
  await server.connect(new StdioServerTransport());
  logger.info('brain-mcp escuchando por stdio');
}
