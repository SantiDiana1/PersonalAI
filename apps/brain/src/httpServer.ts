import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isAuthorized, requireAuthSecret } from './auth.js';
import { deleteRawEvent, insertRawEvent, querySimilar, updateEmbedding } from './db.js';
import type { EmbeddingProvider } from './embeddings.js';
import { logger } from './logger.js';
import { detectSecret } from './sanitize.js';
import {
  DEFAULT_QUERY_K,
  ingestRequestSchema,
  observationRequestSchema,
  queryRequestSchema,
} from './validation.js';

const MAX_BODY_BYTES = 256 * 1024;
/** UUID v4-ish — suficiente para validar el parámetro de ruta, Postgres valida el resto. */
const UUID_PATH_RE = /^\/v1\/raw-events\/([0-9a-fA-F-]{36})$/;

export interface HttpServerOptions {
  port: number;
  host: string;
}

export function httpOptionsFromEnv(): HttpServerOptions {
  const rawPort = process.env['BRAIN_HTTP_PORT'];
  const port = rawPort ? Number.parseInt(rawPort, 10) : 8090;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`BRAIN_HTTP_PORT inválido: ${String(rawPort)}`);
  }
  // 0.0.0.0 dentro del contenedor es correcto: el servicio no publica
  // `ports:` en el compose, solo alcanzable desde la red interna — mismo
  // razonamiento que apps/claude-code-runner-mcp (SEC-3.1 de docs/security.md).
  const host = process.env['BRAIN_HTTP_HOST']?.trim() || '0.0.0.0';
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
 * Calcula y persiste el embedding de forma asíncrona (docs/personal-brain/spec.md
 * §5.1). No se `await`ea desde el handler — errores se loguean, nunca tumban
 * la petición de ingesta que ya respondió 201.
 */
function scheduleEmbedding(embeddings: EmbeddingProvider, id: string, text: string): void {
  embeddings
    .embed(text)
    .then((vector) => updateEmbedding(id, vector))
    .catch((err: unknown) => {
      logger.error({ err, id }, 'no se pudo calcular/persistir el embedding de un raw_event');
    });
}

export async function startHttpServer(
  options: HttpServerOptions,
  embeddings: EmbeddingProvider,
): Promise<Server> {
  const secret = requireAuthSecret();

  const httpServer = createServer((req, res) => {
    void handleRequest(req, res).catch((err: unknown) => {
      logger.error({ err }, 'error no controlado atendiendo petición HTTP');
      if (!res.headersSent) {
        writeJson(res, 500, { error: 'internal_error' });
      } else {
        res.end();
      }
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    if (method === 'GET' && url.pathname === '/health') {
      writeJson(res, 200, { status: 'ok' });
      return;
    }

    if (!isAuthorized(req.headers.authorization, secret)) {
      logger.warn({ method, path: url.pathname }, 'petición rechazada por autenticación');
      res.setHeader('WWW-Authenticate', 'Bearer');
      writeJson(res, 401, { error: 'unauthorized' });
      return;
    }

    if (method === 'POST' && url.pathname === '/v1/ingest') {
      await handleIngest(req, res);
      return;
    }

    if (method === 'POST' && url.pathname === '/v1/query') {
      await handleQuery(req, res);
      return;
    }

    if (method === 'POST' && url.pathname === '/v1/observations') {
      await handleObservation(req, res);
      return;
    }

    const uuidMatch = UUID_PATH_RE.exec(url.pathname);
    if (method === 'DELETE' && uuidMatch?.[1]) {
      const deleted = await deleteRawEvent(uuidMatch[1]);
      writeJson(res, deleted ? 200 : 404, { deleted });
      return;
    }

    writeJson(res, 404, { error: 'not_found' });
  }

  async function handleIngest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseBody(req, res);
    if (body === undefined) return;

    const parsed = ingestRequestSchema.safeParse(body);
    if (!parsed.success) {
      writeJson(res, 400, { error: 'invalid_request', details: parsed.error.flatten() });
      return;
    }

    const secretHit = detectSecret(parsed.data.text);
    if (secretHit.found) {
      logger.warn(
        { reason: secretHit.reason },
        'ingesta rechazada: el texto parece contener un secreto',
      );
      writeJson(res, 400, {
        error: 'possible_secret_detected',
        reason: secretHit.reason,
        hint: 'Retira el token/credencial del texto antes de ingestarlo (docs/personal-brain/spec.md §7).',
      });
      return;
    }

    const occurredAt = parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : new Date();
    const event = await insertRawEvent({
      source: parsed.data.source,
      sourceAuthority: parsed.data.sourceAuthority,
      text: parsed.data.text,
      occurredAt,
      ...(parsed.data.externalRef !== undefined ? { externalRef: parsed.data.externalRef } : {}),
    });

    scheduleEmbedding(embeddings, event.id, event.text);
    writeJson(res, 201, event);
  }

  async function handleQuery(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseBody(req, res);
    if (body === undefined) return;

    const parsed = queryRequestSchema.safeParse(body);
    if (!parsed.success) {
      writeJson(res, 400, { error: 'invalid_request', details: parsed.error.flatten() });
      return;
    }

    const questionEmbedding = await embeddings.embed(parsed.data.question);
    const fragments = await querySimilar(questionEmbedding, parsed.data.k ?? DEFAULT_QUERY_K);
    writeJson(res, 200, { fragments });
  }

  async function handleObservation(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseBody(req, res);
    if (body === undefined) return;

    const parsed = observationRequestSchema.safeParse(body);
    if (!parsed.success) {
      writeJson(res, 400, { error: 'invalid_request', details: parsed.error.flatten() });
      return;
    }

    // Feedback directo de un agente: es la propia acción, siempre 'canonical'
    // (docs/personal-brain/spec.md §5.1).
    const event = await insertRawEvent({
      source: 'hermes_feedback',
      sourceAuthority: 'canonical',
      text: parsed.data.text,
      occurredAt: new Date(),
      ...(parsed.data.externalRef !== undefined ? { externalRef: parsed.data.externalRef } : {}),
    });

    scheduleEmbedding(embeddings, event.id, event.text);
    writeJson(res, 201, event);
  }

  async function parseBody(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
    try {
      const body = await readJsonBody(req);
      if (body === undefined) {
        writeJson(res, 400, { error: 'missing_body' });
        return undefined;
      }
      return body;
    } catch {
      writeJson(res, 400, { error: 'invalid_json' });
      return undefined;
    }
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  logger.info({ host: options.host, port: options.port }, 'brain escuchando por HTTP');
  return httpServer;
}
