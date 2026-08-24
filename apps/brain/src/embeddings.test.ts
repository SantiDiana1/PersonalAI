import { describe, expect, it, vi } from 'vitest';
import {
  collapseToVector,
  createHuggingFaceEmbeddingProvider,
  HuggingFaceEmbeddingError,
} from './embeddings.js';

describe('collapseToVector', () => {
  it('devuelve el vector tal cual si la API ya hace pooling (formato sentence-transformers)', () => {
    expect(collapseToVector([0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
  });

  it('hace mean pooling si la API devuelve embeddings por token (2D)', () => {
    const perToken = [
      [1, 1],
      [3, 3],
    ];
    expect(collapseToVector(perToken)).toEqual([2, 2]);
  });

  it('lanza si la respuesta está vacía', () => {
    expect(() => collapseToVector([])).toThrow(HuggingFaceEmbeddingError);
  });

  it('lanza si la respuesta no es un array', () => {
    expect(() => collapseToVector({ error: 'model loading' })).toThrow(HuggingFaceEmbeddingError);
  });
});

describe('createHuggingFaceEmbeddingProvider', () => {
  it('llama a la Inference API con el modelo/token configurados y devuelve el vector', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([0.5, 0.5]),
    });

    const provider = createHuggingFaceEmbeddingProvider({
      apiKey: 'hf_test',
      model: 'BAAI/bge-m3',
      dimensions: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const vector = await provider.embed('hola mundo');

    expect(vector).toEqual([0.5, 0.5]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://router.huggingface.co/hf-inference/models/BAAI/bge-m3/pipeline/feature-extraction',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer hf_test' }),
      }),
    );
    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as { body: string }).body);
    expect(body).toEqual({ inputs: 'hola mundo', options: { wait_for_model: true } });
  });

  it('lanza HuggingFaceEmbeddingError con el status y cuerpo si la API responde con error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Model is currently loading'),
    });

    const provider = createHuggingFaceEmbeddingProvider({
      apiKey: 'hf_test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.embed('hola')).rejects.toThrow(/503/);
  });
});
