import { describe, expect, it, vi } from 'vitest';
import { BrainClientError, createBrainClient } from './brainClient.js';

describe('createBrainClient', () => {
  it('query envía Authorization Bearer y devuelve fragments', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ fragments: [{ id: '1', text: 'x', score: 0.9 }] }),
    });
    const client = createBrainClient({
      baseUrl: 'http://brain:8090',
      apiToken: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const fragments = await client.query('¿qué convención?', 3);

    expect(fragments).toEqual([{ id: '1', text: 'x', score: 0.9 }]);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://brain:8090/v1/query');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ question: '¿qué convención?', k: 3 });
  });

  it('ingest y recordObservation llaman a los endpoints correctos', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'e1' }) });
    const client = createBrainClient({
      baseUrl: 'http://brain:8090/',
      apiToken: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.ingest({ source: 'notes', sourceAuthority: 'supporting', text: 'x' });
    await client.recordObservation('resultado', 'https://pr/1');

    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe('http://brain:8090/v1/ingest');
    expect((fetchImpl.mock.calls[1] as [string])[0]).toBe('http://brain:8090/v1/observations');
  });

  it('lanza BrainClientError si Brain responde con error HTTP', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('boom') });
    const client = createBrainClient({
      baseUrl: 'http://brain:8090',
      apiToken: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.query('x')).rejects.toThrow(BrainClientError);
  });

  it('lanza BrainClientError si Brain no responde a tiempo (US-5.2: falla rápido, no se cuelga)', async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const client = createBrainClient({
      baseUrl: 'http://brain:8090',
      apiToken: 'tok',
      timeoutMs: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.query('x')).rejects.toThrow(/no respondió/);
  });
});
