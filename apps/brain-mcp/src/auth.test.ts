import { afterEach, describe, expect, it } from 'vitest';
import {
  isAuthorized,
  MIN_SECRET_LENGTH,
  MissingBrainMcpSecretError,
  requireAuthSecret,
} from './auth.js';

const SECRET = 'a'.repeat(MIN_SECRET_LENGTH);

describe('isAuthorized', () => {
  it('acepta la cabecera Bearer correcta', () => {
    expect(isAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it('rechaza cuando falta la cabecera o el secreto no coincide', () => {
    expect(isAuthorized(undefined, SECRET)).toBe(false);
    expect(isAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
  });

  it('rechaza esquemas que no son Bearer', () => {
    expect(isAuthorized(`Basic ${SECRET}`, SECRET)).toBe(false);
  });
});

describe('requireAuthSecret', () => {
  const original = process.env['BRAIN_MCP_AUTH_TOKEN'];

  afterEach(() => {
    if (original === undefined) delete process.env['BRAIN_MCP_AUTH_TOKEN'];
    else process.env['BRAIN_MCP_AUTH_TOKEN'] = original;
  });

  it('lanza si no está configurada o es demasiado corta', () => {
    delete process.env['BRAIN_MCP_AUTH_TOKEN'];
    expect(() => requireAuthSecret()).toThrow(MissingBrainMcpSecretError);
    process.env['BRAIN_MCP_AUTH_TOKEN'] = 'corto';
    expect(() => requireAuthSecret()).toThrow(MissingBrainMcpSecretError);
  });

  it('devuelve el secreto cuando es suficientemente largo', () => {
    process.env['BRAIN_MCP_AUTH_TOKEN'] = SECRET;
    expect(requireAuthSecret()).toBe(SECRET);
  });
});
