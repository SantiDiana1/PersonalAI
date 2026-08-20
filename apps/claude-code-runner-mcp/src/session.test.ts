import { describe, expect, it } from 'vitest';
import { classifySessionCheck } from './session.js';

describe('classifySessionCheck', () => {
  it('es válida si el exit code es 0 y el output contiene OK', () => {
    expect(classifySessionCheck(0, 'OK')).toEqual({ valid: true });
  });

  it('distingue sesión expirada de sesión revocada', () => {
    expect(classifySessionCheck(1, 'Error: token expired, please log in again')).toMatchObject({
      valid: false,
      reason: 'expired',
    });
    expect(classifySessionCheck(1, 'Error: request forbidden, account suspended')).toMatchObject({
      valid: false,
      reason: 'revoked',
    });
  });

  it('cae a "unknown" si no reconoce el patrón del error', () => {
    expect(classifySessionCheck(1, 'algo salió mal sin más contexto')).toMatchObject({
      valid: false,
      reason: 'unknown',
    });
  });
});
