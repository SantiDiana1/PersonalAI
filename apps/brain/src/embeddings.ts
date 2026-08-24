import { logger } from './logger.js';

/**
 * Proveedor de embeddings — abstracción mínima para no acoplar el resto de
 * Brain a un proveedor concreto (docs/personal-brain/spec.md §11, pregunta
 * abierta ya resuelta: se usa Hugging Face Inference API, ver README).
 */
export interface EmbeddingProvider {
  /** Dimensión del vector que produce — debe coincidir con la columna `embedding vector(N)` de Postgres. */
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
}

/** Modelo por defecto: BAAI/bge-m3 — multilingüe (incluye español), fuerte en retrieval (MTEB), 1024 dims. */
export const DEFAULT_HF_MODEL = 'BAAI/bge-m3';
export const DEFAULT_HF_DIMENSIONS = 1024;

/**
 * `api-inference.huggingface.co` (el dominio dedicado antiguo) está retirado
 * — verificado en vivo (Fase 4): ya no resuelve por DNS. Hugging Face
 * consolidó todo el tráfico de inferencia serverless bajo un router único
 * con proveedor explícito en la ruta; `hf-inference` es el proveedor propio
 * de HF (gratuito/serverless), el equivalente al servicio antiguo. La ruta
 * de "pipeline" explícita es necesaria: sin ella, algunos modelos (bge-m3
 * incluido) resuelven por defecto a la tarea "sentence-similarity" en vez de
 * "feature-extraction", que espera un payload distinto y falla.
 */
const HF_INFERENCE_URL = 'https://router.huggingface.co/hf-inference/models';
const HF_FEATURE_EXTRACTION_PIPELINE = 'pipeline/feature-extraction';

export class HuggingFaceEmbeddingError extends Error {}

/**
 * Colapsa la respuesta de la Inference API de Hugging Face a un único vector.
 *
 * La mayoría de modelos con config de sentence-transformers (como bge-m3)
 * devuelven ya el vector de la frase (`number[]`). Si el modelo devuelve
 * embeddings por token (`number[][]`, sin pooling en el servidor), se aplica
 * mean pooling aquí — más robusto que asumir un único formato de respuesta.
 */
export function collapseToVector(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HuggingFaceEmbeddingError('respuesta de embeddings vacía o con forma inesperada');
  }

  if (typeof raw[0] === 'number') {
    return raw as number[];
  }

  if (Array.isArray(raw[0])) {
    const tokens = raw as number[][];
    const dims = tokens[0]?.length ?? 0;
    const pooled = new Array<number>(dims).fill(0);
    for (const token of tokens) {
      for (let i = 0; i < dims; i++) {
        pooled[i] = (pooled[i] ?? 0) + (token[i] ?? 0);
      }
    }
    return pooled.map((sum) => sum / tokens.length);
  }

  throw new HuggingFaceEmbeddingError('respuesta de embeddings con forma no reconocida');
}

export interface HuggingFaceEmbeddingProviderOptions {
  apiKey: string;
  model?: string;
  dimensions?: number;
  fetchImpl?: typeof fetch;
}

export function createHuggingFaceEmbeddingProvider(
  options: HuggingFaceEmbeddingProviderOptions,
): EmbeddingProvider {
  const model = options.model ?? DEFAULT_HF_MODEL;
  const dimensions = options.dimensions ?? DEFAULT_HF_DIMENSIONS;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    dimensions,
    async embed(text: string): Promise<number[]> {
      const res = await doFetch(`${HF_INFERENCE_URL}/${model}/${HF_FEATURE_EXTRACTION_PIPELINE}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        // wait_for_model: evita un 503 la primera vez que el modelo se
        // "despierta" en la infra serverless de HF — espera en vez de fallar.
        body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '<sin cuerpo>');
        throw new HuggingFaceEmbeddingError(
          `Hugging Face Inference API respondió ${res.status} para el modelo ${model}: ${body.slice(0, 500)}`,
        );
      }

      const json: unknown = await res.json();
      const vector = collapseToVector(json);

      if (vector.length !== dimensions) {
        logger.warn(
          { model, expected: dimensions, actual: vector.length },
          'el embedding devuelto no tiene la dimensión configurada — revisa BRAIN_EMBEDDING_DIMENSIONS',
        );
      }

      return vector;
    },
  };
}

/** Construye el proveedor a partir de variables de entorno. Lanza si falta la API key. */
export function embeddingProviderFromEnv(fetchImpl?: typeof fetch): EmbeddingProvider {
  const apiKey = process.env['HUGGINGFACE_API_KEY']?.trim();
  if (!apiKey) {
    throw new Error(
      'HUGGINGFACE_API_KEY no está configurada. Genera un token (read-only basta) en ' +
        'https://huggingface.co/settings/tokens y ponlo en el .env.',
    );
  }
  const model = process.env['BRAIN_EMBEDDING_MODEL']?.trim() || DEFAULT_HF_MODEL;
  const rawDims = process.env['BRAIN_EMBEDDING_DIMENSIONS']?.trim();
  const dimensions = rawDims ? Number.parseInt(rawDims, 10) : DEFAULT_HF_DIMENSIONS;
  return createHuggingFaceEmbeddingProvider(
    fetchImpl ? { apiKey, model, dimensions, fetchImpl } : { apiKey, model, dimensions },
  );
}
