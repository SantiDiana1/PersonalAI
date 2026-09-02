import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import Docker from 'dockerode';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { formatMetrics } from '@personalai/shared';
import { isAuthorized, requireAuthSecret } from './auth.js';
import { getMetrics } from './db.js';
import { logger } from './logger.js';
import { createMcpServer } from './mcpServer.js';

/** Ruta del endpoint MCP. */
const MCP_PATH = '/mcp';
/**
 * Ruta REST de solo lectura con las mismas métricas que la tool MCP
 * `get_metrics` (US-9.2), en texto plano listo para enviar.
 *
 * Existe porque el camino determinista de Telegram no puede hablar MCP: el
 * webhook de hermes-agent ejecuta un script de shell con el entorno saneado y
 * un timeout, y el transporte Streamable HTTP exige un handshake `initialize`
 * con sesión — inviable con `curl` en tres líneas. Esta ruta da el mismo dato
 * con un GET.
 *
 * No relaja la seguridad: misma autenticación Bearer que `/mcp` (SEC-3.2),
 * solo lectura, sin parámetros, y devuelve agregados fijos — nunca títulos de
 * tarea ni contenido de repos. Es estrictamente menos capaz que `/mcp`, que
 * desde el mismo origen ya permite lanzar contenedores.
 */
const METRICS_PATH = '/v1/metrics';
/** Tope del cuerpo de una petición: un prompt de tarea, no una subida de datos. */
const MAX_BODY_BYTES = 1_024 * 1_024;

export interface HttpServerOptions {
  port: number;
  host: string;
}

export function httpOptionsFromEnv(): HttpServerOptions {
  const rawPort = process.env['CLAUDE_CODE_RUNNER_HTTP_PORT'];
  const port = rawPort ? Number.parseInt(rawPort, 10) : 8080;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`CLAUDE_CODE_RUNNER_HTTP_PORT inválido: ${String(rawPort)}`);
  }
  // 0.0.0.0 dentro del contenedor es correcto y NO implica exposición: el
  // servicio no publica `ports:` en el compose, así que solo es alcanzable
  // desde la red interna (SEC-3.1 de docs/security.md).
  const host = process.env['CLAUDE_CODE_RUNNER_HTTP_HOST']?.trim() || '0.0.0.0';
  return { port, host };
}

function writeText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
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

/**
 * Arranca el servidor MCP sobre Streamable HTTP.
 *
 * Ver docs/hermes/spec.md §3.5 para por qué este transporte y no stdio: un
 * servidor MCP stdio corre como subproceso de su cliente, lo que metería este
 * proceso —el único con el socket de Docker— dentro del contenedor de
 * hermes-agent, que es precisamente el componente que ingiere texto no
 * confiable (SEC-2.1 de docs/security.md).
 */
export async function startHttpServer(options: HttpServerOptions): Promise<Server> {
  // Se valida al arrancar, no en la primera petición: preferimos que el
  // despliegue falle inmediatamente y de forma ruidosa a que quede un endpoint
  // arriba cuya autenticación no está realmente configurada.
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

    // Healthcheck del contenedor: sin autenticación a propósito, pero también
    // sin ninguna información sensible — solo confirma que el proceso responde
    // Y que puede hablar de verdad con el socket de Docker (Fase 17, US-17.3).
    //
    // Antes de esto, este endpoint solo comprobaba que el proceso Node seguía
    // vivo: un bind-mount de /var/run/docker.sock que quedara obsoleto tras un
    // reinicio del host (Docker Desktop/WSL2 recrea el socket) dejaba el
    // proceso respondiendo "ok" mientras cada tarea real fallaba silenciosamente
    // al intentar `docker.createContainer`. `docker compose ps` nunca lo
    // reflejaba porque el HEALTHCHECK del Dockerfile solo mira esta ruta.
    if (url.pathname === '/health') {
      const docker = new Docker();
      try {
        // Timeout corto: un socket realmente colgado (no solo lento) no debe
        // dejar el healthcheck esperando más de lo que dura su propio timeout
        // de Docker (`--timeout=5s` en el HEALTHCHECK del Dockerfile).
        await Promise.race([
          docker.ping(),
          new Promise((_resolve, reject) => {
            setTimeout(() => {
              reject(new Error('docker.ping() timeout'));
            }, 3000);
          }),
        ]);
      } catch (err) {
        logger.error(
          { err },
          'healthcheck: no se puede hablar con el socket de Docker (SEC-4.1, US-17.3)',
        );
        writeJson(res, 503, { status: 'docker socket unreachable' });
        return;
      }
      writeJson(res, 200, { status: 'ok' });
      return;
    }

    if (url.pathname !== MCP_PATH && url.pathname !== METRICS_PATH) {
      writeJson(res, 404, jsonRpcError(-32601, 'Not found'));
      return;
    }

    if (!isAuthorized(req.headers.authorization, secret)) {
      // No se distingue entre "falta la cabecera" y "el secreto no coincide":
      // un atacante no debe poder afinar sus intentos con la respuesta.
      logger.warn(
        { method: req.method, remote: req.socket.remoteAddress },
        'petición MCP rechazada por autenticación (SEC-3.2)',
      );
      res.setHeader('WWW-Authenticate', 'Bearer');
      writeJson(res, 401, jsonRpcError(-32001, 'Unauthorized'));
      return;
    }

    if (url.pathname === METRICS_PATH) {
      if (req.method !== 'GET') {
        writeJson(res, 405, jsonRpcError(-32000, 'Method not allowed'));
        return;
      }
      const metrics = await getMetrics();
      if (metrics === null) {
        // 503 y no 200 con un cuerpo vacío: el script del webhook trata el
        // fallo de `curl` como "no enviar nada" (`set -e` + `--fail`), que es
        // mejor que entregar al Operador un informe silenciosamente vacío.
        writeJson(res, 503, jsonRpcError(-32000, 'Persistencia no configurada'));
        return;
      }
      logger.info('GET /v1/metrics atendida');
      if (url.searchParams.get('format') === 'json') {
        writeJson(res, 200, metrics);
        return;
      }
      writeText(res, 200, formatMetrics(metrics));
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

    // Red de seguridad: si el transporte muere sin pasar por onsessionclosed
    // (p. ej. el cliente corta la conexión), la entrada del mapa quedaría
    // colgada y el proceso es de larga vida.
    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };

    // Cast necesario por un desajuste de tipos del SDK bajo
    // `exactOptionalPropertyTypes`: el accessor `onclose` de la clase está
    // tipado como `(() => void) | undefined`, mientras que la interfaz
    // `Transport` lo declara `onclose?: () => void` (sin `| undefined`
    // explícito). Es incompatibilidad de tipos, no de comportamiento.
    await createMcpServer().connect(transport as Transport);
    await transport.handleRequest(req, res, body);
  }

  // Una tarea puede tardar hasta el timeout configurado (30 min por defecto,
  // docs/hermes/spec.md §3.1). Los defaults de Node cortarían la petición mucho
  // antes, así que se desactiva el timeout por petición.
  httpServer.requestTimeout = 0;
  httpServer.headersTimeout = 60_000;

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  logger.info(
    { host: options.host, port: options.port, paths: [MCP_PATH, METRICS_PATH] },
    'claude-code-runner-mcp escuchando por HTTP (autenticación Bearer obligatoria)',
  );

  return httpServer;
}
