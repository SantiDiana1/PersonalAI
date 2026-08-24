import { describe, expect, it } from 'vitest';
import { ingestRequestSchema, observationRequestSchema, queryRequestSchema } from './validation.js';

describe('ingestRequestSchema', () => {
  it('acepta un request válido mínimo', () => {
    const result = ingestRequestSchema.safeParse({
      source: 'notes',
      sourceAuthority: 'supporting',
      text: 'una nota',
    });
    expect(result.success).toBe(true);
  });

  it('rechaza cualquier sourceAuthority que no sea canonical/supporting (US-4.1)', () => {
    const result = ingestRequestSchema.safeParse({
      source: 'notes',
      sourceAuthority: 'muy-fiable',
      text: 'una nota',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza texto vacío', () => {
    const result = ingestRequestSchema.safeParse({
      source: 'notes',
      sourceAuthority: 'supporting',
      text: '   ',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza un source desconocido', () => {
    const result = ingestRequestSchema.safeParse({
      source: 'slack',
      sourceAuthority: 'supporting',
      text: 'x',
    });
    expect(result.success).toBe(false);
  });
});

describe('queryRequestSchema', () => {
  it('acepta question sin k (usa el default en el handler)', () => {
    expect(queryRequestSchema.safeParse({ question: '¿algo?' }).success).toBe(true);
  });

  it('rechaza k no positivo o excesivo', () => {
    expect(queryRequestSchema.safeParse({ question: 'x', k: 0 }).success).toBe(false);
    expect(queryRequestSchema.safeParse({ question: 'x', k: 51 }).success).toBe(false);
  });
});

describe('observationRequestSchema', () => {
  it('no expone sourceAuthority — siempre es canonical/hermes_feedback en el handler', () => {
    const result = observationRequestSchema.safeParse({ text: 'resultado de la tarea' });
    expect(result.success).toBe(true);
    expect(result.success && 'sourceAuthority' in result.data).toBe(false);
  });
});
