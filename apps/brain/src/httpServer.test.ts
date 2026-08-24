import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddingProvider } from './embeddings.js';

const insertRawEvent = vi.fn();
const querySimilar = vi.fn();
const deleteRawEvent = vi.fn();
const updateEmbedding = vi.fn();

vi.mock('./db.js', () => ({
  insertRawEvent: (...args: unknown[]) => insertRawEvent(...args),
  querySimilar: (...args: unknown[]) => querySimilar(...args),
  deleteRawEvent: (...args: unknown[]) => deleteRawEvent(...args),
  updateEmbedding: (...args: unknown[]) => updateEmbedding(...args),
}));

const { startHttpServer } = await import('./httpServer.js');

const fakeEmbeddings: EmbeddingProvider = {
  dimensions: 3,
  embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
};

describe('httpServer', () => {
  let server: Awaited<ReturnType<typeof startHttpServer>>;
  let baseUrl: string;
  const token = 'a'.repeat(32);

  beforeEach(async () => {
    process.env['BRAIN_API_TOKEN'] = token;
    insertRawEvent.mockReset();
    querySimilar.mockReset();
    deleteRawEvent.mockReset();
    updateEmbedding.mockReset().mockResolvedValue(undefined);

    server = await startHttpServer({ port: 0, host: '127.0.0.1' }, fakeEmbeddings);
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    delete process.env['BRAIN_API_TOKEN'];
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('/health responde sin autenticación', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('rechaza peticiones sin token con 401', async () => {
    const res = await fetch(`${baseUrl}/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '¿qué convención sigue el repo?' }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /v1/ingest valida sourceAuthority y persiste el evento', async () => {
    insertRawEvent.mockResolvedValue({
      id: 'event-1',
      source: 'notes',
      sourceAuthority: 'supporting',
      text: 'una nota cualquiera',
      occurredAt: '2026-08-24T00:00:00.000Z',
      ingestedAt: '2026-08-24T00:00:00.000Z',
    });

    const res = await fetch(`${baseUrl}/v1/ingest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'notes',
        sourceAuthority: 'supporting',
        text: 'una nota cualquiera',
      }),
    });

    expect(res.status).toBe(201);
    expect(insertRawEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'notes', sourceAuthority: 'supporting' }),
    );
  });

  it('POST /v1/ingest rechaza un sourceAuthority inválido (400, sin tocar la base de datos)', async () => {
    const res = await fetch(`${baseUrl}/v1/ingest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'notes', sourceAuthority: 'muy-fiable', text: 'x' }),
    });

    expect(res.status).toBe(400);
    expect(insertRawEvent).not.toHaveBeenCalled();
  });

  it('POST /v1/ingest rechaza texto que contiene un token de GitHub (400, sin persistir)', async () => {
    const res = await fetch(`${baseUrl}/v1/ingest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'notes',
        sourceAuthority: 'supporting',
        text: 'token: github_pat_11A3NUDMQ0HIRdB4aRJkWs_8E9juKOP6nbQKGYak9lE1',
      }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('possible_secret_detected');
    expect(insertRawEvent).not.toHaveBeenCalled();
  });

  it('POST /v1/query devuelve los fragmentos que retorna querySimilar', async () => {
    querySimilar.mockResolvedValue([
      {
        id: '1',
        text: 'frag',
        score: 0.9,
        source: 'github',
        sourceAuthority: 'canonical',
        occurredAt: 'x',
      },
    ]);

    const res = await fetch(`${baseUrl}/v1/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '¿convención de branches?', k: 3 }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      fragments: [
        {
          id: '1',
          text: 'frag',
          score: 0.9,
          source: 'github',
          sourceAuthority: 'canonical',
          occurredAt: 'x',
        },
      ],
    });
    expect(querySimilar).toHaveBeenCalledWith([0.1, 0.2, 0.3], 3);
  });

  it('POST /v1/observations persiste como hermes_feedback / canonical siempre', async () => {
    insertRawEvent.mockResolvedValue({
      id: 'event-2',
      source: 'hermes_feedback',
      sourceAuthority: 'canonical',
      text: 'tarea resuelta con éxito',
      occurredAt: '2026-08-24T00:00:00.000Z',
      ingestedAt: '2026-08-24T00:00:00.000Z',
    });

    const res = await fetch(`${baseUrl}/v1/observations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'tarea resuelta con éxito',
        externalRef: 'https://github.com/x/y/pull/1',
      }),
    });

    expect(res.status).toBe(201);
    expect(insertRawEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'hermes_feedback', sourceAuthority: 'canonical' }),
    );
  });

  it('DELETE /v1/raw-events/:id borra y devuelve 200, o 404 si no existía', async () => {
    deleteRawEvent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const id = '11111111-1111-1111-1111-111111111111';

    const first = await fetch(`${baseUrl}/v1/raw-events/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${baseUrl}/v1/raw-events/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(second.status).toBe(404);
  });
});
