import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCases } from './loadCases.js';

const CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cases');

describe('loadCases', () => {
  it('carga los cinco casos reales de US-18.1 sin errores de validación', async () => {
    const cases = await loadCases(CASES_DIR);
    expect(cases.map((c) => c.id)).toEqual(['CE-001', 'DH-001', 'IO-001', 'SP-001', 'TM-001']);
  });

  it('cada caso trae su family, sec y origin', async () => {
    const cases = await loadCases(CASES_DIR);
    for (const c of cases) {
      expect(c.family).toBeTruthy();
      expect(c.sec.length).toBeGreaterThan(0);
      expect(c.origin).toBe('real');
    }
  });
});
