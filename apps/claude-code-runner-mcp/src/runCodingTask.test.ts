import { describe, expect, it } from 'vitest';
import { slugify } from './runCodingTask.js';

describe('slugify', () => {
  it('convierte un título en un slug seguro para nombres de rama', () => {
    expect(slugify('Arregla el bug del login')).toBe('arregla-el-bug-del-login');
  });

  it('quita caracteres no alfanuméricos y recorta guiones al inicio/fin', () => {
    expect(slugify('  ¡Bug crítico!! (#42)  ')).toBe('bug-cr-tico-42');
  });

  it('trunca a 40 caracteres', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(40);
  });
});
