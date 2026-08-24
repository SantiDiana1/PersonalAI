import { z } from 'zod';

/**
 * Esquemas de validación de la API HTTP (docs/personal-brain/spec.md §5.1).
 * `sourceAuthority` rechaza cualquier valor que no sea `canonical`/`supporting`
 * (US-4.1) — zod lo hace de fábrica al usar un enum en vez de `string`.
 */

export const sourceAuthoritySchema = z.enum(['canonical', 'supporting']);

export const rawEventSourceSchema = z.enum([
  'notes',
  'github',
  'notion',
  'jira',
  'hermes_feedback',
]);

export const ingestRequestSchema = z.object({
  source: rawEventSourceSchema,
  sourceAuthority: sourceAuthoritySchema,
  text: z.string().trim().min(1, 'text no puede estar vacío'),
  externalRef: z.string().trim().min(1).optional(),
  /** Opcional: fecha del evento real. Por defecto, el momento de la ingesta. */
  occurredAt: z.string().datetime().optional(),
});
export type IngestRequest = z.infer<typeof ingestRequestSchema>;

export const queryRequestSchema = z.object({
  question: z.string().trim().min(1, 'question no puede estar vacía'),
  k: z.number().int().positive().max(50).optional(),
});
export type QueryRequest = z.infer<typeof queryRequestSchema>;

/**
 * `POST /v1/observations` — feedback de un agente tras actuar
 * (docs/personal-brain/spec.md §5.1). Se persiste como `RawEvent` de tipo
 * `hermes_feedback`, siempre `sourceAuthority: 'canonical'` (es la propia
 * acción del agente, no una nota externa sin revisar).
 */
export const observationRequestSchema = z.object({
  text: z.string().trim().min(1, 'text no puede estar vacío'),
  externalRef: z.string().trim().min(1).optional(),
});
export type ObservationRequest = z.infer<typeof observationRequestSchema>;

export const DEFAULT_QUERY_K = 5;
