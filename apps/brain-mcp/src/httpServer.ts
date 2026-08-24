import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { isAuthorized, requireAuthSecret } from './auth.js';
import type { BrainClient } from './brainClient.js';
import { logger } from './logger.js';
import { createMcpServer } from './mcpServer.js';

/**
 * Mismo patrón de transporte que apps/claude-code-runner-mcp/src/httpServer.ts
 * — Streamable HTTP, autenticación Bearer obligatoria, sin lógica propia más
 * allá de la sesión MCP. brain-mcp no tiene el socket de Docker ni ningún
 * otro privilegio especial (a diferencia del runner), pero se mantiene el
 * mismo estándar de "sin puerto publicado + auth obligatoria" por defensa en
 * profundidad y consistencia con el resto del sistema.
 */

const MCP_PATH = '/mcp';
const MAX_BODY_BYTES = 256 * 1024;

export interface HttpServerOptions {
  port: number;
  host: string;
}

export function httpOptionsFromEnv(): HttpServerOptions {
  const rawPort = process.env['BRAIN_MCP_HTTP_PORT'];
  const port = rawPort ? Number.parseInt(rawPort, 10) : 8091;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`BRAIN_MCP_HTTP_PORT inválido: ${String(rawPort)}`);
  }
  const host = process.env['BRAIN_MCP_HTTP_HOST']?.trim() || '0.0.0.0';
  return { port, host };
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function jsonRpcError(code: number, message: string): unknown {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error('cuerpo de la petición demasiado grande');
    }
    chunks.push(buf);
  }
  if (size === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

export async function startHttpServer(
  options: HttpServerOptions,
  client: BrainClient,
): Promise<Server> {
  const secret = requireAuthSecret();

  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer((req, res) => {
    void handleRequest(req, res).catch((err: unknown) => {
      logger.error({ err }, 'error no controlado atendiendo petición HTTP');
      if (!res.headersSent) {
        writeJson(res, 500, jsonRpcError(-32603, 'Internal server error'));
      } else {
        res.end();
      }
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/health') {
      writeJson(res, 200, { status: 'ok' });
      return;
    }

    if (url.pathname !== MCP_PATH) {
      writeJson(res, 404, jsonRpcError(-32601, 'Not found'));
      return;
    }

    if (!isAuthorized(req.headers.authorization, secret)) {
      logger.warn(
        { method: req.method, remote: req.socket.remoteAddress },
        'petición MCP rechazada por autenticación',
      );
      res.setHeader('WWW-Authenticate', 'Bearer');
      writeJson(res, 401, jsonRpcError(-32001, 'Unauthorized'));
      return;
    }

    const sessionId = req.headers['mcp-session-id'];
    const existing = typeof sessionId === 'string' ? transports.get(sessionId) : undefined;

    if (existing) {
      await existing.handleRequest(req, res);
      return;
    }

    if (req.method !== 'POST') {
      writeJson(res, 400, jsonRpcError(-32000, 'Missing or invalid session'));
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      writeJson(res, 400, jsonRpcError(-32700, 'Parse error'));
      return;
    }

    if (!isInitializeRequest(body)) {
      writeJson(res, 400, jsonRpcError(-32000, 'Missing or invalid session'));
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport);
        logger.info({ sessionId: id }, 'sesión MCP iniciada');
      },
      onsessionclosed: (id) => {
        transports.delete(id);
        logger.info({ sessionId: id }, 'sesión MCP cerrada');
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };

    await createMcpServer(client).connect(transport as Transport);
    await transport.handleRequest(req, res, body);
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  logger.info({ host: options.host, port: options.port }, 'brain-mcp escuchando por HTTP');
  return httpServer;
}
