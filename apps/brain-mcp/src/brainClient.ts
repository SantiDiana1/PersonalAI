import type { QueryFragment, RawEvent, RawEventSource, SourceAuthority } from '@personalai/shared';
import { logger } from './logger.js';

/**
 * Cliente HTTP delgado sobre la API de apps/brain (docs/personal-brain/spec.md §5.1).
 * Es el único lugar donde brain-mcp sabe hablar HTTP con Brain — las tres
 * tools MCP (mcpServer.ts) son wrappers finos sobre estas tres funciones.
 *
 * Timeout explícito y corto a propósito (US-5.2 de docs/decisions-log.md): si Brain
 * no responde a tiempo, la tarea de Hermes debe poder seguir sin contexto en
 * vez de bloquearse — este cliente lanza rápido en vez de colgarse.
 */

export class BrainClientError extends Error {}

export interface BrainClientOptions {
  baseUrl: string;
  apiToken: string;
  /** Por defecto 10s — una consulta de similitud no debería tardar más que eso. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface BrainClient {
  query(question: string, k?: number): Promise<QueryFragment[]>;
  ingest(params: {
    source: RawEventSource;
    sourceAuthority: SourceAuthority;
    text: string;
    externalRef?: string;
  }): Promise<RawEvent>;
  recordObservation(text: string, externalRef?: string): Promise<RawEvent>;
}

/**
 * 25s, no 10s — verificado en vivo (Fase 5) que un "cold start" real de la
 * Hugging Face Inference API (el modelo se descarga en su infra serverless
 * tras un rato de inactividad) puede tardar más de 10s; con ese valor
 * `brain_query` abortaba de forma prematura durante una ejecución real de
 * `resolve-issue`. `embed()` ya pide `wait_for_model: true` (espera en vez de
 * fallar con 503) — este timeout tiene que ser generoso para dejarle
 * completar esa espera en vez de cortarla.
 */
const DEFAULT_TIMEOUT_MS = 25_000;

async function request<T>(
  options: Required<Pick<BrainClientOptions, 'baseUrl' | 'apiToken' | 'timeoutMs'>> &
    Pick<BrainClientOptions, 'fetchImpl'>,
  path: string,
  body: unknown,
): Promise<T> {
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const res = await doFetch(`${options.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '<sin cuerpo>');
      throw new BrainClientError(
        `Brain respondió ${res.status} en ${path}: ${errBody.slice(0, 500)}`,
      );
    }

    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof BrainClientError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    logger.warn({ path, isTimeout, message }, 'petición a Brain falló');
    throw new BrainClientError(
      isTimeout
        ? `Brain no respondió en ${options.timeoutMs}ms (${path})`
        : `No se pudo contactar con Brain (${path}): ${message}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export function createBrainClient(options: BrainClientOptions): BrainClient {
  const resolved = {
    baseUrl: options.baseUrl.replace(/\/$/, ''),
    apiToken: options.apiToken,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  };

  return {
    async query(question, k) {
      const res = await request<{ fragments: QueryFragment[] }>(resolved, '/v1/query', {
        question,
        ...(k !== undefined ? { k } : {}),
      });
      return res.fragments;
    },

    async ingest(params) {
      return request<RawEvent>(resolved, '/v1/ingest', params);
    },

    async recordObservation(text, externalRef) {
      return request<RawEvent>(resolved, '/v1/observations', {
        text,
        ...(externalRef !== undefined ? { externalRef } : {}),
      });
    },
  };
}

export function brainClientFromEnv(fetchImpl?: typeof fetch): BrainClient {
  const baseUrl = process.env['BRAIN_URL']?.trim();
  const apiToken = process.env['BRAIN_API_TOKEN']?.trim();
  if (!baseUrl || !apiToken) {
    throw new Error('BRAIN_URL y BRAIN_API_TOKEN son obligatorias para brain-mcp.');
  }
  const rawTimeout = process.env['BRAIN_REQUEST_TIMEOUT_MS']?.trim();
  const timeoutMs = rawTimeout ? Number.parseInt(rawTimeout, 10) : undefined;
  return createBrainClient({
    baseUrl,
    apiToken,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}
